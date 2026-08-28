import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { createSeedState, UNASSIGNED_LANE_ID, type ProjectTrackerState } from '../../src/shared/projectTypes.js'
import { StateRepository } from './stateRepository.js'

const freshUserDataPath = () => mkdtempSync(path.join(tmpdir(), 'project-tracker-test-'))

const stateWithBoard = (): ProjectTrackerState => {
  const seed = createSeedState()
  const projectPath = seed.snapshot.projects[0].path
  return {
    ...seed,
    scanDirectories: ['/Users/example/Projects'],
    hiddenPaths: ['/Users/example/Projects/secret'],
    thirdPartyPaths: [],
    boards: {
      [projectPath]: {
        lanes: [
          { id: 'idea', name: 'Idea', agentPrompt: 'Sketch it.', agentFilePath: '' },
          { id: 'prd', name: 'PRD', agentPrompt: '', agentFilePath: '/tmp/prd.md' }
        ],
        unassignedLane: {
          id: UNASSIGNED_LANE_ID,
          name: 'No status',
          agentPrompt: 'Triage this.',
          agentFilePath: ''
        },
        tickets: [
          {
            id: 'ticket-a',
            number: 1,
            laneId: 'idea',
            title: 'A',
            description: 'body',
            createdAt: '2026-01-01T00:00:00.000Z',
            labels: ['bug'],
            checklist: [{ text: 'step', done: true }],
            externalId: 'github:7',
            externalUrl: 'https://github.com/o/r/issues/7'
          },
          {
            id: 'ticket-b',
            number: 2,
            laneId: UNASSIGNED_LANE_ID,
            title: 'B',
            description: '',
            createdAt: '2026-01-02T00:00:00.000Z',
            assigneeId: 'local'
          }
        ]
      }
    }
  }
}

describe('StateRepository', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = freshUserDataPath()
  })

  it('round-trips a board through the normalized tables', async () => {
    const repository = await StateRepository.create(userDataPath)
    const saved = repository.saveState(stateWithBoard())
    const loaded = await StateRepository.create(userDataPath).then((reopened) => reopened.getState())

    const projectPath = saved.snapshot.projects[0].path
    const board = loaded.boards?.[projectPath]
    expect(board?.lanes.map((lane) => lane.id)).toEqual(['idea', 'prd'])
    expect(board?.lanes[1].agentFilePath).toBe('/tmp/prd.md')
    expect(board?.unassignedLane?.agentPrompt).toBe('Triage this.')
    expect(board?.tickets.map((ticket) => ticket.number)).toEqual([1, 2])
    expect(board?.tickets[0].labels).toEqual(['bug'])
    expect(board?.tickets[0].checklist).toEqual([{ text: 'step', done: true }])
    expect(board?.tickets[0].externalId).toBe('github:7')
    expect(board?.tickets[1].laneId).toBe(UNASSIGNED_LANE_ID)
    expect(loaded.scanDirectories).toEqual(['/Users/example/Projects'])
    expect(loaded.userId).toBe('local')
    expect(loaded.users).toEqual([{ id: 'local', name: 'Local' }])
    expect(board?.tickets[1].assigneeId).toBe('local')
    expect(board?.tickets[0].assigneeId).toBeUndefined()
  })
})


describe('shared projects', () => {
  it('shows one user the edits another made to the same ticket', async () => {
    const userDataPath = freshUserDataPath()
    const asAlice = await StateRepository.create(userDataPath, 'alice')
    const seeded = asAlice.saveState({ ...stateWithBoard(), userId: 'alice' })
    const projectPath = seeded.snapshot.projects[0].path

    // Bob joins the same project, then re-titles a ticket Alice created.
    const asBob = await StateRepository.create(userDataPath, 'bob')
    const bobState = asBob.getState()
    expect(bobState.snapshot.projects).toHaveLength(0)

    asBob.addProjectMember(projectPath, 'bob')
    const joined = asBob.getState()
    expect(joined.snapshot.projects).toHaveLength(1)

    const board = joined.boards![projectPath]
    board.tickets[0] = { ...board.tickets[0], title: 'Edited by Bob', assigneeId: 'bob' }
    asBob.saveState(joined)

    const aliceSees = (await StateRepository.create(userDataPath, 'alice')).getState()
    expect(aliceSees.boards![projectPath].tickets[0].title).toBe('Edited by Bob')
    expect(aliceSees.boards![projectPath].tickets[0].assigneeId).toBe('bob')
  })

  it('leaves projects a user cannot see untouched when they save', async () => {
    const userDataPath = freshUserDataPath()
    const asAlice = await StateRepository.create(userDataPath, 'alice')
    const seeded = asAlice.saveState({ ...stateWithBoard(), userId: 'alice' })
    const projectPath = seeded.snapshot.projects[0].path

    const asBob = await StateRepository.create(userDataPath, 'bob')
    asBob.saveState(asBob.getState())

    const aliceSees = (await StateRepository.create(userDataPath, 'alice')).getState()
    expect(aliceSees.snapshot.projects).toHaveLength(1)
    expect(aliceSees.boards![projectPath].tickets).toHaveLength(2)
  })
})

describe('board preferences', () => {
  it('survives a reopen and stays private to the user who set it', async () => {
    const userDataPath = freshUserDataPath()
    const asAlice = await StateRepository.create(userDataPath, 'alice')
    const seeded = asAlice.saveState({ ...stateWithBoard(), userId: 'alice' })
    const projectPath = seeded.snapshot.projects[0].path

    asAlice.saveState({
      ...asAlice.getState(),
      boardPreferences: {
        [projectPath]: {
          laneWidths: { idea: 420 },
          hiddenLaneIds: ['github-issues'],
          cardFields: ['number']
        }
      }
    })

    const aliceReopened = (await StateRepository.create(userDataPath, 'alice')).getState()
    expect(aliceReopened.boardPreferences?.[projectPath]).toEqual({
      laneWidths: { idea: 420 },
      hiddenLaneIds: ['github-issues'],
      cardFields: ['number']
    })

    const asBob = await StateRepository.create(userDataPath, 'bob')
    asBob.addProjectMember(projectPath, 'bob')
    expect(asBob.getState().boardPreferences).toEqual({})
  })
})
