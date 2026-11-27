import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'

import { useRowConfirm } from '@/components/rowConfirm'
import SwimlaneStoreSection from '@/components/SwimlaneStoreSection.vue'
import { createSeedState, getBoard } from '@/shared/projectTypes'
import { useProjectsStore } from '@/stores/projects'

describe('useRowConfirm', () => {
  it('swaps one row at a time into a confirm state, and reverts on cancel', () => {
    const { start, cancel, pendingActionOf } = useRowConfirm()
    expect(pendingActionOf('a')).toBeNull()

    start('a', 'delete')
    expect(pendingActionOf('a')).toBe('delete')

    start('b', 'add')
    expect(pendingActionOf('a')).toBeNull()
    expect(pendingActionOf('b')).toBe('add')

    cancel()
    expect(pendingActionOf('b')).toBeNull()
  })
})

describe('SwimlaneStoreSection', () => {
  const seed = createSeedState()
  const projectPath = seed.snapshot.projects[0].path

  const render = async (laneIds: string[], agentRunning = false, firstLaneName?: string) => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useProjectsStore()
    const seededBoard = getBoard(seed, projectPath)
    const [firstLane, ...otherLanes] = seededBoard.lanes
    const renamedFirstLane = { ...firstLane, name: firstLaneName ?? firstLane.name }
    const board = { ...seededBoard, lanes: [renamedFirstLane, ...otherLanes] }
    const ticket = { id: 't1', number: 1, laneId: board.lanes[0].id, title: 'T', description: '', createdAt: '2026-01-01T00:00:00.000Z' }
    store.state = { ...seed, boards: { [projectPath]: { ...board, tickets: [ticket] } } }
    if (agentRunning) store.agentRunning = { t1: true }
    store.laneStoreEntries = laneIds.map((laneId) => ({ id: `entry-${laneId}`, laneId, name: `Lane ${laneId}`, createdAt: '' }))
    const app = createSSRApp({ render: () => h(SwimlaneStoreSection, { projectPath }) })
    app.use(pinia)
    return renderToString(app)
  }

  it('shows the empty state', async () => {
    const html = await render([])
    expect(html).toContain('No saved swimlanes yet.')
  })

  it('gives each entry - and +, disabling + for a lane id already on the board', async () => {
    const onBoard = getBoard(seed, projectPath).lanes[0].id
    const html = await render([onBoard, 'fresh-lane'])
    expect(html).toContain(`aria-label="Delete Lane ${onBoard} from the store"`)
    expect(html).toMatch(new RegExp(`aria-label="Add Lane ${onBoard} to this workflow" title="Already in this workflow" disabled`))
    expect(html).toMatch(/aria-label="Add Lane fresh-lane to this workflow" title="Add to this workflow"(?! disabled)/)
  })

  it('disables + while an agent runs on the board', async () => {
    const html = await render(['fresh-lane'], true)
    expect(html).toMatch(/aria-label="Add Lane fresh-lane to this workflow" title="An agent or orchestrator is running[^"]*" disabled/)
  })

  it('disables + when another board lane uses the same prompt folder', async () => {
    const html = await render(['fresh-lane'], false, 'Lane fresh-lane')
    expect(html).toMatch(/aria-label="Add Lane fresh-lane to this workflow" title="Another lane here already uses[^"]*" disabled/)
  })
})
