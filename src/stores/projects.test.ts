import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toPlainJson } from '@/shared/plainJson'
import {
  createSeedState,
  getBoard,
  GITHUB_UNREACHABLE_MESSAGE,
  type ProjectRecord,
  type ProjectTrackerState,
  type Ticket
} from '@/shared/projectTypes'

const api = vi.hoisted(() => ({
  getProjectState: vi.fn(),
  refreshProjectState: vi.fn(),
  saveProjectState: vi.fn(),
  scanProjectDirectories: vi.fn(),
  createTicket: vi.fn(),
  updateTicket: vi.fn(),
  deleteTicket: vi.fn(),
  createLane: vi.fn(),
  updateLane: vi.fn(),
  reorderLanes: vi.fn(),
  deleteLane: vi.fn(),
  updateProject: vi.fn(),
  autoRunLane: vi.fn(),
  runTicketAgent: vi.fn(),
  fetchProjectGithubIssues: vi.fn(),
  fetchTicketPullRequest: vi.fn()
}))

const offlineError = new Error(
  `Error invoking remote method 'project:fetch-github-issues': Error: ${GITHUB_UNREACHABLE_MESSAGE}`
)
vi.mock('@/services/projectTrackerApi', () => ({ projectTrackerApi: api }))

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })

const { useProjectsStore } = await import('./projects')

const saveProjectState = api.saveProjectState

// Per-entity calls echo what the store already holds, the way the repository
// returns the row as stored. Created tickets get a repo-side number.
const REPO_TICKET_NUMBER = 42
const allTickets = () => Object.values(useProjectsStore().state.boards ?? {}).flatMap((board) => board.tickets)
const allLanes = () =>
  Object.values(useProjectsStore().state.boards ?? {}).flatMap((board) => [
    ...board.lanes,
    ...(board.unassignedLane ? [board.unassignedLane] : [])
  ])
const mockEntityWrites = () => {
  api.createTicket.mockImplementation(async (_path: string, ticket: Ticket) => ({ ...ticket, number: REPO_TICKET_NUMBER }))
  api.updateTicket.mockImplementation(async (id: string, patch: Partial<Ticket>) => ({
    ...allTickets().find((ticket) => ticket.id === id),
    ...patch
  }))
  api.createLane.mockImplementation(async (_path: string, lane: unknown) => lane)
  api.updateLane.mockImplementation(async (_path: string, laneId: string, patch: object) => ({
    ...allLanes().find((lane) => lane.id === laneId),
    ...patch
  }))
  api.reorderLanes.mockResolvedValue(undefined)
  api.deleteLane.mockResolvedValue(undefined)
  api.deleteTicket.mockResolvedValue(undefined)
  api.updateProject.mockImplementation(async (path: string, patch: object) => ({
    ...useProjectsStore().state.snapshot.projects.find((project) => project.path === path),
    ...patch
  }))
}

const PROJECT_PATH = '/code/app'

const stateWithTicketIn = (laneId: string): ProjectTrackerState => {
  const ticket: Ticket = {
    id: 'ticket-1',
    number: 7,
    laneId,
    title: 'Add the thing',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
  return {
    ...createSeedState(),
    boards: {
      [PROJECT_PATH]: {
        lanes: [
          { id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '', fullAuto: true },
          { id: 'prd', name: 'PRD', agentPrompt: 'Write a PRD.', agentFilePath: '', fullAuto: true },
          { id: 'dev', name: 'In Development', agentPrompt: 'Build it.', agentFilePath: '', autoRunTerminalId: 'iterm2' }
        ],
        tickets: [ticket]
      }
    }
  }
}

const flushLaunches = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('markAgentRunSeen', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.saveProjectState.mockImplementation(async (state: ProjectTrackerState) => state)
    mockEntityWrites()
  })

  const withRun = (at: string): ProjectTrackerState => {
    const state = stateWithTicketIn('dev')
    const [ticket] = getBoard(state, PROJECT_PATH).tickets
    ticket.agentRun = { at, laneId: 'dev', output: `run at ${at}`, succeeded: false }
    return state
  }
  const savedTicket = (store: ReturnType<typeof useProjectsStore>) => getBoard(store.state, PROJECT_PATH).tickets[0]

  it('marks the run seen without stamping updatedAt', async () => {
    const store = useProjectsStore()
    store.state = withRun('2026-01-02T00:00:00.000Z')

    await store.markAgentRunSeen(PROJECT_PATH, 'ticket-1', '2026-01-02T00:00:00.000Z')

    expect(savedTicket(store).agentRun?.seenAt).toBeDefined()
    expect(savedTicket(store).updatedAt).toBeUndefined()
  })

  it('leaves a newer run unseen and intact', async () => {
    const store = useProjectsStore()
    store.state = withRun('2026-01-03T00:00:00.000Z')
    const newerRun = savedTicket(store).agentRun

    await store.markAgentRunSeen(PROJECT_PATH, 'ticket-1', '2026-01-02T00:00:00.000Z')

    expect(savedTicket(store).agentRun).toEqual(newerRun)
    expect(savedTicket(store).agentRun?.seenAt).toBeUndefined()
  })
})

