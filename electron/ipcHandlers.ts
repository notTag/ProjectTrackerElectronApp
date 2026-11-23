/**
 * Request handling for every channel in IPC_CHANNELS, shared by the two
 * transports: Electron IPC (main.ts) and the local web server (web/server.ts).
 * Each transport authenticates the caller first (trusted sender frame / origin
 * guard), then hands the payload here. Nothing in this file imports Electron;
 * the few platform pieces arrive through HandlerDependencies.
 */
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { resolveAgentMarkdownPath, saveAgentMarkdown } from './agentMarkdown.js'
import { runAgentHeadlessWithRetry } from './agentRun.js'
import { createGithubRequest } from './githubRequest.js'
import { metricWindows, prCounts, runningAgentsByProject } from './metrics.js'
import { openProjectIn } from './openIn.js'
import { scanProjectDirectories } from './scanner/projectScanner.js'
import type { StateRepository } from './storage/stateRepository.js'
import {
  WARP_LAUNCH_CONFIG_NAME,
  ghosttyOsascriptArgs,
  itermOsascriptArgs,
  orchestratorTab,
  tabLiveness,
  tabTitlesOsascriptArgs,
  terminalOsascriptArgs,
  usableTabTitle,
  warpLaunchConfigYaml
} from './terminalLaunch.js'
import { ensureTicketWorktree, freshMainRef, repositoryRootOf } from './ticketWorktree.js'
import { removeTicketImage, removeTicketImages, resolveAttachmentPath, saveTicketImageBytes } from './ticketImages.js'
import type { IpcChannel } from '../src/shared/bridgeApi.js'
import { toPlainJson } from '../src/shared/plainJson.js'
import {
  availableAgents,
  isUuid,
  pullRequestNumber,
  shellQuote,
  toPullRequestStatus,
  type AgentRetryEvent,
  type AutoRunTicketLaunch,
  type GithubPullRequest,
  type TerminalTab,
  type ProjectPriority,
  type ProjectStatus,
  type ProjectTrackerState,
  type SwimLane,
  type Ticket,
  type TicketWritePatch,
  type LaneMarkdownKind,
  type LaneWritePatch,
  type ProjectWritePatch,
  type ScanProgress
} from '../src/shared/projectTypes.js'

export const APP_NAME = 'Project Tracker'

// ponytail: slow fixed poll for writes from other processes (a second app
// instance, the sqlite3 CLI, another browser tab). The renderer also refreshes
// on window focus and when a ticket field gains focus, so this only covers the
// idle case.
export const EXTERNAL_CHANGE_POLL_MS = 10_000

export interface HandlerDependencies {
  homeDirectory: string
  attachmentsRoot: string
  // Runs recorded as running before this moment belong to a process that is gone.
  startedAt: string
  // Absolute path of the chosen folder, or null when the user cancels.
  pickDirectory: () => Promise<string | null>
  writeClipboard: (text: string) => void | Promise<void>
  // Opens a file or folder in its default app: Open In on non-mac, and ticket
  // images. Resolves to an error message, empty on success (shell.openPath's shape).
  openPath: (targetPath: string) => Promise<string>
}

// Per call: which repository (the desktop app has one, the web server one per
// browser tab), where pushes for the caller go, and when the caller's page goes away.
export interface CallContext {
  repository: StateRepository
  onAgentRetry: (notice: AgentRetryEvent) => void
  onScanProgress: (progress: ScanProgress) => void
  // Runs the listener when the caller's page reloads or closes; returns an unsubscribe.
  onPageGone: (listener: () => void) => () => void
}

export type IpcHandler = (payload: unknown, context: CallContext) => unknown

export const normalizePath = (value: string) => path.resolve(value).split(path.sep).join(path.posix.sep)

// Hand a folder to a macOS app via Launch Services. Resolves on a successful
// hand-off; rejects (non-zero exit) when the app isn't installed, which the
// caller turns into the clipboard fallback. Arg-array exec — no shell, so the
// path can't be interpreted as a command.
const openWithApp = (appName: string, target: string) =>
  new Promise<void>((resolve, reject) => {
    execFile('open', ['-a', appName, target], (error) => (error ? reject(error) : resolve()))
  })

// Hand a URI to Launch Services. Same arg-array exec as openWithApp — no shell.
const openUri = (uri: string) =>
  new Promise<void>((resolve, reject) => {
    execFile('open', [uri], (error) => (error ? reject(error) : resolve()))
  })

// The timeout matters for Ghostty: its launches share one queue, so an osascript
// stuck on an unanswered Automation prompt would otherwise block every later one.
const OSASCRIPT_TIMEOUT_MS = 60_000

