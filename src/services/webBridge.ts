import type { IpcChannel, ProjectTrackerBridge } from '@/shared/bridgeApi'
import type { AgentRetryEvent } from '@/shared/projectTypes'

// window.projectTracker for the web build: each method posts the same payload
// electron/preload.cts sends over IPC to the local server (electron/web/server.ts),
// which runs it through the same handlers. Keep the two files line for line.

// One id per tab: the server keeps a repository (and diff baseline) per id.
const clientId = crypto.randomUUID()

const invoke = async <T>(channel: IpcChannel, payload?: unknown): Promise<T> => {
  const response = await fetch(`/api/invoke/${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId },
    body: payload === undefined ? '' : JSON.stringify(payload)
  })
  const body = (await response.json()) as { result?: T; error?: string }
  // Same message the IPC path carries, so substring checks like
  // isGithubUnreachableError keep matching.
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${response.status}`)
  return body.result as T
}

type ServerEvent = 'external-change' | 'agent-retry'
const listeners: Record<ServerEvent, Set<(data: unknown) => void>> = {
  'external-change': new Set(),
  'agent-retry': new Set()
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

export const webBridge = {
  getProjectState: () => invoke('project-state:get'),
  saveProjectState: (state) => invoke('project-state:save', state),
  refreshProjectState: () => invoke('project-state:refresh'),
  createTicket: (projectPath, ticket) => invoke('ticket:create', { projectPath, ticket }),
  updateTicket: (id, patch) => invoke('ticket:update', { id, patch }),
  deleteTicket: (id) => invoke('ticket:delete', { id }),
  createLane: (projectPath, lane) => invoke('lane:create', { projectPath, lane }),
  updateLane: (projectPath, laneId, patch) => invoke('lane:update', { projectPath, laneId, patch }),
  reorderLanes: (projectPath, laneIds) => invoke('lane:reorder', { projectPath, laneIds }),
  deleteLane: (projectPath, laneId) => invoke('lane:delete', { projectPath, laneId }),
  updateProject: (path, patch) => invoke('project:update', { path, patch }),
  onExternalChange: (callback) => subscribe('external-change', () => callback()),
  scanProjectDirectories: (scanDirectories, hiddenPaths, thirdPartyPaths) =>
    invoke('projects:scan', { scanDirectories, hiddenPaths, thirdPartyPaths }),
  pickScanDirectory: () => invoke('dialog:pick-scan-directory'),
  openProjectIn: (projectPath, targetId, command, title) =>
    invoke('project:open-in', { projectPath, targetId, command, title }),
  autoRunLane: (projectPath, targetId, tickets, useWorktrees, orchestrator) =>
    invoke('lane:auto-run', { projectPath, targetId, tickets, useWorktrees, orchestrator }),
  runTicketAgent: (projectPath, agentId, prompt, model, sessionId) =>
    invoke('ticket:run-agent', { projectPath, agentId, prompt, model, sessionId }),
  onAgentRetry: (callback) => subscribe('agent-retry', (notice) => callback(notice as AgentRetryEvent)),
  appStartedAt: () => invoke('app:started-at'),
  terminalTabsAlive: (targetId, titles) => invoke('terminal:tabs-alive', { targetId, titles }),
  readProjectReadme: (projectPath) => invoke('project:read-readme', projectPath),
  saveLaneAgentMarkdown: (projectPath, laneName, agentFilePath, content) =>
    invoke('lane:save-agent-markdown', { projectPath, laneName, agentFilePath, content }),
  fetchProjectGithub: (githubUrl) => invoke('project:fetch-github', githubUrl),
  getMetrics: (projectPaths) => invoke('metrics:get', { projectPaths }),
  fetchProjectGithubIssues: (githubUrl, since) => invoke('project:fetch-github-issues', { githubUrl, since }),
  fetchTicketPullRequest: (githubUrl, branchName, pullRequestUrl) =>
    invoke('ticket:fetch-pull-request', { githubUrl, branchName, pullRequestUrl })
} satisfies ProjectTrackerBridge