describe('full auto handoff', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.autoRunLane.mockResolvedValue({ worktreePaths: [] })
    api.saveProjectState.mockImplementation(async (state: ProjectTrackerState) => state)
    mockEntityWrites()
  })

  it("launches the destination lane's agent when a refresh shows an outside move", async () => {
    const store = useProjectsStore()
    store.state = stateWithTicketIn('prd')
    api.refreshProjectState.mockResolvedValue(stateWithTicketIn('dev'))

    await store.refresh()
    await flushLaunches()

    expect(api.autoRunLane).toHaveBeenCalledTimes(1)
    const [projectPath, terminalId, launches, useWorktrees] = api.autoRunLane.mock.calls[0]
    expect(projectPath).toBe(PROJECT_PATH)
    expect(terminalId).toBe('iterm2')
    expect(useWorktrees).toBe(true)
    expect(launches[0].command).toContain('Build it.')
    expect(store.notice).toBe('Full auto: #7 → In Development')
  })

  it('launches In Development from ticket data when a ticket skips PRD with no agent run', async () => {
    // Same round trip the preload applies to every IPC result.
    api.refreshProjectState.mockImplementation(async () => toPlainJson(stateWithTicketIn('dev')))
    api.autoRunLane.mockImplementation(async () => toPlainJson({ worktreePaths: [] }))
    const store = useProjectsStore()
    store.state = stateWithTicketIn('idea')

    await store.refresh()
    await flushLaunches()

    expect(store.error).toBeNull()
    expect(api.autoRunLane).toHaveBeenCalledTimes(1)
    const [, , launches] = api.autoRunLane.mock.calls[0]
    expect(launches[0].command).toContain('Add the thing')
  })

  it('launches nothing for a move made in this window', async () => {
    const store = useProjectsStore()
    store.state = stateWithTicketIn('prd')

    await store.updateTicket(PROJECT_PATH, 'ticket-1', { laneId: 'dev' })
    await flushLaunches()

    expect(api.autoRunLane).not.toHaveBeenCalled()
  })

  it('catches an outside move that arrives through a save instead of a refresh', async () => {
    const store = useProjectsStore()
    store.state = stateWithTicketIn('prd')
    api.saveProjectState.mockResolvedValue(stateWithTicketIn('dev'))

    await store.saveBoardPreferences(PROJECT_PATH, store.boardPreferences(PROJECT_PATH))
    await flushLaunches()

    expect(api.autoRunLane).toHaveBeenCalledTimes(1)
  })

  it('queues a handoff into a lane that is already launching and runs it once the lane frees up', async () => {
    const store = useProjectsStore()
    store.state = stateWithTicketIn('prd')
    let finishFirstLaunch = () => {}
    api.autoRunLane.mockReturnValueOnce(
      new Promise((resolve) => (finishFirstLaunch = () => resolve({ worktreePaths: [] })))
    )
    void store.autoRunLane(PROJECT_PATH, 'dev', 'iterm2', 'iTerm2', [], false)
    api.refreshProjectState.mockResolvedValue(stateWithTicketIn('dev'))

    await store.refresh()
    expect(api.autoRunLane).toHaveBeenCalledTimes(1)
    expect(store.notice).toBe('Full auto queued #7: In Development Auto Run already running')

    finishFirstLaunch()
    await flushLaunches()
    expect(api.autoRunLane).toHaveBeenCalledTimes(2)
    expect(store.notice).toBe('Full auto: #7 → In Development')
  })

  it('is not blocked by a same-named lane launching in another project', async () => {
    const store = useProjectsStore()
    store.state = stateWithTicketIn('prd')
    store.autoRunning['/code/other\ndev'] = true
    api.refreshProjectState.mockResolvedValue(stateWithTicketIn('dev'))

    await store.refresh()
    await flushLaunches()

    expect(api.autoRunLane).toHaveBeenCalledTimes(1)
  })
})

