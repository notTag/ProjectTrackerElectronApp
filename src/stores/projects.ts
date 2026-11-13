import { defineStore } from 'pinia'

import { projectTrackerApi } from '@/services/projectTrackerApi'
import { resolveAutoRunTerminal } from '@/shared/openInTargets'
import { useOpenInStore } from '@/stores/openIn'
import {
  addGithubIssuesToBoard,
  autoRunUsesWorktrees,
  availableAgents,
  buildAutoRunLaunch,
  completionMoves,
  findAgent,
  fullAutoHandoffs,
  addScanDirectory,
  addTicketToBoard,
  createSeedState,
  getBoard,
  getBoardPreferences,
  isPullRequestSettled,
  mergeScannedProjects,
  moveLaneInBoard,
  removeLaneFromBoard,
  removeScanDirectory,
  ticketBranchName,
  updateLaneInBoard,
  type AutoRunTicketLaunch,
  type TerminalTab,
  type CompletionMove,
  type FullAutoHandoff,
  type BoardPreferences,
  type ProjectBoard,
  type ProjectPriority,
  type ProjectRecord,
  type ProjectStatus,
  type ProjectTrackerState,
  type SwimLane,
  type Ticket
} from '@/shared/projectTypes'

interface ProjectsStoreState {
  state: ProjectTrackerState
  loading: boolean
  scanning: boolean
  saving: boolean
  error: string | null
  notice: string | null
  readmes: Record<string, { loading: boolean; content: string | null; fileName: string | null; error: string | null }>
  githubLoading: Record<string, boolean>
  // Keyed by ticket id. Lives in the store, not the board view, so a run keeps
  // showing as running after the user leaves the board and comes back.
  agentRunning: Record<string, boolean>
  // Keyed by lane id: a lane mid-launch can't be launched again by a second click.
  autoRunning: Record<string, boolean>
}

const unique = (values: string[]) => [...new Set(values.filter(Boolean))]
let saveQueue = Promise.resolve()

interface ProjectHandoffs {
  projectPath: string
  handoffs: FullAutoHandoff[]
}

// A ticket whose lane differs between what this window last held (or just
// wrote) and a fresh read was moved by someone else: an agent writing to the
// DB. Moves made in this window are already in `before`, so they never count.
const handoffsBetween = (before: ProjectTrackerState, after: ProjectTrackerState): ProjectHandoffs[] => {
  const projectPaths = Object.keys(after.boards ?? {})
  const perProject = projectPaths.map((projectPath) => ({
    projectPath,
    handoffs: fullAutoHandoffs(getBoard(before, projectPath), getBoard(after, projectPath))
  }))
  return perProject.filter((entry) => entry.handoffs.length > 0)
}

interface ProjectCompletionMoves {
  projectPath: string
  moves: CompletionMove[]
}

// Returns `after` itself when no ticket completed with Move to armed, so
// callers can tell whether there is anything extra to write.
const withCompletionMoves = (
  before: ProjectTrackerState,
  after: ProjectTrackerState,
  alsoCompletedIds: string[] = []
): { state: ProjectTrackerState; moved: ProjectCompletionMoves[] } => {
  let state = after
  const moved: ProjectCompletionMoves[] = []
  for (const projectPath of Object.keys(after.boards ?? {})) {
    const nextBoard = getBoard(after, projectPath)
    const result = completionMoves(getBoard(before, projectPath), nextBoard, alsoCompletedIds)
    if (result.board === nextBoard) continue
    state = { ...state, boards: { ...state.boards, [projectPath]: result.board } }
    if (result.moves.length > 0) moved.push({ projectPath, moves: result.moves })
  }
  return { state, moved }
}

const completionMovesNotice = (moved: ProjectCompletionMoves[]): string | null => {
  const allMoves = moved.flatMap((entry) => entry.moves)
  if (allMoves.length === 0) return null
  return allMoves.map(({ ticket, toLane }) => `Moved #${ticket.number} to ${toLane.name}.`).join(' ')
}

