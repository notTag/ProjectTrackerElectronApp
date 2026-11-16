/**
 * Local web server for the browser build: serves out/web and carries every
 * IPC_CHANNELS call as `POST /api/invoke/<channel>`, handled by the same
 * createIpcHandlers the desktop app uses. Outside changes and agent retries
 * are pushed over Server-Sent Events (`GET /api/events?client=<id>`).
 *
 * Local only. The handlers can launch terminals and agents, so the request
 * guard (Host + Origin + JSON content type) is the security boundary: it stops
 * other websites and DNS-rebinding pages from driving those launches.
 */
import { execFile } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { APP_NAME, EXTERNAL_CHANGE_POLL_MS, createIpcHandlers, type IpcHandler } from '../ipcHandlers.js'
import { DATABASE_FILE_NAME, StateRepository } from '../storage/stateRepository.js'
import { IPC_CHANNELS, type IpcChannel } from '../../src/shared/bridgeApi.js'
import { isUuid, type AgentRetryEvent } from '../../src/shared/projectTypes.js'

export const DEFAULT_WEB_PORT = 5174
const LISTEN_HOST = '127.0.0.1'
// A full project-state:save is the biggest body; 10 MB is far past any real one.
const MAX_BODY_BYTES = 10 * 1024 * 1024
// A reload drops the SSE stream for a moment; keep the tab's repository (and
// its diff baseline) across that instead of starting it over.
const CLIENT_GRACE_MS = 30_000

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2'
}

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff'
}

// One repository per browser tab (D1 in docs/prd/t85-web-app-parity.md): each
// keeps its own diff baseline and data_version, so a stale tab's save can't
// write old field values over another tab's edits, and tab A's writes show up
// as outside changes in tab B exactly like the desktop app's do.
interface Client {
  repository: StateRepository
  streams: Set<ServerResponse>
  closeTimer?: ReturnType<typeof setTimeout>
}

export interface WebServerOptions {
  userDataPath: string
  staticDirectory: string
  port: number
  // Injected so tests never open a real folder chooser.
  pickDirectory?: () => Promise<string | null>
}

export interface RunningWebServer {
  server: Server
  url: string
  close(): Promise<void>
}

const runFile = (bin: string, args: string[], input?: string) =>
  new Promise<string>((resolve, reject) => {
    const child = execFile(bin, args, (error, stdout, stderr) =>
      error ? reject(Object.assign(error, { stderr })) : resolve(stdout.trim())
    )
    if (input !== undefined) child.stdin?.end(input)
  })

// The browser can't hand back an absolute folder path, so the server asks
// macOS. Exit 1 with -128 is the user pressing Cancel.
const chooseFolderWithOsascript = async () => {
  const script = 'POSIX path of (choose folder with prompt "Choose a project folder")'
  try {
    return await runFile('osascript', ['-e', script])
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '')
    if (stderr.includes('-128')) return null
    throw error
  }
}

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

const reject = (response: ServerResponse, status: number, message: string) => sendJson(response, status, { error: message })

const readBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, rejectBody) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error('Request body too large.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', rejectBody)
  })

const isIpcChannel = (value: string): value is IpcChannel => (IPC_CHANNELS as readonly string[]).includes(value)