const PROJECT = '/projects/demo'
const lane = (id: string) => ({ id, name: id, agentPrompt: '', agentFilePath: '' })

const storeWithLanes = (...laneIds: string[]) => {
  const store = useProjectsStore()
  store.state = { ...createSeedState(), boards: { [PROJECT]: { lanes: laneIds.map(lane), tickets: [] } } }
  return store
}

const laneOrder = (store: ReturnType<typeof useProjectsStore>) => store.board(PROJECT).lanes.map((entry) => entry.id)

describe('moveLane', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockEntityWrites()
  })

  it('places the lane before the write resolves, then keeps it there', async () => {
    let finishWrite: () => void = () => undefined
    api.reorderLanes.mockImplementation(() => new Promise<void>((resolve) => (finishWrite = resolve)))
    const store = storeWithLanes('a', 'b', 'c')

    const moving = store.moveLane(PROJECT, 'c', 'a')
    expect(laneOrder(store)).toEqual(['c', 'a', 'b'])

    await vi.waitFor(() => expect(api.reorderLanes).toHaveBeenCalledWith(PROJECT, ['c', 'a', 'b']))
    finishWrite()
    await moving
    expect(laneOrder(store)).toEqual(['c', 'a', 'b'])
    expect(store.error).toBeNull()
    expect(saveProjectState).not.toHaveBeenCalled()
  })

  it('moves the lane back to its original slot and re-reads when the write fails', async () => {
    api.reorderLanes.mockRejectedValue(new Error('disk full'))
    const store = storeWithLanes('a', 'b', 'c')

    await store.moveLane(PROJECT, 'a', null)

    expect(laneOrder(store)).toEqual(['a', 'b', 'c'])
    expect(api.getProjectState).toHaveBeenCalledTimes(1)
    expect(store.error).toBe('disk full')
    expect(store.saving).toBe(false)
  })

  it('does not write when the drop moves nothing', async () => {
    const store = storeWithLanes('a', 'b', 'c')
    await store.moveLane(PROJECT, 'b', 'c')
    expect(api.reorderLanes).not.toHaveBeenCalled()
  })

  it('takes a failed move back before a write queued behind it reads the state', async () => {
    api.reorderLanes.mockRejectedValueOnce(new Error('disk full'))
    const store = storeWithLanes('a', 'b', 'c')

    const moving = store.moveLane(PROJECT, 'a', null)
    const laterSave = store.updateLane(PROJECT, 'b', { name: 'renamed' })
    await Promise.all([moving, laterSave])

    expect(api.reorderLanes).toHaveBeenCalledTimes(1)
    expect(api.updateLane).toHaveBeenCalledWith(PROJECT, 'b', { name: 'renamed' })
    expect(laneOrder(store)).toEqual(['a', 'b', 'c'])
  })
})