// One autoRunLane call per lane and worktree choice, so a lane with worktrees
// off only creates worktrees for tickets that already have one.
const groupByLaunch = (toLaneHandoffs: FullAutoHandoff[]): FullAutoHandoff[][] => {
  const groups = new Map<string, FullAutoHandoff[]>()
  for (const handoff of toLaneHandoffs) {
    const useWorktrees = autoRunUsesWorktrees(handoff.toLane, handoff.ticket)
    const groupKey = `${handoff.toLane.id}:${useWorktrees}`
    const group = groups.get(groupKey) ?? []
    group.push(handoff)
    groups.set(groupKey, group)
  }
  return [...groups.values()]
}

// Lane ids repeat across projects (every board has `in-pr`), so a run is keyed by both.
const autoRunKey = (projectPath: string, laneId: string) => `${projectPath}\n${laneId}`

// Handoffs that arrived while their lane was launching. The move is already in
// state, so no later diff would see it again: they run when the lane frees up.
const deferredHandoffs = new Map<string, ProjectHandoffs>()

const deferHandoffs = (projectPath: string, handoffs: FullAutoHandoff[]) => {
  const runKey = autoRunKey(projectPath, handoffs[0].toLane.id)
  const deferred = deferredHandoffs.get(runKey) ?? { projectPath, handoffs: [] }
  deferred.handoffs.push(...handoffs)
  deferredHandoffs.set(runKey, deferred)
}

const takeDeferredHandoffs = (runKey: string): ProjectHandoffs | undefined => {
  const deferred = deferredHandoffs.get(runKey)
  deferredHandoffs.delete(runKey)
  return deferred
}

// Outside Pinia state so it is never persisted: a fresh app launch pulls again.
const autoPulledProjects = new Set<string>()

type StateUpdate = (currentState: ProjectTrackerState) => ProjectTrackerState

const boardUpdate =
  (projectPath: string, mutate: (board: ProjectBoard) => ProjectBoard): StateUpdate =>
  (currentState) => {
    const nextBoard = mutate(getBoard(currentState, projectPath))
    return { ...currentState, boards: { ...currentState.boards, [projectPath]: nextBoard } }
  }

