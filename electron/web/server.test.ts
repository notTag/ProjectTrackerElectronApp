import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createSeedState, type ProjectTrackerState } from '../../src/shared/projectTypes.js'
import { startWebServer, type RunningWebServer } from './server.js'

interface Reply {
  status: number
  body: string
  headers: Record<string, string | string[] | undefined>
}

// node:http rather than fetch: the guard tests need to forge Host and Origin,
// which fetch won't send as given.
const send = (url: string, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }) =>
  new Promise<Reply>((resolve, reject) => {
    const { port } = new URL(url)
    const outgoing = httpRequest(
      { host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: options.headers },
      (response) => {
        let body = ''
        response.on('data', (chunk) => (body += chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body, headers: response.headers }))
      }
    )
    outgoing.on('error', reject)
    outgoing.end(options.body)
  })

describe('web server', () => {
  let userDataPath: string
  let staticDirectory: string
  let running: RunningWebServer
  let pickedDirectory: string | null

  const invoke = async (channel: string, payload?: unknown, clientId = defaultClient) => {
    const reply = await send(running.url, {
      method: 'POST',
      path: `/api/invoke/${channel}`,
      headers: { 'Content-Type': 'application/json', Origin: running.url, 'X-Client-Id': clientId },
      body: payload === undefined ? '' : JSON.stringify(payload)
    })
    const parsed = JSON.parse(reply.body) as { result?: unknown; error?: string }
    if (reply.status !== 200) throw new Error(parsed.error)
    return parsed.result
  }
  const defaultClient = randomUUID()

  const projectPath = createSeedState().snapshot.projects[0].path
  const seededState = (): ProjectTrackerState => ({
    ...createSeedState(),
    scanDirectories: [path.dirname(projectPath)],
    boards: { [projectPath]: { lanes: [{ id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '' }], tickets: [] } }
  })

  beforeEach(async () => {
    userDataPath = mkdtempSync(path.join(tmpdir(), 'project-tracker-web-test-'))
    staticDirectory = mkdtempSync(path.join(tmpdir(), 'project-tracker-web-static-'))
    writeFileSync(path.join(staticDirectory, 'index.html'), '<!doctype html><title>Project Tracker</title>')
    pickedDirectory = '/Users/example/Code'
    running = await startWebServer({ userDataPath, staticDirectory, port: 0, pickDirectory: async () => pickedDirectory })
    await invoke('project-state:save', seededState())
  })

  afterEach(async () => {
    await running.close()
    rmSync(userDataPath, { recursive: true, force: true })
    rmSync(staticDirectory, { recursive: true, force: true })
  })

  it('serves the built renderer with anti-framing headers', async () => {
    const reply = await send(running.url, { path: '/', headers: { Host: new URL(running.url).host } })
    expect(reply.status).toBe(200)
    expect(reply.body).toContain('Project Tracker')
    expect(reply.headers['x-frame-options']).toBe('DENY')
  })

  it('refuses paths that climb out of the static directory', async () => {
    const reply = await send(running.url, { path: '/..%2F..%2Fetc%2Fpasswd', headers: { Host: new URL(running.url).host } })
    expect(reply.status).toBe(404)
  })

  it('answers a malformed path without going down', async () => {
    const host = { Host: new URL(running.url).host }
    expect((await send(running.url, { path: '/%E0%A4%A', headers: host })).status).toBe(400)
    expect((await send(running.url, { path: '/', headers: host })).status).toBe(200)
  })

  describe('state', () => {
    it('returns null on refresh until another tab writes, then the new state', async () => {
      const otherTab = randomUUID()
      expect(await invoke('project-state:get')).toMatchObject({ scanDirectories: [path.dirname(projectPath)] })
      expect(await invoke('project-state:refresh')).toBeNull()

      await invoke('ticket:create', {
        projectPath,
        ticket: { id: 'from-other-tab', laneId: 'idea', title: 'Other tab', description: '', createdAt: '2026-11-16T00:00:00.000Z' }
      }, otherTab)

      const refreshed = (await invoke('project-state:refresh')) as ProjectTrackerState
      expect(refreshed.boards?.[projectPath].tickets.map((ticket) => ticket.id)).toEqual(['from-other-tab'])
    })

    it('normalizes the picked folder', async () => {
      pickedDirectory = '/Users/example/Code/'
      expect(await invoke('dialog:pick-scan-directory')).toBe('/Users/example/Code')
      pickedDirectory = null
      expect(await invoke('dialog:pick-scan-directory')).toBeNull()
    })
  })

  describe('tickets', () => {
    it('creates, updates and deletes', async () => {
      const created = await invoke('ticket:create', {
        projectPath,
        ticket: { id: 't1', laneId: 'idea', title: 'First', description: '', createdAt: '2026-11-16T00:00:00.000Z' }
      })
      expect(created).toMatchObject({ id: 't1', number: 1 })

      expect(await invoke('ticket:update', { id: 't1', patch: { title: 'Renamed' } })).toMatchObject({ title: 'Renamed' })
      await expect(invoke('ticket:update', { id: 't1', patch: { number: 9 } })).rejects.toThrow('Invalid ticket update payload.')

      expect(await invoke('ticket:delete', { id: 't1' })).toBeUndefined()
      const state = (await invoke('project-state:get')) as ProjectTrackerState
      expect(state.boards?.[projectPath].tickets).toEqual([])
    })
  })

  describe('lanes', () => {
    it('creates, updates, reorders and deletes', async () => {
      await invoke('lane:create', { projectPath, lane: { id: 'qa', name: 'QA', agentPrompt: '', agentFilePath: '' } })
      expect(await invoke('lane:update', { projectPath, laneId: 'qa', patch: { name: 'In QA' } })).toMatchObject({ name: 'In QA' })
      await invoke('lane:reorder', { projectPath, laneIds: ['qa', 'idea'] })

      const reordered = (await invoke('project-state:get')) as ProjectTrackerState
      expect(reordered.boards?.[projectPath].lanes.map((lane) => lane.id)).toEqual(['qa', 'idea'])

      await invoke('lane:delete', { projectPath, laneId: 'qa' })
      const afterDelete = (await invoke('project-state:get')) as ProjectTrackerState
      expect(afterDelete.boards?.[projectPath].lanes.map((lane) => lane.id)).toEqual(['idea'])
    })
  })

  describe('projects', () => {
    it('updates a project and keeps reads inside the scan directories', async () => {
      expect(await invoke('project:update', { path: projectPath, patch: { notes: 'web notes' } })).toMatchObject({ notes: 'web notes' })
      await expect(invoke('project:read-readme', '/etc')).rejects.toThrow('outside configured scan directories')
    })
  })

  describe('agents', () => {
    it('rejects an agent id that is not in the known list', async () => {
      await expect(invoke('ticket:run-agent', { projectPath, agentId: 'rm -rf', prompt: 'hi' })).rejects.toThrow('Unknown agent: rm -rf')
    })

    it('rejects an Open In target that is not in the allowlist', async () => {
      await expect(invoke('project:open-in', { projectPath, targetId: 'calculator' })).rejects.toThrow('Unknown open-in target')
    })
  })

  describe('request guard', () => {
    const post = (headers: Record<string, string>) =>
      send(running.url, { method: 'POST', path: '/api/invoke/project-state:get', headers: { 'X-Client-Id': defaultClient, ...headers }, body: '' })

    it('rejects another site as Origin', async () => {
      const reply = await post({ 'Content-Type': 'application/json', Origin: 'https://evil.example' })
      expect(reply.status).toBe(403)
      expect(reply.headers['access-control-allow-origin']).toBeUndefined()
    })

    it('rejects a rebinding Host', async () => {
      const reply = await post({ 'Content-Type': 'application/json', Origin: running.url, Host: 'evil.example:80' })
      expect(reply.status).toBe(403)
    })

    it('rejects a POST without a JSON content type', async () => {
      expect((await post({ 'Content-Type': 'text/plain', Origin: running.url })).status).toBe(403)
    })

    it('rejects a POST with no Origin', async () => {
      expect((await post({ 'Content-Type': 'application/json' })).status).toBe(403)
    })

    it('rejects an unknown channel and a missing client id', async () => {
      await expect(invoke('page-find:search', 'x')).rejects.toThrow('Unknown channel')
      await expect(invoke('project-state:get', undefined, 'not-a-uuid')).rejects.toThrow('X-Client-Id')
    })
  })
})