describe('Move to on completion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.autoRunLane.mockResolvedValue({ worktreePaths: [] })
    api.saveProjectState.mockImplementation(async (state: ProjectTrackerState) => state)
    mockEntityWrites()
  })

  const armedStore = ({ fullAuto = false } = {}) => {
    const store = useProjectsStore()
    const state = stateWithTicketIn('prd')
    const prdLane = getBoard(state, PROJECT_PATH).lanes.find((lane) => lane.id === 'prd')!
    prdLane.fullAuto = fullAuto
    const ticket = getBoard(state, PROJECT_PATH).tickets[0]
    Object.assign(ticket, { moveToLaneId: 'dev', moveOnComplete: true, checklist: [{ text: 'a', done: false }] })
    store.state = state
    return { store, ticket }
  }
  const storedTicket = (store: ReturnType<typeof useProjectsStore>) => store.board(PROJECT_PATH).tickets[0]

  it('moves the ticket and disarms it when ▶ Run succeeds, in one write', async () => {
    const { store, ticket } = armedStore()
    api.runTicketAgent.mockResolvedValue({ output: 'ok', succeeded: true })

    await store.runTicketAgent(PROJECT_PATH, ticket, 'claude', 'prompt')

    expect(storedTicket(store)).toMatchObject({ laneId: 'dev', moveToLaneId: undefined, moveOnComplete: false })
    expect(api.updateTicket).toHaveBeenCalledTimes(1)
    expect(saveProjectState).not.toHaveBeenCalled()
    expect(store.notice).toBe('Moved #7 to In Development.')
    expect(store.error).toBeNull()
  })

  it('leaves the ticket where it is when ▶ Run fails', async () => {
    const { store, ticket } = armedStore()
    api.runTicketAgent.mockResolvedValue({ output: 'boom', succeeded: false })

    await store.runTicketAgent(PROJECT_PATH, ticket, 'claude', 'prompt')

    expect(storedTicket(store)).toMatchObject({ laneId: 'prd', moveOnComplete: true })
  })

  it('moves on a checklist ticked done in this window, and full auto hands the move off', async () => {
    const { store } = armedStore({ fullAuto: true })

    await store.updateTicket(PROJECT_PATH, 'ticket-1', { checklist: [{ text: 'a', done: true }] })
    await flushLaunches()

    expect(storedTicket(store).laneId).toBe('dev')
    expect(api.autoRunLane).toHaveBeenCalledTimes(1)
    expect(api.refreshProjectState).not.toHaveBeenCalled()
    expect(api.getProjectState).not.toHaveBeenCalled()
  })

  it('moves on a checklist an agent completed in the DB, picked up by refresh', async () => {
    const { store } = armedStore()
    const fresh: ProjectTrackerState = JSON.parse(JSON.stringify(store.state))
    getBoard(fresh, PROJECT_PATH).tickets[0].checklist = [{ text: 'a', done: true }]
    api.refreshProjectState.mockResolvedValue(fresh)

    await store.refresh()

    expect(storedTicket(store)).toMatchObject({ laneId: 'dev', moveOnComplete: false })
    expect(api.updateTicket).toHaveBeenCalledTimes(1)
    expect(api.updateTicket.mock.calls[0][1]).toMatchObject({ laneId: 'dev', moveOnComplete: false })
    expect(saveProjectState).not.toHaveBeenCalled()
  })
})

const projectRecord = (path: string, githubUrl?: string, name = 'app'): ProjectRecord => ({
  path,
  name,
  status: 'active',
  priority: 'none',
  notes: '',
  source: 'first-party',
  githubUrl,
  hasGit: true,
  hasPackageJson: true,
  hasReadme: false,
  lastScannedAt: '2026-01-01T00:00:00.000Z'
})

const storeWithProjects = (...projects: ProjectRecord[]) => {
  const store = useProjectsStore()
  store.state = { ...createSeedState(), snapshot: { ...createSeedState().snapshot, projects } }
  return store
}

const storeWithProject = (path: string, githubUrl?: string, name = 'app') =>
  storeWithProjects(projectRecord(path, githubUrl, name))

