import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSeedState, type ProjectTrackerState } from '@/shared/projectTypes'

const saveProjectState = vi.fn<(state: ProjectTrackerState) => Promise<ProjectTrackerState>>()

vi.mock('@/services/projectTrackerApi', () => ({
  projectTrackerApi: { saveProjectState: (state: ProjectTrackerState) => saveProjectState(state) }
}))

const { useProjectsStore } = await import('@/stores/projects')

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
})