export const startWebServer = async (options: WebServerOptions): Promise<RunningWebServer> => {
  // Fail fast on a database that won't open, before any tab connects.
  try {
    new StateRepository(options.userDataPath).close()
  } catch (error) {
    const databasePath = path.join(options.userDataPath, DATABASE_FILE_NAME)
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${APP_NAME} could not open its database\n${databasePath}\n\n${reason}\n\nThe file was left untouched. Move it aside to start fresh, or restore a backup.`
    )
  }

  const handlers: Record<IpcChannel, IpcHandler> = createIpcHandlers({
    homeDirectory: homedir(),
    startedAt: new Date().toISOString(),
    pickDirectory: options.pickDirectory ?? chooseFolderWithOsascript,
    writeClipboard: async (text) => {
      await runFile('pbcopy', [], text)
    },
    // ponytail: macOS only, like the rest of the launch features. Rejecting
    // sends Open In to its clipboard fallback.
    openPath: async () => {
      throw new Error('Opening folders is only supported on macOS.')
    }
  })

  const clients = new Map<string, Client>()
  const staticRoot = path.resolve(options.staticDirectory)
  let allowedHosts = new Set<string>()
  let allowedOrigins = new Set<string>()

  const clientFor = (clientId: string) => {
    let client = clients.get(clientId)
    if (!client) {
      client = { repository: new StateRepository(options.userDataPath), streams: new Set() }
      clients.set(clientId, client)
    }
    return client
  }

  const dropClient = (clientId: string) => {
    const client = clients.get(clientId)
    if (!client || client.streams.size > 0) return
    clearTimeout(client.closeTimer)
    client.repository.close()
    clients.delete(clientId)
  }

  const pushEvent = (client: Client, event: string, data: unknown = {}) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const stream of client.streams) stream.write(frame)
  }

  // Host blocks DNS rebinding (evil.example resolving to 127.0.0.1 still sends
  // its own name as Host). Origin blocks other sites; browsers send it on every
  // cross-origin request and on same-origin POSTs. Requiring a JSON content
  // type forces a CORS preflight, which this server never approves.
  const passesGuard = (request: IncomingMessage) => {
    if (!allowedHosts.has(request.headers.host ?? '')) return false
    const origin = request.headers.origin
    if (origin !== undefined && !allowedOrigins.has(origin)) return false
    if (request.method !== 'POST') return true
    const contentType = request.headers['content-type'] ?? ''
    return origin !== undefined && contentType.split(';')[0].trim() === 'application/json'
  }

  const clientIdOf = (value: string | string[] | null | undefined) =>
    typeof value === 'string' && isUuid(value) ? value : undefined

  const handleInvoke = async (request: IncomingMessage, response: ServerResponse, channel: string) => {
    if (!isIpcChannel(channel)) return reject(response, 404, `Unknown channel: ${channel}`)
    const clientId = clientIdOf(request.headers['x-client-id'])
    if (!clientId) return reject(response, 400, 'Missing or invalid X-Client-Id header.')

    let payload: unknown
    try {
      const body = await readBody(request)
      payload = body ? JSON.parse(body) : undefined
    } catch (error) {
      return reject(response, 400, error instanceof Error ? error.message : String(error))
    }

    const client = clientFor(clientId)
    try {
      const result = await handlers[channel](payload, {
        repository: client.repository,
        onAgentRetry: (notice: AgentRetryEvent) => pushEvent(client, 'agent-retry', notice)
      })
      // undefined has no JSON form; void handlers answer { } and the bridge reads undefined.
      sendJson(response, 200, result === undefined ? {} : { result })
    } catch (error) {
      reject(response, 500, error instanceof Error ? error.message : String(error))
    }
  }

  const handleEvents = (request: IncomingMessage, response: ServerResponse, clientId: string | undefined) => {
    if (!clientId) return reject(response, 400, 'Missing or invalid client id.')
    const client = clientFor(clientId)
    clearTimeout(client.closeTimer)
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    response.write(': connected\n\n')
    client.streams.add(response)
    request.on('close', () => {
      client.streams.delete(response)
      if (client.streams.size === 0) client.closeTimer = setTimeout(() => dropClient(clientId), CLIENT_GRACE_MS)
    })
  }

  const decodedPath = (urlPath: string) => {
    try {
      return decodeURIComponent(urlPath)
    } catch {
      return undefined
    }
  }

  const serveStatic = (response: ServerResponse, urlPath: string) => {
    // A bad %-escape throws, and a throw here would take the whole server down.
    const decoded = decodedPath(urlPath)
    if (decoded === undefined) return reject(response, 400, 'Malformed path.')
    const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
    const filePath = path.resolve(staticRoot, relativePath)
    const isInsideRoot = filePath.startsWith(`${staticRoot}${path.sep}`)
    const isFile = isInsideRoot && statSync(filePath, { throwIfNoEntry: false })?.isFile()
    if (!isFile) return reject(response, 404, 'Not found.')
    const contentType = CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream'
    response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': contentType })
    response.end(readFileSync(filePath))
  }

  const server = createServer((request, response) => {
    if (!passesGuard(request)) return reject(response, 403, 'Forbidden.')
    const url = new URL(request.url ?? '/', 'http://localhost')
    const invokePrefix = '/api/invoke/'

    if (request.method === 'POST' && url.pathname.startsWith(invokePrefix)) {
      void handleInvoke(request, response, url.pathname.slice(invokePrefix.length))
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      return handleEvents(request, response, clientIdOf(url.searchParams.get('client')))
    }
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(response, url.pathname)
    reject(response, 404, 'Not found.')
  })
  // An agent run (ticket:run-agent) holds its request open for minutes; Node's
  // default 300 s request timeout would cut it off. Local-only, so no limit.
  server.requestTimeout = 0

  await new Promise<void>((resolve, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(options.port, LISTEN_HOST, () => {
      server.off('error', rejectListen)
      resolve()
    })
  })

  const { port } = server.address() as AddressInfo
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
  allowedOrigins = new Set([...allowedHosts].map((host) => `http://${host}`))

  const poll = setInterval(() => {
    for (const client of clients.values()) {
      if (client.streams.size > 0 && client.repository.hasExternalChanges()) pushEvent(client, 'external-change')
    }
  }, EXTERNAL_CHANGE_POLL_MS)

  const close = async () => {
    clearInterval(poll)
    for (const client of clients.values()) {
      for (const stream of client.streams) stream.end()
      client.streams.clear()
      clearTimeout(client.closeTimer)
      client.repository.close()
    }
    clients.clear()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  return { server, url: `http://${LISTEN_HOST}:${port}`, close }
}

const userDataPathFromEnv = () => {
  const override = process.env.PROJECT_TRACKER_USER_DATA
  if (override) return path.resolve(override)
  return path.join(homedir(), 'Library', 'Application Support', APP_NAME)
}

const runFromCommandLine = async () => {
  const portSetting = process.env.PROJECT_TRACKER_WEB_PORT
  const port = portSetting ? Number(portSetting) : DEFAULT_WEB_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`PROJECT_TRACKER_WEB_PORT must be a port number, got "${portSetting}".`)
    process.exit(1)
  }
  // out/main/electron/web/server.js → <repo>/out/web
  const staticDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web')
  try {
    const running = await startWebServer({ userDataPath: userDataPathFromEnv(), staticDirectory, port })
    console.log(`${APP_NAME} web app: ${running.url}`)
  } catch (error) {
    const isPortTaken = (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    const message = isPortTaken
      ? `Port ${port} is already in use. Stop whatever is on it, or set PROJECT_TRACKER_WEB_PORT.`
      : error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
  }
}

const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntryPoint) void runFromCommandLine()