describe('autoPullGithubIssues', () => {
  // The pulled-once set lives for the module's lifetime (one app launch), so
  // each test uses its own project path.

  const issue = { number: 3, title: 'Crash on save', body: '', htmlUrl: 'https://github.com/o/r/issues/3' }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.saveProjectState.mockImplementation(async (state: ProjectTrackerState) => state)
    mockEntityWrites()
  })

  it('pulls once per project, however often the board is opened', async () => {
    api.fetchProjectGithubIssues.mockResolvedValue([issue])
    const store = storeWithProject('/code/pull-once', 'https://github.com/o/r')

    await Promise.all([store.autoPullGithubIssues('/code/pull-once'), store.autoPullGithubIssues('/code/pull-once')])
    await store.autoPullGithubIssues('/code/pull-once')

    expect(api.fetchProjectGithubIssues).toHaveBeenCalledTimes(1)
    const importedTitles = getBoard(store.state, '/code/pull-once').tickets.map((ticket) => ticket.title)
    expect(importedTitles).toEqual(['Crash on save'])
    expect(store.notice).toBe('Imported 1 issue into app.')
  })

  it('skips a project without a repo, with no error banner', async () => {
    const store = storeWithProject('/code/no-repo')

    await store.autoPullGithubIssues('/code/no-repo')

    expect(api.fetchProjectGithubIssues).not.toHaveBeenCalled()
    expect(store.error).toBeNull()
  })

  it('stays silent when nothing new arrived', async () => {
    api.fetchProjectGithubIssues.mockResolvedValue([])
    const store = storeWithProject('/code/nothing-new', 'https://github.com/o/r')

    await store.autoPullGithubIssues('/code/nothing-new')

    expect(store.notice).toBeNull()
    expect(api.createTicket).not.toHaveBeenCalled()
  })

  it('shows a failed pull as an error and does not retry it', async () => {
    api.fetchProjectGithubIssues.mockRejectedValue(new Error('GitHub rate limit exceeded'))
    const store = storeWithProject('/code/offline', 'https://github.com/o/r')

    await store.autoPullGithubIssues('/code/offline')
    await store.autoPullGithubIssues('/code/offline')

    expect(store.error).toBe('app: GitHub rate limit exceeded')
    expect(api.fetchProjectGithubIssues).toHaveBeenCalledTimes(1)
    expect(store.githubLoading['/code/offline']).toBe(false)
  })

  it('shows a 404 as an error and does not retry it', async () => {
    api.fetchProjectGithubIssues.mockRejectedValueOnce(new Error('Repository not found on GitHub.'))
    const store = storeWithProject('/code/missing', 'https://github.com/o/r')

    await store.autoPullGithubIssues('/code/missing')
    await store.autoPullGithubIssues('/code/missing')

    expect(store.error).toBe('app: Repository not found on GitHub.')
    expect(api.fetchProjectGithubIssues).toHaveBeenCalledTimes(1)
  })

  it('stays silent when GitHub is unreachable and pulls again on the next open', async () => {
    api.fetchProjectGithubIssues.mockRejectedValueOnce(offlineError).mockResolvedValueOnce([issue])
    const store = storeWithProject('/code/unreachable', 'https://github.com/o/r')

    await store.autoPullGithubIssues('/code/unreachable')
    expect(store.error).toBeNull()
    expect(store.githubLoading['/code/unreachable']).toBe(false)

    await store.autoPullGithubIssues('/code/unreachable')
    expect(api.fetchProjectGithubIssues).toHaveBeenCalledTimes(2)
    expect(store.notice).toBe('Imported 1 issue into app.')
  })

  it('names the pulled project, not whichever board is open when the fetch resolves', async () => {
    let resolveFetch: (issues: (typeof issue)[]) => void = () => undefined
    api.fetchProjectGithubIssues
      .mockReturnValueOnce(new Promise((resolve) => (resolveFetch = resolve)))
      .mockResolvedValueOnce([])
    const store = storeWithProjects(
      projectRecord('/code/board-a', 'https://github.com/o/a', 'board-a'),
      projectRecord('/code/board-b', 'https://github.com/o/b', 'board-b')
    )

    const pullForA = store.autoPullGithubIssues('/code/board-a')
    // the user switches to board B while A's fetch is in flight
    await store.autoPullGithubIssues('/code/board-b')
    resolveFetch([issue])
    await pullForA

    expect(store.notice).toBe('Imported 1 issue into board-a.')
  })

  it('names the project when saving the pulled issues fails', async () => {
    api.fetchProjectGithubIssues.mockResolvedValue([issue])
    api.createLane.mockRejectedValue(new Error('disk full'))
    api.createTicket.mockRejectedValue(new Error('disk full'))
    const store = storeWithProject('/code/save-fails', 'https://github.com/o/r')

    await store.pullGithubIssues('/code/save-fails')

    expect(store.error).toBe('app: disk full')
    expect(store.notice).toBeNull()
  })

  it('names the project when a manual pull has no repo', async () => {
    const store = storeWithProject('/code/manual-no-repo')

    await store.pullGithubIssues('/code/manual-no-repo')

    expect(store.error).toBe('app has no linked GitHub repository.')
  })
})

describe('refreshBoardPullRequests', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('stops after the first request when GitHub is unreachable', async () => {
    const store = storeWithProject(PROJECT_PATH, 'https://github.com/o/r')
    const { boards } = stateWithTicketIn('dev')
    const board = getBoard({ ...store.state, boards }, PROJECT_PATH)
    const [template] = board.tickets
    board.tickets = [1, 2, 3].map((number) => ({ ...template, id: `ticket-${number}`, number, branchName: `t${number}` }))
    store.state = { ...store.state, boards }
    api.fetchTicketPullRequest.mockRejectedValueOnce(offlineError)

    await store.refreshBoardPullRequests(PROJECT_PATH)

    expect(api.fetchTicketPullRequest).toHaveBeenCalledTimes(1)
    expect(store.error).toBeNull()
  })
})

