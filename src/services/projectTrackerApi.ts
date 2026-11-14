import { toPlainJson } from '@/shared/plainJson'
import {
  nextTicketNumber,
  orderedIds,
  updateLaneInBoard,
  type AutoRunTicketLaunch,
  type Clearable,
  type ProjectBoard,
  type ProjectRecord,
  type ProjectTrackerState,
  type ProjectWritePatch,
  type ScanResult,
  type SwimLane,
  type TerminalTab,
  type Ticket
} from '@/shared/projectTypes'

const jsonHeaders = { 'Content-Type': 'application/json' }

const FALLBACK_STATE_KEY = 'project-tracker-state'

const readFallbackState = (): ProjectTrackerState => {
  const stored = localStorage.getItem(FALLBACK_STATE_KEY)
  if (!stored) throw new Error('No browser fallback state exists yet.')
  return JSON.parse(stored) as ProjectTrackerState
}

const writeFallbackState = (state: ProjectTrackerState) =>
  localStorage.setItem(FALLBACK_STATE_KEY, JSON.stringify(toPlainJson(state)))

// ponytail: the browser fallback has one writer, so a per-entity call just
// rewrites the stored state with the change applied. null projectPath edits
// every board (ticket calls only know the ticket id).
const editFallbackBoards = (projectPath: string | null, edit: (board: ProjectBoard) => ProjectBoard) => {
  const state = readFallbackState()
  const boards = { ...state.boards }
  const projectPaths = projectPath ? [projectPath] : Object.keys(boards)
  for (const path of projectPaths) boards[path] = edit(boards[path] ?? { lanes: [], tickets: [] })
  writeFallbackState({ ...state, boards })
}

// JSON drops undefined keys, so a cleared field has to cross IPC as null.
const withNullClears = <T extends object>(patch: T): Clearable<T> => {
  const entries = Object.entries(patch).map(([key, value]) => [key, value === undefined ? null : value])
  return Object.fromEntries(entries) as Clearable<T>
}

type TicketPatch = Partial<Omit<Ticket, 'id' | 'number' | 'createdAt'>>
type LanePatch = Partial<Omit<SwimLane, 'id'>>

const requireElectron = () => {
  if (!window.projectTracker) {
    throw new Error('Project Tracker desktop APIs are unavailable in this environment.')
  }
  return window.projectTracker
}