const run = (bin: string, args: string[]) =>
  new Promise<string>((resolve, reject) => {
    execFile(bin, args, { timeout: OSASCRIPT_TIMEOUT_MS }, (error, stdout) =>
      error ? reject(error) : resolve(stdout.trim())
    )
  })

const openTerminalWithCommands = (projectPath: string, tabs: TerminalTab[]) =>
  run('osascript', terminalOsascriptArgs(projectPath, tabs))

const openItermWithCommands = (projectPath: string, tabs: TerminalTab[]) =>
  run('osascript', itermOsascriptArgs(projectPath, tabs))

// #53: in memory only, so an app restart starts a fresh window.
let ghosttyWindowId = ''
let ghosttyLaunchQueue: Promise<unknown> = Promise.resolve()

// Launches run one at a time so two back-to-back handoffs can't both miss the
// stored id and open two windows. A failed launch still rejects to its caller
// but doesn't stall the queue.
// ponytail: one global queue. Launches are rare and each takes about 1s, so serializing them costs nothing.
const openGhosttyWithCommands = (projectPath: string, tabs: TerminalTab[]) => {
  const launch = ghosttyLaunchQueue.then(async () => {
    const args = ghosttyOsascriptArgs(projectPath, tabs, ghosttyWindowId)
    ghosttyWindowId = await run('osascript', args)
  })
  ghosttyLaunchQueue = launch.catch(() => undefined)
  return launch
}

// Packaged apps launched from Finder/Launch Services don't inherit the user's
// shell PATH, so `gh` won't resolve by name. Probe the common install locations.
const GH_BIN_CANDIDATES = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']

const runGhAuthToken = (bin: string) =>
  new Promise<string | undefined>((resolve) => {
    execFile(bin, ['auth', 'token'], { timeout: 5000 }, (error, stdout) => {
      if (error) return resolve(undefined)
      resolve(stdout.trim() || undefined)
    })
  })

// Resolve a GitHub token so private repos (which the API hides behind a 404 when
// unauthenticated) can be fetched. Prefer an explicit env token, then fall back
// to the signed-in `gh` CLI. Cached once found; absence is re-probed each call.
let cachedGithubToken: string | undefined
const resolveGithubToken = async (): Promise<string | undefined> => {
  if (cachedGithubToken) return cachedGithubToken
  const fromEnv = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim()
  if (fromEnv) {
    cachedGithubToken = fromEnv
    return cachedGithubToken
  }
  for (const bin of GH_BIN_CANDIDATES) {
    const token = await runGhAuthToken(bin)
    if (token) {
      cachedGithubToken = token
      return token
    }
  }
  return undefined
}

const parseGithubRepo = (githubUrl: string) => {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/?#]+)/.exec(githubUrl.trim())
  if (!match) throw new Error('Not a recognized GitHub repository URL.')
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') }
}

const requestGithub = createGithubRequest(fetch, resolveGithubToken, APP_NAME)

const isInsideAny = (target: string, parents: string[]) =>
  parents.some((parent) => target === parent || target.startsWith(`${parent}/`))

const scanDirectoriesOf = (repository: StateRepository) => repository.getState().scanDirectories.map(normalizePath)

export const assertScannedProjectPath = (repository: StateRepository, projectPath: string) => {
  const normalized = normalizePath(projectPath)
  if (!isInsideAny(normalized, scanDirectoriesOf(repository))) {
    throw new Error('Project path is outside configured scan directories.')
  }
  return normalized
}

const isAutoRunTicketLaunch = (value: unknown): value is AutoRunTicketLaunch => {
  const candidate = value as Partial<AutoRunTicketLaunch> | null
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    Number.isInteger(candidate.number) &&
    typeof candidate.branchName === 'string' &&
    typeof candidate.command === 'string' &&
    (candidate.title === undefined || typeof candidate.title === 'string')
  )
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