export const useProjectsStore = defineStore('projects', {
  state: (): ProjectsStoreState => ({
    state: createSeedState(),
    loading: false,
    scanning: false,
    saving: false,
    error: null,
    notice: null,
    readmes: {},
    githubLoading: {},
    agentRunning: {},
    autoRunning: {}
  }),

  getters: {
    // Archived projects stay in state so their rows survive saves, but no view
    // ever lists them.
    projects: (store) => store.state.snapshot.projects.filter((project) => !project.archived),
    isFirstLaunch: (store) =>
      store.state.scanDirectories.length === 0 &&
      !store.state.snapshot.scannedAt &&
      store.state.snapshot.projects.length <= 1
  },

  actions: {
    board(projectPath: string): ProjectBoard {
      return getBoard(this.state, projectPath)
    },

    async updateBoard(
      projectPath: string,
      mutate: (board: ProjectBoard) => ProjectBoard,
      alsoCompletedIds: string[] = []
    ) {
      return this.save(boardUpdate(projectPath, mutate), undefined, alsoCompletedIds)
    },

    boardPreferences(projectPath: string): BoardPreferences {
      return getBoardPreferences(this.state, projectPath)
    },

    // Takes the whole next preferences object rather than a patch: callers build
    // it with the toggle/setLaneWidth helpers, which already read the current
    // value, so a patch would just be a second way to say the same thing.
    async saveBoardPreferences(projectPath: string, preferences: BoardPreferences) {
      await this.save((currentState) => ({
        ...currentState,
        boardPreferences: { ...currentState.boardPreferences, [projectPath]: preferences }
      }))
    },

    async addLane(projectPath: string, name: string) {
      const lane: SwimLane = { id: crypto.randomUUID(), name, agentPrompt: '', agentFilePath: '' }
      await this.updateBoard(projectPath, (board) => ({ ...board, lanes: [...board.lanes, lane] }))
    },

    async updateLane(projectPath: string, laneId: string, patch: Partial<Omit<SwimLane, 'id'>>) {
      return this.updateBoard(projectPath, (board) => updateLaneInBoard(board, laneId, patch))
    },

    // File first, DB second: a failed write throws before the lane is touched.
    // The prompt is saved alongside the path because the textarea only commits
    // on blur, so the text being written may not be in state yet.
    async saveLaneAgentMarkdown(projectPath: string, lane: SwimLane, agentPrompt: string, agentFilePath: string) {
      const saved = await projectTrackerApi.saveLaneAgentMarkdown(projectPath, lane.name, agentFilePath, agentPrompt)
      const persisted = await this.updateLane(projectPath, lane.id, { agentPrompt, agentFilePath: saved.filePath })
      if (!persisted) throw new Error(this.error ?? 'Saved the file but could not update the lane.')
      return saved
    },

    // Optimistic: the lane lands in its new slot on drop rather than after the
    // IPC round trip. A failed write moves it back to where it was.
    async moveLane(projectPath: string, laneId: string, beforeLaneId: string | null) {
      const boardBeforeMove = getBoard(this.state, projectPath)
      const movedBoard = moveLaneInBoard(boardBeforeMove, laneId, beforeLaneId)
      if (movedBoard === boardBeforeMove) return

      const originalPosition = boardBeforeMove.lanes.findIndex((lane) => lane.id === laneId)
      const originalNextLane = boardBeforeMove.lanes[originalPosition + 1]
      const originalNextLaneId = originalNextLane?.id ?? null
      const moveBeforeLane = (anchorLaneId: string | null) =>
        boardUpdate(projectPath, (board) => moveLaneInBoard(board, laneId, anchorLaneId))

      this.state = moveBeforeLane(beforeLaneId)(this.state)
      // The move is re-applied to whatever state the queue hands over, so a
      // save that finished in between can't drop it. The undo is anchored on
      // the old neighbour rather than restoring the old lane array, so any
      // other lane edit that landed meanwhile survives.
      await this.save(moveBeforeLane(beforeLaneId), moveBeforeLane(originalNextLaneId))
    },

    async removeLane(projectPath: string, laneId: string) {
      await this.updateBoard(projectPath, (board) => removeLaneFromBoard(board, laneId))
    },

    async addTicket(projectPath: string, laneId: string, title: string, description = '') {
      // Built inside the mutate callback so the ticket number is derived from the
      // same board revision it is appended to.
      await this.updateBoard(projectPath, (board) => addTicketToBoard(board, { laneId, title, description }))
    },

    // Every ticket edit funnels through here — modal fields, checklist toggles,
    // and drag-and-drop between lanes alike — so this is the only place that has
    // to stamp updatedAt for all of them.
    async updateTicket(
      projectPath: string,
      ticketId: string,
      patch: Partial<Omit<Ticket, 'id' | 'createdAt' | 'updatedAt'>>,
      completesTicket = false
    ) {
      const updatedAt = new Date().toISOString()
      const alsoCompletedIds = completesTicket ? [ticketId] : []
      await this.updateBoard(
        projectPath,
        (board) => ({
          ...board,
          tickets: board.tickets.map((ticket) =>
            ticket.id === ticketId ? { ...ticket, ...patch, updatedAt } : ticket
          )
        }),
        alsoCompletedIds
      )
    },

    // Matched against the run saved at write time, not the one the caller saw:
    // a run that finished in between keeps its result and stays unseen.
    // Skips the updatedAt stamp, because looking at a ticket is not editing it.
    async markAgentRunSeen(projectPath: string, ticketId: string, runAt: string) {
      const seenAt = new Date().toISOString()
      const markSeen = (ticket: Ticket): Ticket => {
        const savedRun = ticket.agentRun
        const isUnseenRun = ticket.id === ticketId && savedRun?.at === runAt && savedRun.seenAt === undefined
        return isUnseenRun ? { ...ticket, agentRun: { ...savedRun, seenAt } } : ticket
      }
      await this.updateBoard(projectPath, (board) => ({ ...board, tickets: board.tickets.map(markSeen) }))
    },

    // Imports open GitHub issues into the board's dedicated import lane, which
    // is created on first pull. Already-imported issues are left untouched, so
    // this is safe to re-run.
    // Quiet is the automatic pull on board open: no banner for a project without
    // a repo, and no notice when nothing new arrived. Errors still show.
    async pullGithubIssues(projectPath: string, { quiet = false } = {}) {
      const project = this.projects.find((entry) => entry.path === projectPath)
      if (!project?.githubUrl) {
        if (!quiet) this.error = 'This project has no linked GitHub repository.'
        return
      }
      this.githubLoading[projectPath] = true
      if (!quiet) {
        this.error = null
        this.notice = null
      }
      try {
        const issues = await projectTrackerApi.fetchProjectGithubIssues(project.githubUrl)
        // Nothing new → no write: saving would still add an empty import lane
        // and clear whatever banner is showing.
        const boardBeforeImport = getBoard(this.state, projectPath)
        const preview = addGithubIssuesToBoard(boardBeforeImport, issues)
        let added = preview.added
        if (added > 0) {
          const saved = await this.updateBoard(projectPath, (board) => {
            const result = addGithubIssuesToBoard(board, issues)
            added = result.added
            return result.board
          })
          if (!saved) return
        }
        const skipped = issues.length - added
        if (quiet && added === 0) return
        this.notice = `Imported ${added} issue${added === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} already on the board)` : ''}.`
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.githubLoading[projectPath] = false
      }
    },

    // Errors propagate so the ticket modal can show them; a project with no
    // linked repo has nothing to ask GitHub, so that is a quiet no-op.
    async refreshPullRequest(projectPath: string, ticket: Ticket) {
      const githubUrl = this.projects.find((entry) => entry.path === projectPath)?.githubUrl
      if (!githubUrl) return
      const status = await projectTrackerApi.fetchTicketPullRequest(
        githubUrl,
        ticketBranchName(ticket),
        ticket.pullRequestUrl
      )
      if (!status) return
      // The user may have pasted a different URL while the request was in flight.
      const currentTicket = this.board(projectPath).tickets.find((entry) => entry.id === ticket.id)
      if (currentTicket?.pullRequestUrl !== ticket.pullRequestUrl) return
      const unchanged =
        status.url === ticket.pullRequestUrl &&
        status.state === ticket.pullRequestState &&
        status.mergedAt === ticket.pullRequestMergedAt
      // Skipped so a refresh that learns nothing does not bump updatedAt.
      if (unchanged) return
      await this.updateTicket(projectPath, ticket.id, {
        pullRequestUrl: status.url,
        pullRequestState: status.state,
        pullRequestMergedAt: status.mergedAt
      })
    },

    // ponytail: sequential, one request per ticket. Fine for a board's worth of
    // in-flight tickets against the 5000/h authed limit; batch via GraphQL if
    // boards grow into the hundreds.
    async refreshBoardPullRequests(projectPath: string) {
      const ticketsToCheck = this.board(projectPath).tickets.filter(
        (ticket) => (ticket.branchName || ticket.pullRequestUrl) && !isPullRequestSettled(ticket.pullRequestState)
      )
      for (const ticket of ticketsToCheck) {
        try {
          await this.refreshPullRequest(projectPath, ticket)
        } catch (error) {
          // A board load never surfaces GitHub errors; the modal does, on open.
          // One bad ticket skips only itself; a rate limit would fail every one after it.
          const isRateLimited = error instanceof Error && error.message.includes('rate limit')
          if (isRateLimited) return
        }
      }
    },

    // At most once per project per app launch. Marked before the await so two
    // overlapping calls can't both fetch, and a failure isn't retried: the
    // manual button is the retry. A project without a repo isn't marked, so it
    // still pulls if its data was just not loaded yet.
    async autoPullGithubIssues(projectPath: string) {
      if (autoPulledProjects.has(projectPath)) return
      const project = this.projects.find((entry) => entry.path === projectPath)
      if (!project?.githubUrl) return
      autoPulledProjects.add(projectPath)
      await this.pullGithubIssues(projectPath, { quiet: true })
    },

    async removeTicket(projectPath: string, ticketId: string) {
      await this.updateBoard(projectPath, (board) => ({
        ...board,
        tickets: board.tickets.filter((ticket) => ticket.id !== ticketId)
      }))
    },

    async load() {
      this.loading = true
      this.error = null
      try {
        this.state = await projectTrackerApi.getProjectState()
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
    },

    // Picks up writes from other processes. Queued behind pending saves so the
    // fresh read never lands between a save's mutate and its write, which keeps
    // the main process's diff baseline equal to the state the renderer holds.
    // The previous state is read inside the queued callback, not before it is
    // queued, so each outside move shows up in exactly one diff.
    async refresh() {
      let handoffs: ProjectHandoffs[] = []
      saveQueue = saveQueue
        .catch(() => undefined)
        .then(async () => {
          const freshState = await projectTrackerApi.refreshProjectState()
          if (!freshState) return
          const previousState = this.state
          const { state: settledState, moved } = withCompletionMoves(previousState, freshState)
          // Take the fresh read first: main already diffs against it, so a
          // failed completion-move write must not leave this window behind.
          handoffs = handoffsBetween(previousState, freshState)
          this.state = freshState
          if (settledState === freshState) return
          const savedState = await projectTrackerApi.saveProjectState(settledState)
          handoffs = handoffsBetween(previousState, savedState)
          this.state = savedState
          this.notice = completionMovesNotice(moved) ?? this.notice
        })
      try {
        await saveQueue
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      }
      this.startFullAutoHandoffs(handoffs)
    },

    // Launched after the queue settles rather than inside it, so a slow
    // worktree fetch never holds up saves.
    startFullAutoHandoffs(projectHandoffs: ProjectHandoffs[]) {
      if (projectHandoffs.length === 0) return
      const agents = availableAgents(this.state)
      const pickerTargetId = useOpenInStore().selectedId
      for (const { projectPath, handoffs } of projectHandoffs) {
        for (const laneHandoffs of groupByLaunch(handoffs)) {
          const toLane = laneHandoffs[0].toLane
          const ticketNumbers = laneHandoffs.map(({ ticket }) => `#${ticket.number}`).join(', ')
          if (this.autoRunning[autoRunKey(projectPath, toLane.id)]) {
            deferHandoffs(projectPath, laneHandoffs)
            this.notice = `Full auto queued ${ticketNumbers}: ${toLane.name} Auto Run already running`
            continue
          }
          const agent = findAgent(agents, toLane.autoRunAgentId)
          const terminal = resolveAutoRunTerminal(toLane.autoRunTerminalId, pickerTargetId)
          const useWorktrees = autoRunUsesWorktrees(toLane, laneHandoffs[0].ticket)
          const launches = laneHandoffs.map(({ ticket }) =>
            buildAutoRunLaunch(ticket, toLane, agent, this.promptContextFor(ticket, projectPath), useWorktrees)
          )
          const launch = this.autoRunLane(projectPath, toLane.id, terminal.id, terminal.label, launches, useWorktrees)
          void launch.then((launched) => {
            if (launched) this.notice = `Full auto: ${ticketNumbers} → ${toLane.name}`
          })
        }
      }
    },

    promptContextFor(ticket: Ticket, projectPath: string) {
      const assignee = this.state.users.find((user) => user.id === ticket.assigneeId)
      return { assigneeName: assignee?.name, projectPath }
    },

    // Throws on failure, unlike save(). `undo` reverts an optimistic edit and
    // runs inside the same queue link, so a save queued behind this one can't
    // read the edit before it is taken back and persist it.
    // A save also returns a fresh read, so an agent's move can arrive here
    // instead of through refresh. Diffing against the candidate keeps this
    // save's own edits out of it — but not Move to's moves, which are applied
    // after the candidate is built, so full auto treats them like any move.
    // A checklist an agent completed in that fresh read gets one more write.
    async writeState(
      nextState?: ProjectTrackerState | StateUpdate,
      undo?: StateUpdate,
      alsoCompletedIds: string[] = []
    ): Promise<ProjectHandoffs[]> {
      let handoffs: ProjectHandoffs[] = []
      saveQueue = saveQueue
        .catch(() => undefined)
        .then(async () => {
          const candidate = typeof nextState === 'function' ? nextState(this.state) : nextState ?? this.state
          const ownMoves = withCompletionMoves(this.state, candidate, alsoCompletedIds)
          let savedState: ProjectTrackerState
          try {
            savedState = await projectTrackerApi.saveProjectState(ownMoves.state)
          } catch (error) {
            if (undo) this.state = undo(this.state)
            throw error
          }
          handoffs = handoffsBetween(candidate, savedState)
          this.state = savedState
          this.notice = completionMovesNotice(ownMoves.moved) ?? this.notice

          // The edit is in the DB now, so a failed follow-up write must not undo it.
          const outsideMoves = withCompletionMoves(ownMoves.state, savedState)
          if (outsideMoves.state === savedState) return
          const settledState = await projectTrackerApi.saveProjectState(outsideMoves.state)
          handoffs = handoffsBetween(candidate, settledState)
          this.state = settledState
          this.notice = completionMovesNotice([...ownMoves.moved, ...outsideMoves.moved]) ?? this.notice
        })
      await saveQueue
      return handoffs
    },

    async save(nextState?: ProjectTrackerState | StateUpdate, undo?: StateUpdate, alsoCompletedIds: string[] = []) {
      this.saving = true
      this.error = null
      let handoffs: ProjectHandoffs[] = []
      try {
        handoffs = await this.writeState(nextState, undo, alsoCompletedIds)
        return true
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        return false
      } finally {
        this.saving = false
        this.startFullAutoHandoffs(handoffs)
      }
    },

    async pickDirectory() {
      try {
        return await projectTrackerApi.pickScanDirectory()
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        return null
      }
    },

    async addScanDirectory(directory: string) {
      await this.save((currentState) => addScanDirectory(currentState, directory))
    },

    async removeScanDirectory(directory: string) {
      await this.save((currentState) => removeScanDirectory(currentState, directory))
    },

    async scan(extraDirectory?: string, options?: { requireProjects?: boolean }) {
      this.scanning = true
      this.error = null
      this.notice = null
      const scanDirectories = unique(extraDirectory ? [...this.state.scanDirectories, extraDirectory] : this.state.scanDirectories)

      try {
        const result = await projectTrackerApi.scanProjectDirectories(
          scanDirectories,
          this.state.hiddenPaths,
          this.state.thirdPartyPaths
        )
        if (options?.requireProjects && result.snapshot.projects.length === 0 && result.failures.length > 0) {
          this.error = `Scan failed for ${result.failures[0].path}: ${result.failures[0].message}`
          return false
        }
        await this.save((currentState) => mergeScannedProjects(
          { ...currentState, scanDirectories },
          result.snapshot.projects,
          result.failures
        ))
        this.notice =
          result.failures.length > 0
            ? `Scan finished with ${result.failures.length} issue${result.failures.length === 1 ? '' : 's'}.`
            : `Scan found ${result.snapshot.projects.length} project${result.snapshot.projects.length === 1 ? '' : 's'}.`
        return true
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        return false
      } finally {
        this.scanning = false
      }
    },

    async updateProject(path: string, patch: Partial<Pick<ProjectRecord, 'notes' | 'priority' | 'status'>>) {
      await this.save((currentState) => ({
        ...currentState,
        snapshot: {
          ...currentState.snapshot,
          projects: currentState.snapshot.projects.map((project) =>
            project.path === path ? { ...project, ...patch } : project
          )
        }
      }))
    },

    async setPriority(path: string, priority: ProjectPriority) {
      await this.updateProject(path, { priority })
    },

    async setStatus(path: string, status: ProjectStatus) {
      await this.save((currentState) => {
        const hiddenPaths =
          status === 'hidden'
            ? unique([...currentState.hiddenPaths, path])
            : currentState.hiddenPaths.filter((entry) => entry !== path)
        return {
          ...currentState,
          hiddenPaths,
          snapshot: {
            ...currentState.snapshot,
            projects: currentState.snapshot.projects.map((project) =>
              project.path === path ? { ...project, status } : project
            )
          }
        }
      })
    },

    async setNotes(path: string, notes: string) {
      await this.updateProject(path, { notes })
    },

    async toggleHidden(path: string) {
      await this.save((currentState) => {
        const project = currentState.snapshot.projects.find((entry) => entry.path === path)
        const hiddenPaths = currentState.hiddenPaths.includes(path)
          ? currentState.hiddenPaths.filter((entry) => entry !== path)
          : [...currentState.hiddenPaths, path]
        const status: ProjectStatus = project?.status === 'hidden' ? 'unknown' : 'hidden'
        return {
          ...currentState,
          hiddenPaths,
          snapshot: {
            ...currentState.snapshot,
            projects: currentState.snapshot.projects.map((entry) =>
              entry.path === path ? { ...entry, status } : entry
            )
          }
        }
      })
    },

    async toggleThirdParty(path: string) {
      await this.save((currentState) => {
        const thirdPartyPaths = currentState.thirdPartyPaths.includes(path)
          ? currentState.thirdPartyPaths.filter((entry) => entry !== path)
          : [...currentState.thirdPartyPaths, path]
        return { ...currentState, thirdPartyPaths }
      })
    },

    async openIn(path: string, targetId: string, command?: string, title?: string) {
      // Clear before awaiting so a repeat of the same text still restarts
      // MessageBanners' auto-dismiss timer (its watch skips same-value writes).
      this.notice = null
      try {
        const result = await projectTrackerApi.openProjectIn(path, targetId, command, title)
        if (result.fallbackCommand) {
          this.notice = `${result.appLabel} could not be opened. Copied ${result.fallbackCommand} to the clipboard.`
          return
        }
        if (result.ranCommand) {
          this.notice = `Running the agent command in ${result.appLabel}.`
          return
        }
        this.notice = result.copiedCommand
          ? `Opening in ${result.appLabel}. The agent command is on your clipboard — paste it to run.`
          : `Opening in ${result.appLabel}.`
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      }
    },

    // With worktrees on, each ticket records the branch and worktree it now
    // lives on, so its card and later prompts point at where the work is.
    async autoRunLane(
      path: string,
      laneId: string,
      targetId: string,
      terminalLabel: string,
      launches: { ticket: Ticket; launch: AutoRunTicketLaunch }[],
      useWorktrees: boolean,
      orchestrator?: TerminalTab
    ): Promise<boolean> {
      const runKey = autoRunKey(path, laneId)
      if (this.autoRunning[runKey]) return false
      this.autoRunning[runKey] = true
      this.notice = null
      try {
        const ticketLaunches = launches.map((entry) => entry.launch)
        const { worktreePaths } = await projectTrackerApi.autoRunLane(
          path,
          targetId,
          ticketLaunches,
          useWorktrees,
          orchestrator
        )
        const tabWord = launches.length === 1 ? 'tab' : 'tabs'
        const worktreeNote = useWorktrees ? ', one worktree each' : ''
        const orchestratorNote = orchestrator ? ' plus an orchestrator tab' : ''
        this.notice = `Auto Run opened ${launches.length} ${tabWord}${orchestratorNote} in ${terminalLabel}${worktreeNote}.`
        if (worktreePaths.length === 0) return true
        const updatedAt = new Date().toISOString()
        const placementByTicketId = new Map(
          launches.map(({ ticket, launch }, index) => [
            ticket.id,
            { branchName: launch.branchName, worktreePath: worktreePaths[index] }
          ])
        )
        await this.updateBoard(path, (board) => ({
          ...board,
          tickets: board.tickets.map((ticket) => {
            const placement = placementByTicketId.get(ticket.id)
            const isUnchanged =
              !placement ||
              (ticket.branchName === placement.branchName && ticket.worktreePath === placement.worktreePath)
            return isUnchanged ? ticket : { ...ticket, ...placement, updatedAt }
          })
        }))
        return true
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        return false
      } finally {
        this.autoRunning[runKey] = false
        this.startDeferredHandoffs(runKey)
      }
    },

    // A queued ticket may have moved on (or been dragged away) while it waited;
    // only the ones still in the destination lane launch, as they are now.
    startDeferredHandoffs(runKey: string) {
      const deferred = takeDeferredHandoffs(runKey)
      if (!deferred) return
      const board = getBoard(this.state, deferred.projectPath)
      const stillWaiting = deferred.handoffs.flatMap((handoff) => {
        const currentTicket = board.tickets.find((ticket) => ticket.id === handoff.ticket.id)
        const isStillInLane = currentTicket?.laneId === handoff.toLane.id
        return isStillInLane ? [{ ...handoff, ticket: currentTicket }] : []
      })
      if (stillWaiting.length === 0) return
      this.startFullAutoHandoffs([{ projectPath: deferred.projectPath, handoffs: stillWaiting }])
    },

    // The lane is captured at start, not read back at the end: the ticket may be
    // dragged to another column mid-run, and the record should say which lane's
    // prompt actually produced the output.
    async runTicketAgent(projectPath: string, ticket: Ticket, agentId: string, prompt: string) {
      if (this.agentRunning[ticket.id]) return
      this.agentRunning[ticket.id] = true
      this.error = null
      this.notice = `Agent running on #${ticket.number}…`
      const laneId = ticket.laneId
      try {
        // A run that throws is still recorded as a failed run, so an older
        // success in this lane stops showing its checkmark.
        const result = await projectTrackerApi
          .runTicketAgent(projectPath, agentId, prompt)
          .catch((error: unknown) => ({
            output: error instanceof Error ? error.message : String(error),
            succeeded: false
          }))
        const agentRun = {
          at: new Date().toISOString(),
          laneId,
          output: result.output,
          succeeded: result.succeeded
        }
        const storedTicket = () => this.board(projectPath).tickets.find((entry) => entry.id === ticket.id)
        const laneBeforeSave = storedTicket()?.laneId
        await this.updateTicket(projectPath, ticket.id, { agentRun }, result.succeeded)
        if (!result.succeeded) {
          this.error = `Agent run on #${ticket.number} failed — see the ticket's last run.`
          return
        }
        // A Move to notice from that save is newer news than "finished".
        const movedOnCompletion = storedTicket()?.laneId !== laneBeforeSave
        if (!movedOnCompletion) this.notice = `Agent finished #${ticket.number}.`
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.agentRunning[ticket.id] = false
      }
    },

    async fetchGithub(path: string) {
      const project = this.projects.find((entry) => entry.path === path)
      if (!project?.githubUrl) {
        this.error = 'This project has no linked GitHub repository.'
        return
      }
      this.githubLoading[path] = true
      this.error = null
      this.notice = null
      try {
        const github = await projectTrackerApi.fetchProjectGithub(project.githubUrl)
        await this.save((currentState) => ({
          ...currentState,
          snapshot: {
            ...currentState.snapshot,
            projects: currentState.snapshot.projects.map((entry) =>
              entry.path === path ? { ...entry, github } : entry
            )
          }
        }))
        this.notice = `Updated GitHub data for ${project.name}.`
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
      } finally {
        this.githubLoading[path] = false
      }
    },

    async loadReadme(path: string) {
      if (this.readmes[path]?.content || this.readmes[path]?.loading) return
      this.readmes[path] = { loading: true, content: null, fileName: null, error: null }
      try {
        this.readmes[path] = { loading: false, error: null, ...(await projectTrackerApi.readProjectReadme(path)) }
      } catch (error) {
        this.readmes[path] = {
          loading: false,
          content: null,
          fileName: null,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
})
