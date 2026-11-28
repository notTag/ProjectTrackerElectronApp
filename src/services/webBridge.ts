import type { IpcChannel, ProjectTrackerBridge } from '@/shared/bridgeApi'
import type { AgentRetryEvent, ScanProgress } from '@/shared/projectTypes'

// window.projectTracker for the web build: each method posts the same payload
// electron/preload.cts sends over IPC to the local server (electron/web/server.ts),
// which runs it through the same handlers. Keep the two files line for line.

// One id per page load: the server keeps a repository (and diff baseline) per
// id. Not kept across reloads on purpose: a reload re-reads state anyway, and a
// duplicated tab would share sessionStorage and so share one baseline.
const clientId = crypto.randomUUID()

const invoke = async <T>(channel: IpcChannel, payload?: unknown): Promise<T> => {
  const response = await fetch(`/api/invoke/${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId },
    body: payload === undefined ? '' : JSON.stringify(payload)
  })
  // A non-JSON reply (a crash page) must still surface its status, not a SyntaxError.
  const body = (await response.json().catch(() => ({}))) as { result?: T; error?: string }
  // Same message the IPC path carries, so substring checks like
  // isGithubUnreachableError keep matching.
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${response.status}`)
  return body.result as T
}

type ServerEvent = 'external-change' | 'agent-retry' | 'scan-progress'
const listeners: Record<ServerEvent, Set<(data: unknown) => void>> = {
  'external-change': new Set(),
  'agent-retry': new Set(),
  'scan-progress': new Set()
}
let events: EventSource | undefined

// Opened on first subscribe, shared by every listener. EventSource reconnects
// on its own after a server restart.
const subscribe = (event: ServerEvent, listener: (data: unknown) => void) => {
  if (!events) {
    events = new EventSource(`/api/events?client=${clientId}`)
    for (const name of Object.keys(listeners) as ServerEvent[]) {
      events.addEventListener(name, (message) => {
        const data: unknown = JSON.parse((message as MessageEvent<string>).data)
        for (const callback of listeners[name]) callback(data)
      })
    }
  }
  listeners[event].add(listener)
  return () => {
    listeners[event].delete(listener)
  }
}

// btoa takes a binary string; built in chunks so a 20 MB image doesn't overflow
// String.fromCharCode's argument limit.
const toBase64 = (bytes: Uint8Array) => {
  const CHUNK_SIZE = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

const saveTicketImageBytes = (ticketId: string, bytes: Uint8Array, mimeType: string) =>
  invoke<string>('ticket-images:save-bytes', { ticketId, bytes: toBase64(bytes), mimeType })

// The browser's own file picker: it can't return paths, so files go up as bytes.
const chooseImageFiles = () =>
  new Promise<File[]>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/png,image/jpeg,image/gif,image/webp'
    input.addEventListener('change', () => resolve([...(input.files ?? [])]))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })

const pickTicketImages = async (ticketId: string) => {
  const files = await chooseImageFiles()
  const saves = files.map(async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    return saveTicketImageBytes(ticketId, bytes, file.type)
  })
  return Promise.all(saves)
}

export const webBridge = {
  getProjectState: () => invoke('project-state:get'),
  saveProjectState: (state) => invoke('project-state:save', state),
  refreshProjectState: () => invoke('project-state:refresh'),
  createTicket: (projectPath, ticket) => invoke('ticket:create', { projectPath, ticket }),
  updateTicket: (id, patch) => invoke('ticket:update', { id, patch }),
  deleteTicket: (id) => invoke('ticket:delete', { id }),
  pickTicketImages,
  saveTicketImageBytes,
  removeTicketImage: (ticketId, imagePath) => invoke('ticket-images:remove', { ticketId, imagePath }),
  openTicketImage: (imagePath) => invoke('ticket-images:open', imagePath),
  ticketImageUrl: (imagePath) => `/api/ticket-image/${encodeURIComponent(imagePath)}`,
  createLane: (projectPath, lane) => invoke('lane:create', { projectPath, lane }),
  updateLane: (projectPath, laneId, patch) => invoke('lane:update', { projectPath, laneId, patch }),
  reorderLanes: (projectPath, laneIds) => invoke('lane:reorder', { projectPath, laneIds }),
  deleteLane: (projectPath, laneId) => invoke('lane:delete', { projectPath, laneId }),
  activateWorkflow: (projectPath, workflowId) => invoke('workflow:activate', { projectPath, workflowId }),
  createWorkflow: (projectPath, name) => invoke('workflow:create', { projectPath, name }),
  listLaneStore: () => invoke('lane-store:list'),
  saveLaneToStore: (projectPath, laneId) => invoke('lane-store:save', { projectPath, laneId }),
  deleteLaneStoreEntry: (entryId) => invoke('lane-store:delete', { entryId }),
  addLaneFromStore: (projectPath, entryId) => invoke('lane-store:add', { projectPath, entryId }),
  updateProject: (path, patch) => invoke('project:update', { path, patch }),
  onExternalChange: (callback) => subscribe('external-change', () => callback()),
  scanProjectDirectories: (scanDirectories, hiddenPaths, thirdPartyPaths) =>
    invoke('projects:scan', { scanDirectories, hiddenPaths, thirdPartyPaths }),
  onScanProgress: (callback) => subscribe('scan-progress', (progress) => callback(progress as ScanProgress)),
  cancelScan: () => invoke('projects:scan-cancel'),
  pickScanDirectory: () => invoke('dialog:pick-scan-directory'),
  openProjectIn: (projectPath, targetId, command, title) =>
    invoke('project:open-in', { projectPath, targetId, command, title }),
  autoRunLane: (projectPath, targetId, tickets, useWorktrees, orchestrator) =>
    invoke('lane:auto-run', { projectPath, targetId, tickets, useWorktrees, orchestrator }),
  prepareTicketWorktrees: (projectPath, tickets) => invoke('lane:prepare-worktrees', { projectPath, tickets }),
  runTicketAgent: (projectPath, agentId, prompt, model, sessionId, cwd) =>
    invoke('ticket:run-agent', { projectPath, agentId, prompt, model, sessionId, cwd }),
  onAgentRetry: (callback) => subscribe('agent-retry', (notice) => callback(notice as AgentRetryEvent)),
  appStartedAt: () => invoke('app:started-at'),
  terminalTabsAlive: (targetId, titles) => invoke('terminal:tabs-alive', { targetId, titles }),
  readProjectReadme: (projectPath) => invoke('project:read-readme', projectPath),
  saveLaneMarkdown: (projectPath, laneName, filePath, content, previousContent) =>
    invoke('lane:save-agent-markdown', { projectPath, laneName, filePath, content, previousContent }),
  readLaneOrchestratorContext: (projectPath, laneName, filePath) =>
    invoke('lane:read-orchestrator-context', { projectPath, laneName, filePath }),
  fetchProjectGithub: (githubUrl) => invoke('project:fetch-github', githubUrl),
  getMetrics: (projectPaths) => invoke('metrics:get', { projectPaths }),
  fetchProjectGithubIssues: (githubUrl, since) => invoke('project:fetch-github-issues', { githubUrl, since }),
  fetchTicketPullRequest: (githubUrl, branchName, pullRequestUrl) =>
    invoke('ticket:fetch-pull-request', { githubUrl, branchName, pullRequestUrl })
} satisfies ProjectTrackerBridge
