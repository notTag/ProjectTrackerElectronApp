import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSeedState, type ProjectTrackerState, type Ticket } from '@/shared/projectTypes'

const api = vi.hoisted(() => ({
  refreshProjectState: vi.fn(),
  saveProjectState: vi.fn(),
  autoRunLane: vi.fn()
}))
vi.mock('@/services/projectTrackerApi', () => ({ projectTrackerApi: api }))

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined })

const { useProjectsStore } = await import('./projects')

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
