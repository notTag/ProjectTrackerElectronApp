import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toPlainJson } from '@/shared/plainJson'
import { createSeedState, getBoard, type ProjectTrackerState, type Ticket } from '@/shared/projectTypes'

const api = vi.hoisted(() => ({
  refreshProjectState: vi.fn(),
  saveProjectState: vi.fn(),
  autoRunLane: vi.fn()
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