const isProjectTrackerState = (value: unknown): value is ProjectTrackerState => {
  if (!value || typeof value !== 'object') return false
  const candidate = value as ProjectTrackerState
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.updatedAt === 'string' &&
    isStringArray(candidate.scanDirectories) &&
    isStringArray(candidate.hiddenPaths) &&
    isStringArray(candidate.thirdPartyPaths) &&
    !!candidate.snapshot &&
    Array.isArray(candidate.snapshot.projects)
  )
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Every ticket field a write may set. id, number and createdAt are the repo's.
// Typed as a full Record so a field added to Ticket / SwimLane but not listed
// here fails typecheck instead of rejecting every write at runtime.
const TICKET_PATCH_FIELDS: Record<keyof TicketWritePatch, true> = {
  laneId: true, title: true, description: true, updatedAt: true, labels: true, branchName: true,
  worktreePath: true, pullRequestUrl: true, pullRequestState: true, pullRequestMergedAt: true,
  assigneeId: true, checklist: true, agentId: true, model: true, agentRun: true, externalId: true,
  externalUrl: true, fullAuto: true, externalLinks: true, moveToLaneId: true, moveOnComplete: true, version: true,
  images: true, moveRules: true, moveRulesPassedLaneId: true, readyLaneId: true
}
const LANE_PATCH_FIELDS: Record<keyof LaneWritePatch, true> = {
  name: true, agentPrompt: true, agentFilePath: true, outputTarget: true, orchestratorPrompt: true,
  orchestratorPromptOverride: true,
  autoRunAgentId: true, autoRunTerminalId: true, autoRunModel: true, orchestratorAgentId: true,
  orchestratorModel: true, autoRunWorktrees: true, fullAuto: true, closesTicket: true, agentSetsVersion: true,
  nextLaneId: true, orchestratorPollMinutes: true, orchestratorPollActive: true, orchestratorFilePath: true,
  waitsForPullRequestMerge: true
}
const TICKET_PATCH_KEYS = new Set(Object.keys(TICKET_PATCH_FIELDS))
const LANE_PATCH_KEYS = new Set(Object.keys(LANE_PATCH_FIELDS))
// NOT NULL text columns: a patch may change them but never clear them.
const REQUIRED_TEXT_KEYS = new Set(['laneId', 'title', 'description', 'name', 'agentPrompt', 'agentFilePath'])
// NOT NULL text columns whose SwimLane field is optional: the repository stores
// absent or null as '', but any other non-string is rejected.
const OPTIONAL_TEXT_KEYS = new Set(['outputTarget', 'orchestratorPrompt', 'orchestratorPromptOverride', 'orchestratorFilePath'])
const PROJECT_STATUSES: ProjectStatus[] = ['active', 'ongoing', 'paused', 'completed', 'archived', 'hidden', 'unknown']
const PROJECT_PRIORITIES: ProjectPriority[] = ['high', 'medium', 'low', 'none']

const isPatchOf = (allowedKeys: Set<string>, value: unknown): boolean => {
  if (!isPlainObject(value)) return false
  return Object.entries(value).every(([key, fieldValue]) => {
    if (!allowedKeys.has(key)) return false
    const isString = typeof fieldValue === 'string'
    if (REQUIRED_TEXT_KEYS.has(key)) return isString
    if (OPTIONAL_TEXT_KEYS.has(key)) return isString || fieldValue == null
    return true
  })
}

const isTicketPatch = (value: unknown): value is TicketWritePatch => isPatchOf(TICKET_PATCH_KEYS, value)
const isLanePatch = (value: unknown): value is LaneWritePatch => isPatchOf(LANE_PATCH_KEYS, value)

const isTicket = (value: unknown): value is Omit<Ticket, 'number'> => {
  if (!isPlainObject(value)) return false
  const { id, number: _number, createdAt, ...fields } = value
  return typeof id === 'string' && typeof createdAt === 'string' && isTicketPatch(fields) &&
    typeof fields.laneId === 'string' && typeof fields.title === 'string' && typeof fields.description === 'string'
}

const isSwimLane = (value: unknown): value is SwimLane => {
  if (!isPlainObject(value)) return false
  const { id, ...fields } = value
  return typeof id === 'string' && isLanePatch(fields) &&
    typeof fields.name === 'string' && typeof fields.agentPrompt === 'string' && typeof fields.agentFilePath === 'string'
}

const isProjectPatch = (value: unknown): value is ProjectWritePatch => {
  if (!isPlainObject(value)) return false
  const { notes, priority, status, ...rest } = value
  return Object.keys(rest).length === 0 &&
    (notes === undefined || typeof notes === 'string') &&
    (priority === undefined || PROJECT_PRIORITIES.includes(priority as ProjectPriority)) &&
    (status === undefined || PROJECT_STATUSES.includes(status as ProjectStatus))
}

