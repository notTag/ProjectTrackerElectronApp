import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSeedState, getBoard, type ProjectRecord, type ProjectTrackerState, type Ticket } from '@/shared/projectTypes'

const api = vi.hoisted(() => ({
  refreshProjectState: vi.fn(),
  saveProjectState: vi.fn(),
  autoRunLane: vi.fn(),
  runTicketAgent: vi.fn(),
  fetchProjectGithubIssues: vi.fn()
}))
vi.mock('@/services/projectTrackerApi', () => ({ projectTrackerApi: api }))

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })

const { useProjectsStore } = await import('./projects')

const saveProjectState = api.saveProjectState

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
          { id: 'prd', name: 'PRD', agentPrompt: 'Write a PRD.', agentFilePath: '', fullAuto: true },
          { id: 'dev', name: 'In Development', agentPrompt: 'Build it.', agentFilePath: '', autoRunTerminalId: 'iterm2' }
        ],
        tickets: [ticket]
      }
    }
  }
}

const flushLaunches = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('full auto handoff', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.autoRunLane.mockResolvedValue({ worktreePaths: [] })
    api.saveProjectState.mockImplementation(async (state: ProjectTrackerState) => state)
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
    saveProjectState.mockReset()
  })

  it('places the lane before the save resolves, then keeps it there', async () => {
    let finishSave: () => void = () => undefined
    saveProjectState.mockImplementation(
      (state) => new Promise((resolve) => (finishSave = () => resolve(state)))
    )
    const store = storeWithLanes('a', 'b', 'c')

    const moving = store.moveLane(PROJECT, 'c', 'a')
    expect(laneOrder(store)).toEqual(['c', 'a', 'b'])

    await vi.waitFor(() => expect(saveProjectState).toHaveBeenCalled())
    finishSave()
    await moving
    expect(laneOrder(store)).toEqual(['c', 'a', 'b'])
    expect(store.error).toBeNull()
  })

  it('moves the lane back to its original slot when the save fails', async () => {
    saveProjectState.mockRejectedValue(new Error('disk full'))
    const store = storeWithLanes('a', 'b', 'c')

    await store.moveLane(PROJECT, 'a', null)

    expect(laneOrder(store)).toEqual(['a', 'b', 'c'])
    expect(store.error).toBe('disk full')
    expect(store.saving).toBe(false)
  })

  it('does not save when the drop moves nothing', async () => {
    const store = storeWithLanes('a', 'b', 'c')
    await store.moveLane(PROJECT, 'b', 'c')
    expect(saveProjectState).not.toHaveBeenCalled()
  })

  it('takes a failed move back before a save queued behind it reads the state', async () => {
    saveProjectState
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementation((state) => Promise.resolve(state))
    const store = storeWithLanes('a', 'b', 'c')

    const moving = store.moveLane(PROJECT, 'a', null)
    const laterSave = store.updateLane(PROJECT, 'b', { name: 'renamed' })
    await Promise.all([moving, laterSave])

    const persistedState = saveProjectState.mock.calls[1][0]
    const persistedOrder = getBoard(persistedState, PROJECT).lanes.map((entry) => entry.id)
    expect(persistedOrder).toEqual(['a', 'b', 'c'])
    expect(laneOrder(store)).toEqual(['a', 'b', 'c'])
  })
})

describe('Move to on completion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.autoRunLane.mockResolvedValue({ worktreePaths: [] })
    api.saveProjectState.mockImplementation(async (state: ProjectTrackerState) => state)
  })

  const armedStore = ({ fullAuto = false } = {}) => {
    const store = useProjectsStore()
    const state = stateWithTicketIn('prd')
    getBoard(state, PROJECT_PATH).lanes[0].fullAuto = fullAuto
    const ticket = getBoard(state, PROJECT_PATH).tickets[0]
    Object.assign(ticket, { moveToLaneId: 'dev', moveOnComplete: true, checklist: [{ text: 'a', done: false }] })
    store.state = state
    return { store, ticket }
  }
  const storedTicket = (store: ReturnType<typeof useProjectsStore>) => store.board(PROJECT_PATH).tickets[0]

  it('moves the ticket and disarms it when ▶ Run succeeds, in one save', async () => {
    const { store, ticket } = armedStore()
    api.runTicketAgent.mockResolvedValue({ output: 'ok', succeeded: true })

    await store.runTicketAgent(PROJECT_PATH, ticket, 'claude', 'prompt')

    expect(storedTicket(store)).toMatchObject({ laneId: 'dev', moveToLaneId: 'dev', moveOnComplete: false })
    expect(saveProjectState).toHaveBeenCalledTimes(1)
    expect(store.notice).toBe('Moved #7 to In Development.')
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
  })

  it('moves on a checklist an agent completed in the DB, picked up by refresh', async () => {
    const { store } = armedStore()
    const fresh: ProjectTrackerState = JSON.parse(JSON.stringify(store.state))
    getBoard(fresh, PROJECT_PATH).tickets[0].checklist = [{ text: 'a', done: true }]
    api.refreshProjectState.mockResolvedValue(fresh)

    await store.refresh()

    expect(storedTicket(store)).toMatchObject({ laneId: 'dev', moveOnComplete: false })
    expect(saveProjectState).toHaveBeenCalledTimes(1)
  })
})

describe('autoPullGithubIssues', () => {
  // The pulled-once set lives for the module's lifetime (one app launch), so
  // each test uses its own project path.
  const storeWithProject = (path: string, githubUrl?: string) => {
    const store = useProjectsStore()
    const project: ProjectRecord = {
      path,
      name: 'app',
      status: 'active',
      priority: 'none',
      notes: '',
      source: 'first-party',
      githubUrl,
      hasGit: true,
      hasPackageJson: true,
      hasReadme: false,
      lastScannedAt: '2026-01-01T00:00:00.000Z'
    }
    store.state = { ...createSeedState(), snapshot: { ...createSeedState().snapshot, projects: [project] } }
    return store
  }

  const issue = { number: 3, title: 'Crash on save', body: '', htmlUrl: 'https://github.com/o/r/issues/3' }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.saveProjectState.mockImplementation(async (state: ProjectTrackerState) => state)
  })

  it('pulls once per project, however often the board is opened', async () => {
    api.fetchProjectGithubIssues.mockResolvedValue([issue])
    const store = storeWithProject('/code/pull-once', 'https://github.com/o/r')

    await Promise.all([store.autoPullGithubIssues('/code/pull-once'), store.autoPullGithubIssues('/code/pull-once')])
    await store.autoPullGithubIssues('/code/pull-once')

    expect(api.fetchProjectGithubIssues).toHaveBeenCalledTimes(1)
    const importedTitles = getBoard(store.state, '/code/pull-once').tickets.map((ticket) => ticket.title)
    expect(importedTitles).toEqual(['Crash on save'])
    expect(store.notice).toBe('Imported 1 issue.')
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
    expect(api.saveProjectState).not.toHaveBeenCalled()
  })

  it('shows a failed pull as an error and does not retry it', async () => {
    api.fetchProjectGithubIssues.mockRejectedValue(new Error('GitHub rate limit exceeded'))
    const store = storeWithProject('/code/offline', 'https://github.com/o/r')

    await store.autoPullGithubIssues('/code/offline')
    await store.autoPullGithubIssues('/code/offline')

    expect(store.error).toBe('GitHub rate limit exceeded')
    expect(api.fetchProjectGithubIssues).toHaveBeenCalledTimes(1)
    expect(store.githubLoading['/code/offline']).toBe(false)
  })
})