describe('per-entity writes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockEntityWrites()
  })

  const ticketIds = (store: ReturnType<typeof useProjectsStore>) => store.board(PROJECT_PATH).tickets.map((ticket) => ticket.id)

  it('board and project edits never send the whole state', async () => {
    const store = useProjectsStore()
    const state = stateWithTicketIn('idea')
    const project: ProjectRecord = {
      path: PROJECT_PATH, name: 'app', status: 'active', priority: 'none', notes: '', source: 'first-party',
      hasGit: true, hasPackageJson: true, hasReadme: false, lastScannedAt: '2026-01-01T00:00:00.000Z'
    }
    store.state = { ...state, snapshot: { ...state.snapshot, projects: [project] } }

    await store.updateTicket(PROJECT_PATH, 'ticket-1', { title: 'Retitled' })
    await store.addTicket(PROJECT_PATH, 'idea', 'New one')
    await store.removeTicket(PROJECT_PATH, 'ticket-1')
    await store.addLane(PROJECT_PATH, 'QA')
    await store.updateLane(PROJECT_PATH, 'prd', { name: 'Spec' })
    await store.moveLane(PROJECT_PATH, 'dev', 'idea')
    await store.removeLane(PROJECT_PATH, 'prd')
    await store.updateProject(PROJECT_PATH, { notes: 'hello' })

    expect(saveProjectState).not.toHaveBeenCalled()
    expect(store.error).toBeNull()
    expect(api.updateTicket).toHaveBeenCalledWith('ticket-1', expect.objectContaining({ title: 'Retitled' }))
    expect(api.createTicket).toHaveBeenCalledTimes(1)
    expect(api.deleteTicket).toHaveBeenCalledWith('ticket-1')
    expect(api.createLane).toHaveBeenCalledWith(PROJECT_PATH, expect.objectContaining({ name: 'QA' }))
    expect(api.updateLane).toHaveBeenCalledWith(PROJECT_PATH, 'prd', { name: 'Spec' })
    expect(api.reorderLanes).toHaveBeenCalledTimes(1)
    expect(api.deleteLane).toHaveBeenCalledWith(PROJECT_PATH, 'prd')
    expect(api.updateProject).toHaveBeenCalledWith(PROJECT_PATH, { notes: 'hello' })
    expect(store.state.snapshot.projects[0].notes).toBe('hello')
  })

  it('a created ticket takes the number the repository returns', async () => {
    const store = useProjectsStore()
    store.state = stateWithTicketIn('idea')

    await store.addTicket(PROJECT_PATH, 'idea', 'New one')

    const created = store.board(PROJECT_PATH).tickets.find((ticket) => ticket.title === 'New one')
    expect(created?.number).toBe(REPO_TICKET_NUMBER)
    expect(ticketIds(store)).toHaveLength(2)
  })

  it('writes the default lanes of a board that was never saved', async () => {
    const store = useProjectsStore()
    store.state = createSeedState()

    await store.addTicket('/code/fresh', 'idea', 'First')

    expect(api.createLane.mock.calls.map(([, lane]) => lane.id)).toEqual(getBoard(createSeedState(), '/code/fresh').lanes.map((lane) => lane.id))
    expect(api.createTicket).toHaveBeenCalledTimes(1)
  })

  it('re-reads after a failed write', async () => {
    const store = useProjectsStore()
    store.state = stateWithTicketIn('idea')
    const fresh = stateWithTicketIn('prd')
    api.updateTicket.mockRejectedValue(new Error('locked'))
    api.getProjectState.mockResolvedValue(fresh)

    await store.updateTicket(PROJECT_PATH, 'ticket-1', { title: 'Retitled' })

    expect(store.error).toBe('locked')
    expect(store.board(PROJECT_PATH).tickets[0].laneId).toBe('prd')
  })

  it('scans and board preferences still save the whole state', async () => {
    const store = useProjectsStore()
    store.state = stateWithTicketIn('idea')
    saveProjectState.mockImplementation(async (state: ProjectTrackerState) => state)
    api.scanProjectDirectories.mockResolvedValue({ snapshot: { projects: [] }, failures: [] })

    await store.saveBoardPreferences(PROJECT_PATH, store.boardPreferences(PROJECT_PATH))
    await store.scan('/code')

    expect(saveProjectState).toHaveBeenCalledTimes(2)
  })
})