export const createIpcHandlers = (dependencies: HandlerDependencies): Record<IpcChannel, IpcHandler> => {
  // Write the tickets' commands where Warp looks for launch configurations, then
  // ask Warp to open it. One reused file rather than one per ticket: the config
  // is a hand-off, not a document worth keeping, and per-ticket files would pile
  // up in the user's Warp directory forever.
  // ponytail: single reused config. Two launches within the moment it takes Warp
  // to read the file would race; key the name per launch if that ever bites.
  //
  // This executes the command rather than pasting it. What makes that safe is the
  // single-quote wrapping applied in ticketShellCommand: ticket text — which can
  // arrive from a GitHub issue — lands as one literal argument to the agent, never
  // as shell code.
  const openWarpWithCommands = async (projectPath: string, tabs: TerminalTab[]) => {
    const configDirectory = path.join(dependencies.homeDirectory, '.warp', 'launch_configurations')
    const configPath = path.join(configDirectory, `${WARP_LAUNCH_CONFIG_NAME}.yaml`)
    mkdirSync(configDirectory, { recursive: true })
    writeFileSync(configPath, warpLaunchConfigYaml(projectPath, tabs), 'utf8')
    await openUri(`warp://launch/${WARP_LAUNCH_CONFIG_NAME}`)
  }

  // Only the terminals can run a ticket's command; the editors in the allowlist
  // have no shell to run it in and keep the clipboard hand-off. Ghostty adds its
  // tabs to the window the app last opened while it is still open; the others
  // open one new window per launch with a tab per command.
  const COMMAND_RUNNERS: Record<string, (projectPath: string, tabs: TerminalTab[]) => Promise<unknown>> = {
    warp: openWarpWithCommands,
    terminal: openTerminalWithCommands,
    iterm2: openItermWithCommands,
    ghostty: openGhosttyWithCommands
  }

  const { attachmentsRoot } = dependencies
  // ponytail: one scan app-wide (every web tab included), per-caller controllers if parallel scans ever matter
  let activeScan: AbortController | null = null

  return {
    'project-state:get': (_payload, { repository }) => toPlainJson(repository.getState()),

    // Null when nothing outside this caller wrote since its last read, so the
    // renderer can call this freely without re-reading the whole database.
    'project-state:refresh': (_payload, { repository }) => {
      if (!repository.hasExternalChanges()) return null
      return toPlainJson(repository.getState())
    },

    'project-state:save': (state, { repository }) => {
      if (!isProjectTrackerState(state)) throw new Error('Invalid project state payload.')
      return toPlainJson(repository.saveState({
        ...state,
        scanDirectories: state.scanDirectories.map(normalizePath),
        hiddenPaths: state.hiddenPaths.map(normalizePath),
        thirdPartyPaths: state.thirdPartyPaths.map(normalizePath)
      }))
    },

    // Per-entity writes: ordinary edits send only the entity they touch. Each
    // returns the row as stored, never a state re-read; outside changes still
    // arrive through project-state:refresh.
    'ticket:create': (payload, { repository }) => {
      const { projectPath, ticket } = (payload ?? {}) as { projectPath?: unknown; ticket?: unknown }
      if (typeof projectPath !== 'string' || !isTicket(ticket)) throw new Error('Invalid ticket create payload.')
      return toPlainJson(repository.createTicket(normalizePath(projectPath), ticket))
    },

    'ticket:update': (payload, { repository }) => {
      const { id, patch } = (payload ?? {}) as { id?: unknown; patch?: unknown }
      if (typeof id !== 'string' || !isTicketPatch(patch)) throw new Error('Invalid ticket update payload.')
      return toPlainJson(repository.updateTicket(id, patch))
    },

    'ticket:delete': (payload, { repository }) => {
      const { id } = (payload ?? {}) as { id?: unknown }
      if (typeof id !== 'string') throw new Error('Invalid ticket delete payload.')
      repository.deleteTicket(id)
      // The row is already gone, so a cleanup failure must not report a failed delete.
      try {
        removeTicketImages(attachmentsRoot, id)
      } catch (error) {
        console.warn(`Could not remove attachments for ticket ${id}:`, error)
      }
    },

    // Pasted, dropped or (on the web) browser-picked image data, which has bytes
    // but no file path. IPC structured-clones a Uint8Array; the web server's JSON
    // body carries the same bytes as a base64 string.
    'ticket-images:save-bytes': (payload) => {
      const { ticketId, bytes, mimeType } = (payload ?? {}) as { ticketId?: unknown; bytes?: unknown; mimeType?: unknown }
      const imageBytes = typeof bytes === 'string' ? Buffer.from(bytes, 'base64') : bytes
      const isValidPayload = typeof ticketId === 'string' && imageBytes instanceof Uint8Array && typeof mimeType === 'string'
      if (!isValidPayload) throw new Error('Invalid ticket image payload.')
      return saveTicketImageBytes(attachmentsRoot, ticketId, imageBytes, mimeType)
    },

    'ticket-images:remove': (payload) => {
      const { ticketId, imagePath } = (payload ?? {}) as { ticketId?: unknown; imagePath?: unknown }
      if (typeof ticketId !== 'string' || typeof imagePath !== 'string') throw new Error('Invalid ticket image payload.')
      removeTicketImage(attachmentsRoot, ticketId, imagePath)
    },

    'ticket-images:open': async (payload) => {
      const imagePath = resolveAttachmentPath(attachmentsRoot, String(payload))
      if (!imagePath) throw new Error('Not a ticket image.')
      const failureMessage = await dependencies.openPath(imagePath)
      if (failureMessage) throw new Error(failureMessage)
    },

    'lane:create': (payload, { repository }) => {
      const { projectPath, lane } = (payload ?? {}) as { projectPath?: unknown; lane?: unknown }
      if (typeof projectPath !== 'string' || !isSwimLane(lane)) throw new Error('Invalid lane create payload.')
      return toPlainJson(repository.createSwimLane(normalizePath(projectPath), lane))
    },

    'lane:update': (payload, { repository }) => {
      const { projectPath, laneId, patch } = (payload ?? {}) as { projectPath?: unknown; laneId?: unknown; patch?: unknown }
      if (typeof projectPath !== 'string' || typeof laneId !== 'string' || !isLanePatch(patch)) {
        throw new Error('Invalid lane update payload.')
      }
      return toPlainJson(repository.updateSwimLane(normalizePath(projectPath), laneId, patch))
    },

    'lane:reorder': (payload, { repository }) => {
      const { projectPath, laneIds } = (payload ?? {}) as { projectPath?: unknown; laneIds?: unknown }
      if (typeof projectPath !== 'string' || !isStringArray(laneIds)) throw new Error('Invalid lane reorder payload.')
      repository.reorderSwimLanes(normalizePath(projectPath), laneIds)
    },

    'lane:delete': (payload, { repository }) => {
      const { projectPath, laneId } = (payload ?? {}) as { projectPath?: unknown; laneId?: unknown }
      if (typeof projectPath !== 'string' || typeof laneId !== 'string') throw new Error('Invalid lane delete payload.')
      repository.deleteSwimLane(normalizePath(projectPath), laneId)
    },

    'project:update': (payload, { repository }) => {
      const { path: projectPath, patch } = (payload ?? {}) as { path?: unknown; patch?: unknown }
      if (typeof projectPath !== 'string' || !isProjectPatch(patch)) throw new Error('Invalid project update payload.')
      return toPlainJson(repository.updateProject(normalizePath(projectPath), patch))
    },

    'projects:scan': async (payload, { onScanProgress, onPageGone }) => {
      const candidate = (payload ?? {}) as {
        scanDirectories?: unknown
        hiddenPaths?: unknown
        thirdPartyPaths?: unknown
      }
      if (
        !isStringArray(candidate.scanDirectories) ||
        !isStringArray(candidate.hiddenPaths) ||
        !isStringArray(candidate.thirdPartyPaths)
      ) {
        throw new Error('Invalid scan payload.')
      }

      if (activeScan) throw new Error('A scan is already running.')

      const scan = new AbortController()
      activeScan = scan
      // A cancelled walk can still be finishing an fs call after a newer scan starts;
      // its progress must not show up in the newer scan.
      const sendProgress = (progress: ScanProgress) => {
        if (activeScan === scan) onScanProgress(progress)
      }
      // A reload or window close drops the renderer's scanning state and its Cancel button, so a hung
      // scan would otherwise block every later scan until restart.
      const stopWatchingPage = onPageGone(() => scan.abort())
      try {
        const result = await scanProjectDirectories(
          candidate.scanDirectories.map(normalizePath),
          candidate.hiddenPaths.map(normalizePath),
          candidate.thirdPartyPaths.map(normalizePath),
          { signal: scan.signal, onProgress: sendProgress }
        )
        return toPlainJson(result)
      } finally {
        activeScan = null
        stopWatchingPage()
      }
    },

    'projects:scan-cancel': () => {
      activeScan?.abort()
    },

    'dialog:pick-scan-directory': async () => {
      const picked = await dependencies.pickDirectory()
      return picked === null ? null : normalizePath(picked)
    },

    'project:open-in': (payload, { repository }) => {
      const isMac = process.platform === 'darwin'
      return openProjectIn(payload, {
        assertScannedProjectPath: (projectPath) => assertScannedProjectPath(repository, projectPath),
        writeClipboard: (text) => void dependencies.writeClipboard(text),
        commandRunnerFor: (targetId) => (isMac ? COMMAND_RUNNERS[targetId] : undefined),
        openFolder: (appName, projectPath) => (isMac ? openWithApp(appName, projectPath) : dependencies.openPath(projectPath))
      })
    },

    // Commands come from the renderer, same trust as project:open-in: each one
    // carries its prompt single-quoted by ticketShellCommand. The target is
    // resolved against the runner table, so only a known terminal is launched.
    'lane:auto-run': async (payload, { repository }) => {
      const { projectPath, targetId, tickets, useWorktrees, orchestrator } = (payload ?? {}) as {
        projectPath?: unknown
        targetId?: unknown
        tickets?: unknown
        useWorktrees?: unknown
        orchestrator?: unknown
      }
      if (typeof projectPath !== 'string') throw new Error('Invalid project path.')
      if (!Array.isArray(tickets) || tickets.length === 0) throw new Error('No tickets to run.')
      if (!tickets.every(isAutoRunTicketLaunch)) throw new Error('Invalid Auto Run ticket.')
      const orchestratorLaunch = orchestratorTab(orchestrator)
      // hasOwn, not a bare index: 'constructor' would otherwise resolve to Object.
      const isKnownTerminal = typeof targetId === 'string' && Object.hasOwn(COMMAND_RUNNERS, targetId)
      const runCommands = isKnownTerminal ? COMMAND_RUNNERS[targetId] : undefined
      if (!runCommands || process.platform !== 'darwin') throw new Error(`Auto Run cannot use terminal: ${targetId}`)
      const normalized = assertScannedProjectPath(repository, projectPath)
      // Last tab, left in the project root (where every runner starts a tab) even
      // with worktrees on: it watches every ticket rather than working on one.
      const orchestratorTabs = orchestratorLaunch ? [orchestratorLaunch] : []

      if (useWorktrees !== true) {
        const ticketTabs = tickets.map((ticket) => ({
          command: ticket.command,
          title: usableTabTitle(ticket.title),
          exitWithCommand: true
        }))
        await runCommands(normalized, [...ticketTabs, ...orchestratorTabs])
        return { worktreePaths: [] }
      }

      // Fetched once for the whole lane. Worktrees are made one at a time: git
      // locks the repository's worktree list, so parallel adds would trip on it.
      const repositoryRoot = await repositoryRootOf(normalized)
      const baseRef = await freshMainRef(repositoryRoot)
      const worktreePaths: string[] = []
      for (const ticket of tickets) {
        const worktreePath = await ensureTicketWorktree(repositoryRoot, ticket.number, ticket.branchName, baseRef)
        worktreePaths.push(worktreePath)
      }
      const tabsInWorktrees = tickets.map((ticket, index) => ({
        command: `cd ${shellQuote(worktreePaths[index])} && ${ticket.command}`,
        title: usableTabTitle(ticket.title),
        exitWithCommand: true
      }))
      await runCommands(normalized, [...tabsInWorktrees, ...orchestratorTabs])
      return { worktreePaths }
    },

    'ticket:run-agent': async (payload, { repository, onAgentRetry }) => {
      const { projectPath, agentId, prompt, model, sessionId } = (payload ?? {}) as {
        projectPath?: unknown
        agentId?: unknown
        prompt?: unknown
        model?: unknown
        sessionId?: unknown
      }
      if (typeof projectPath !== 'string') throw new Error('Invalid project path.')
      if (typeof agentId !== 'string') throw new Error('Invalid agent.')
      if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Invalid agent prompt.')
      if (model !== undefined && typeof model !== 'string') throw new Error('Invalid agent model.')
      if (sessionId !== undefined && !isUuid(sessionId)) throw new Error('Invalid agent session id.')
      // Resolved by id against known agents rather than taking a command from the
      // payload, so the renderer can pick which agent runs but never what binary.
      const agent = availableAgents(repository.getState()).find((entry) => entry.id === agentId)
      if (!agent) throw new Error(`Unknown agent: ${agentId}`)
      const normalized = assertScannedProjectPath(repository, projectPath)
      const onRetry = (notice: { attempt: number; of: number; delayMs: number }) => onAgentRetry({ sessionId, ...notice })
      const options = { model, sessionId, onRetry }
      return toPlainJson(await runAgentHeadlessWithRetry(agent, prompt, normalized, dependencies.homeDirectory, options))
    },

    'app:started-at': () => dependencies.startedAt,

    // Read-only: lists tab titles, never launches or touches a terminal.
    'terminal:tabs-alive': async (payload) => {
      const { targetId, titles } = (payload ?? {}) as { targetId?: unknown; titles?: unknown }
      if (typeof targetId !== 'string' || !isStringArray(titles)) throw new Error('Invalid tab check.')
      const listArgs = process.platform === 'darwin' ? tabTitlesOsascriptArgs(targetId) : undefined
      if (!listArgs) return tabLiveness(undefined, titles)
      const listing = await run('osascript', listArgs).catch(() => undefined)
      const openTitles = listing === undefined ? undefined : listing.split('\n').filter(Boolean)
      return tabLiveness(openTitles, titles)
    },

    // Computed live on every call: nothing is cached or stored, so an open of the
    // panel always shows current numbers. One repo failing only blanks its own row.
    'metrics:get': async (payload, { repository }) => {
      const requestedPaths = (payload as { projectPaths?: unknown } | null)?.projectPaths
      if (!isStringArray(requestedPaths)) throw new Error('Invalid project paths.')

      const windows = metricWindows(new Date())
      const normalizedPaths = requestedPaths.map(normalizePath)
      const projects = repository.closedTicketMetrics(normalizedPaths, windows)
      const projectPaths = projects.map((project) => project.projectPath)

      const prsFor = async (githubUrl: string | undefined) => {
        if (!githubUrl) return undefined
        try {
          const { owner, repo } = parseGithubRepo(githubUrl)
          return await prCounts(owner, repo, windows, requestGithub)
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      }
      const agentCountsRequest = runningAgentsByProject(projectPaths).catch(() => undefined)
      const prRequests = Promise.all(projects.map((project) => prsFor(project.githubUrl)))
      const [agentCounts, prs] = await Promise.all([agentCountsRequest, prRequests])

      return projects.map(({ githubUrl: _githubUrl, ...project }, index) => ({
        ...project,
        prs: prs[index],
        agentsRunning: agentCounts ? agentCounts[project.projectPath] : null
      }))
    },

    'project:fetch-github': async (githubUrl) => {
      if (typeof githubUrl !== 'string') throw new Error('Invalid GitHub URL.')
      const { owner, repo } = parseGithubRepo(githubUrl)

      const data = await requestGithub<{
        default_branch?: string
        open_issues_count?: number
        stargazers_count?: number
        forks_count?: number
        description?: string | null
        pushed_at?: string
      }>(`/repos/${owner}/${repo}`)

      return toPlainJson({
        defaultBranch: data.default_branch ?? 'main',
        openIssues: data.open_issues_count ?? 0,
        stars: data.stargazers_count ?? 0,
        forks: data.forks_count ?? 0,
        description: data.description ?? undefined,
        pushedAt: data.pushed_at,
        fetchedAt: new Date().toISOString()
      })
    },

    // A pasted PR URL wins and is read against its own repo; otherwise the newest
    // PR opened from the ticket's branch. Assumes that branch lives in the same
    // repo — PRs from forks are not found. A saved URL is also what an earlier
    // branch lookup leaves behind, so a closed PR from the ticket's own branch
    // falls through to the lookup to pick up a newer PR reopened on that branch.
    'ticket:fetch-pull-request': async (payload) => {
      const { githubUrl, branchName, pullRequestUrl } = (payload ?? {}) as Record<string, unknown>
      if (typeof githubUrl !== 'string') throw new Error('Invalid GitHub URL.')
      if (typeof branchName !== 'string') throw new Error('Invalid branch name.')
      if (pullRequestUrl !== undefined && typeof pullRequestUrl !== 'string') {
        throw new Error('Invalid pull request URL.')
      }

      if (pullRequestUrl) {
        const pastedNumber = pullRequestNumber(pullRequestUrl)
        // ponytail: only github.com is looked up; GitLab or Enterprise URLs stay plain links.
        const isGithubDotCom = pullRequestUrl.trim().startsWith('https://github.com/')
        if (!pastedNumber || !isGithubDotCom) return null
        const pastedRepo = parseGithubRepo(pullRequestUrl)
        const pullRequest = await requestGithub<GithubPullRequest>(
          `/repos/${pastedRepo.owner}/${pastedRepo.repo}/pulls/${pastedNumber}`
        )
        const pastedStatus = toPullRequestStatus(pullRequest)
        const isFromTicketBranch = pullRequest.head?.ref === branchName
        const mayHaveSuccessor = pastedStatus.state === 'closed' && isFromTicketBranch
        if (!mayHaveSuccessor) return toPlainJson(pastedStatus)
      }

      const { owner, repo } = parseGithubRepo(githubUrl)
      const head = encodeURIComponent(`${owner}:${branchName}`)
      const query = `head=${head}&state=all&sort=created&direction=desc&per_page=1`
      const [newestPullRequest] = await requestGithub<GithubPullRequest[]>(`/repos/${owner}/${repo}/pulls?${query}`)
      return newestPullRequest ? toPlainJson(toPullRequestStatus(newestPullRequest)) : null
    },

    'project:fetch-github-issues': async (request) => {
      const { githubUrl, since } = (request ?? {}) as Record<string, unknown>
      if (typeof githubUrl !== 'string') throw new Error('Invalid GitHub URL.')
      const sinceIsValid = since === undefined || (typeof since === 'string' && !Number.isNaN(Date.parse(since)))
      if (!sinceIsValid) throw new Error('Invalid since date.')
      const { owner, repo } = parseGithubRepo(githubUrl)

      type GithubIssueResponse = {
        number: number
        title: string
        body?: string | null
        html_url: string
        state_reason?: string | null
        pull_request?: unknown
      }

      // ponytail: 5 pages (500 issues per state) is far past any board that stays
      // readable. Raise the cap if a real repo ever hits it.
      const MAX_PAGES = 5
      const PER_PAGE = 100
      const fetchIssuePages = async (stateQuery: string) => {
        const issues: GithubIssueResponse[] = []
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const query = `${stateQuery}&per_page=${PER_PAGE}&page=${page}`
          const batch = await requestGithub<GithubIssueResponse[]>(`/repos/${owner}/${repo}/issues?${query}`)
          issues.push(...batch)
          if (batch.length < PER_PAGE) break
        }
        // The issues endpoint returns pull requests too; only real issues become tickets.
        return issues.filter((issue) => !issue.pull_request)
      }
      const toIssue = (issue: GithubIssueResponse) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? '',
        htmlUrl: issue.html_url
      })

      // No `since` means no imported tickets yet, so there is nothing a closed issue could update.
      // Newest-updated first, so a recently closed old issue lands inside the page cap.
      const closedQuery = `state=closed&sort=updated&direction=desc&since=${encodeURIComponent(String(since))}`
      const [openIssues, closedIssues] = await Promise.all([
        fetchIssuePages('state=open'),
        since ? fetchIssuePages(closedQuery) : []
      ])
      return toPlainJson({
        open: openIssues.map(toIssue),
        closed: closedIssues.map((issue) => ({ ...toIssue(issue), stateReason: issue.state_reason ?? null }))
      })
    },

    'project:read-readme': (projectPath, { repository }) => {
      if (typeof projectPath !== 'string') throw new Error('Invalid project path.')
      const normalized = assertScannedProjectPath(repository, projectPath)
      if (!statSync(normalized).isDirectory()) throw new Error('Project path is not a directory.')

      const readmeName = readdirSync(normalized).find((entry) => /^readme(\.|$)/i.test(entry))
      if (!readmeName) return { content: null, fileName: null }

      const readmePath = path.join(normalized, readmeName)
      if (!statSync(readmePath).isFile()) return { content: null, fileName: null }
      return toPlainJson({ content: readFileSync(readmePath, 'utf8'), fileName: readmeName })
    },

    'lane:save-agent-markdown': (request, { repository }) => {
      const { kind, projectPath, laneName, filePath: requestedFilePath, content, previousContent } = (request ?? {}) as Record<
        string,
        unknown
      >
      const fields = [projectPath, laneName, requestedFilePath, content, previousContent]
      const fieldsAreStrings = fields.every((field) => typeof field === 'string')
      const kindIsKnown = kind === 'agent' || kind === 'orchestrator'
      if (!fieldsAreStrings || !kindIsKnown) throw new Error('Invalid save request.')

      const normalized = assertScannedProjectPath(repository, projectPath as string)
      const project = repository.getState().snapshot.projects.find((entry) => normalizePath(entry.path) === normalized)
      if (!project) throw new Error('Unknown project.')

      const target = {
        kind: kind as LaneMarkdownKind,
        projectPath: normalized,
        laneName: laneName as string,
        filePath: requestedFilePath as string
      }
      // Same boundary as every other path IPC: keeps a typed path from reaching
      // agent config outside the projects, e.g. ~/.claude/CLAUDE.md.
      const filePath = resolveAgentMarkdownPath(target)
      if (!isInsideAny(filePath, scanDirectoriesOf(repository))) {
        throw new Error('Markdown file must be inside a scanned directory.')
      }
      // The orchestrator file is a copy the launch never reads, so it is replaced
      // freely: its generated text changes with the app, which a check would
      // mistake for a hand edit and refuse forever.
      const guardedPreviousContent = kind === 'agent' ? (previousContent as string) : null
      return saveAgentMarkdown(filePath, content as string, guardedPreviousContent)
    }
  }
}