export const projectTrackerApi = {
  async getProjectState() {
    if (window.projectTracker) return window.projectTracker.getProjectState()
    return readFallbackState()
  },

  async saveProjectState(state: ProjectTrackerState) {
    const plainState = toPlainJson(state)
    if (window.projectTracker) return window.projectTracker.saveProjectState(plainState)
    writeFallbackState(plainState)
    return plainState
  },

  async createTicket(projectPath: string, ticket: Ticket): Promise<Ticket> {
    const { number: _provisionalNumber, ...unnumbered } = ticket
    if (window.projectTracker) return window.projectTracker.createTicket(projectPath, toPlainJson(unnumbered))
    let created = ticket
    editFallbackBoards(projectPath, (board) => {
      created = { ...ticket, number: nextTicketNumber(board) }
      return { ...board, tickets: [...board.tickets, created] }
    })
    return created
  },

  // Like the repository: stamps updatedAt unless the patch names it.
  async updateTicket(id: string, patch: TicketPatch): Promise<Ticket> {
    if (window.projectTracker) return window.projectTracker.updateTicket(id, toPlainJson(withNullClears(patch)))
    const stamp = 'updatedAt' in patch ? {} : { updatedAt: new Date().toISOString() }
    let updated: Ticket | undefined
    editFallbackBoards(null, (board) => {
      const current = board.tickets.find((ticket) => ticket.id === id)
      if (!current) return board
      const updatedTicket = { ...current, ...patch, ...stamp }
      updated = updatedTicket
      const tickets = board.tickets.map((ticket) => (ticket.id === id ? updatedTicket : ticket))
      return { ...board, tickets }
    })
    if (!updated) throw new Error(`Ticket ${id} does not exist.`)
    return updated
  },

  async deleteTicket(id: string): Promise<void> {
    if (window.projectTracker) return window.projectTracker.deleteTicket(id)
    editFallbackBoards(null, (board) => ({ ...board, tickets: board.tickets.filter((ticket) => ticket.id !== id) }))
  },

  async createLane(projectPath: string, lane: SwimLane): Promise<SwimLane> {
    if (window.projectTracker) return window.projectTracker.createLane(projectPath, toPlainJson(lane))
    editFallbackBoards(projectPath, (board) => ({ ...board, lanes: [...board.lanes, lane] }))
    return lane
  },

  async updateLane(projectPath: string, laneId: string, patch: LanePatch): Promise<SwimLane> {
    if (window.projectTracker) {
      return window.projectTracker.updateLane(projectPath, laneId, toPlainJson(withNullClears(patch)))
    }
    let updated: SwimLane | undefined
    editFallbackBoards(projectPath, (board) => {
      const next = updateLaneInBoard(board, laneId, patch)
      updated = next.unassignedLane?.id === laneId ? next.unassignedLane : next.lanes.find((lane) => lane.id === laneId)
      return next
    })
    if (!updated) throw new Error(`Lane ${laneId} does not exist.`)
    return updated
  },

  async reorderLanes(projectPath: string, laneIds: string[]): Promise<void> {
    if (window.projectTracker) return window.projectTracker.reorderLanes(projectPath, [...laneIds])
    editFallbackBoards(projectPath, (board) => {
      const laneById = new Map(board.lanes.map((lane) => [lane.id, lane]))
      const order = orderedIds([...laneById.keys()], laneIds)
      return { ...board, lanes: order.map((laneId) => laneById.get(laneId)!) }
    })
  },

  async deleteLane(projectPath: string, laneId: string): Promise<void> {
    if (window.projectTracker) return window.projectTracker.deleteLane(projectPath, laneId)
    editFallbackBoards(projectPath, (board) => ({ ...board, lanes: board.lanes.filter((lane) => lane.id !== laneId) }))
  },

  async updateProject(path: string, patch: ProjectWritePatch): Promise<ProjectRecord> {
    if (window.projectTracker) return window.projectTracker.updateProject(path, toPlainJson(patch))
    const state = readFallbackState()
    const project = state.snapshot.projects.find((entry) => entry.path === path)
    if (!project) throw new Error(`Project ${path} does not exist.`)
    const updated = { ...project, ...patch }
    const projects = state.snapshot.projects.map((entry) => (entry.path === path ? updated : entry))
    writeFallbackState({ ...state, snapshot: { ...state.snapshot, projects } })
    return updated
  },

  // The browser fallback has no other writers, so there is never anything new.
  async refreshProjectState(): Promise<ProjectTrackerState | null> {
    if (window.projectTracker) return window.projectTracker.refreshProjectState()
    return null
  },

  onExternalChange(callback: () => void): () => void {
    if (window.projectTracker) return window.projectTracker.onExternalChange(callback)
    return () => undefined
  },

  async scanProjectDirectories(
    scanDirectories: string[],
    hiddenPaths: string[],
    thirdPartyPaths: string[]
  ): Promise<ScanResult> {
    const plainScanDirectories = [...scanDirectories]
    const plainHiddenPaths = [...hiddenPaths]
    const plainThirdPartyPaths = [...thirdPartyPaths]

    if (window.projectTracker) {
      return window.projectTracker.scanProjectDirectories(plainScanDirectories, plainHiddenPaths, plainThirdPartyPaths)
    }
    const response = await fetch('/api/project-scan', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        scanDirectories: plainScanDirectories,
        hiddenPaths: plainHiddenPaths,
        thirdPartyPaths: plainThirdPartyPaths
      })
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json() as Promise<ScanResult>
  },

  pickScanDirectory() {
    return requireElectron().pickScanDirectory()
  },

  openProjectIn(path: string, targetId: string, command?: string, title?: string) {
    return requireElectron().openProjectIn(path, targetId, command, title)
  },

  autoRunLane(
    path: string,
    targetId: string,
    tickets: AutoRunTicketLaunch[],
    useWorktrees: boolean,
    orchestrator?: TerminalTab
  ) {
    return requireElectron().autoRunLane(path, targetId, tickets, useWorktrees, orchestrator)
  },

  runTicketAgent(path: string, agentId: string, prompt: string, model?: string) {
    return requireElectron().runTicketAgent(path, agentId, prompt, model)
  },

  readProjectReadme(path: string) {
    return requireElectron().readProjectReadme(path)
  },
  saveLaneAgentMarkdown(projectPath: string, laneName: string, agentFilePath: string, content: string) {
    return requireElectron().saveLaneAgentMarkdown(projectPath, laneName, agentFilePath, content)
  },

  fetchProjectGithub(githubUrl: string) {
    return requireElectron().fetchProjectGithub(githubUrl)
  },

  getMetrics(projectPaths: string[]) {
    return requireElectron().getMetrics(projectPaths)
  },
  fetchProjectGithubIssues(githubUrl: string) {
    return requireElectron().fetchProjectGithubIssues(githubUrl)
  },

  fetchTicketPullRequest(githubUrl: string, branchName: string, pullRequestUrl?: string) {
    return requireElectron().fetchTicketPullRequest(githubUrl, branchName, pullRequestUrl)
  }
}
