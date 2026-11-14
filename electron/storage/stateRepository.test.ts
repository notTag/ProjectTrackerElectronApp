import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createSeedState,
  UNASSIGNED_LANE_ID,
  updateLaneInBoard,
  type ProjectTrackerState
} from '../../src/shared/projectTypes.js'
import { SCHEMA_SQL } from './schema.js'
import { DATABASE_FILE_NAME, LEGACY_BACKUP_FILE_NAME, StateRepository } from './stateRepository.js'

const createdUserDataPaths: string[] = []

const freshUserDataPath = () => {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'project-tracker-test-'))
  createdUserDataPaths.push(userDataPath)
  return userDataPath
}

afterEach(() => {
  for (const userDataPath of createdUserDataPaths.splice(0)) {
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

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
          { id: 'prd', name: 'PRD', agentPrompt: '', agentFilePath: '/tmp/prd.md', outputTarget: 'docs/prd/', orchestratorPrompt: 'Poll every 2 minutes.', autoRunAgentId: 'codex', autoRunTerminalId: 'iterm2', autoRunWorktrees: false, fullAuto: true, agentSetsVersion: true, autoRunModel: 'opus', orchestratorAgentId: 'codex', orchestratorModel: 'gpt-5-mini' }
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
            externalUrl: 'https://github.com/o/r/issues/7',
            branchName: 'feat/a',
            worktreePath: '/code/app-a',
            pullRequestUrl: 'https://github.com/o/r/pull/8',
            pullRequestState: 'merged',
            pullRequestMergedAt: '2026-01-04T00:00:00Z',
            fullAuto: true,
            externalLinks: ['https://figma.com/f', 'https://slack.com/t'],
            moveToLaneId: 'prd',
            moveOnComplete: true,
            version: '1.4.0-rc.1',
            agentId: 'codex',
            model: 'gpt-5'
          },
          {
            id: 'ticket-b',
            number: 2,
            laneId: UNASSIGNED_LANE_ID,
            title: 'B',
            description: '',
            createdAt: '2026-01-02T00:00:00.000Z',
            assigneeId: 'local',
            agentRun: { at: '2026-01-03T00:00:00.000Z', laneId: 'idea', output: 'done', succeeded: true }
          }
        ]
      }
    }
  }
}

const seededRepository = (userDataPath: string) => {
  const repository = new StateRepository(userDataPath)
  const saved = repository.saveState(stateWithBoard())
  return { repository, projectPath: saved.snapshot.projects[0].path }
}

const reopenedBoard = (userDataPath: string, projectPath: string) =>
  new StateRepository(userDataPath).getState().boards![projectPath]

describe('StateRepository', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = freshUserDataPath()
  })

  it('round-trips a board through the normalized tables', () => {
    const repository = new StateRepository(userDataPath)
    const saved = repository.saveState(stateWithBoard())
    const loaded = new StateRepository(userDataPath).getState()

    const projectPath = saved.snapshot.projects[0].path
    const board = loaded.boards?.[projectPath]
    expect(board?.lanes.map((lane) => lane.id)).toEqual(['idea', 'prd'])
    expect(board?.lanes[1].agentFilePath).toBe('/tmp/prd.md')
    expect(board?.lanes[1].outputTarget).toBe('docs/prd/')
    expect(board?.lanes[1].orchestratorPrompt).toBe('Poll every 2 minutes.')
    expect(board?.lanes[0].orchestratorPrompt).toBe('')
    expect(board?.lanes[1].autoRunAgentId).toBe('codex')
    expect(board?.lanes[1].autoRunTerminalId).toBe('iterm2')
    expect(board?.lanes[0].autoRunAgentId).toBeUndefined()
    expect(board?.lanes[1].autoRunWorktrees).toBe(false)
    expect(board?.lanes[0].autoRunWorktrees).toBe(true)
    expect(board?.lanes[1].fullAuto).toBe(true)
    expect(board?.lanes[0].fullAuto).toBe(false)
    expect(board?.lanes[1].agentSetsVersion).toBe(true)
    expect(board?.lanes[0].agentSetsVersion).toBe(false)
    expect(board?.tickets[0].version).toBe('1.4.0-rc.1')
    expect(board?.tickets[1].version).toBeUndefined()
    expect(board?.tickets[0].fullAuto).toBe(true)
    expect(board?.tickets[1].fullAuto).toBe(false)
    expect(board?.unassignedLane?.agentPrompt).toBe('Triage this.')
    expect(board?.tickets.map((ticket) => ticket.number)).toEqual([1, 2])
    expect(board?.tickets[0].labels).toEqual(['bug'])
    expect(board?.tickets[0].checklist).toEqual([{ text: 'step', done: true }])
    expect(board?.tickets[0].externalId).toBe('github:7')
    expect(board?.tickets[0].branchName).toBe('feat/a')
    expect(board?.tickets[0].worktreePath).toBe('/code/app-a')
    expect(board?.tickets[0].pullRequestUrl).toBe('https://github.com/o/r/pull/8')
    expect(board?.tickets[0].pullRequestState).toBe('merged')
    expect(board?.tickets[0].pullRequestMergedAt).toBe('2026-01-04T00:00:00Z')
    expect(board?.tickets[1].pullRequestState).toBeUndefined()
    expect(board?.tickets[1].worktreePath).toBeUndefined()
    expect(board?.tickets[0].externalLinks).toEqual(['https://figma.com/f', 'https://slack.com/t'])
    expect(board?.tickets[1].externalLinks).toBeUndefined()
    expect(board?.tickets[1].laneId).toBe(UNASSIGNED_LANE_ID)
    expect(loaded.scanDirectories).toEqual(['/Users/example/Projects'])
    expect(loaded.userId).toBe('local')
    expect(loaded.users).toEqual([{ id: 'local', name: 'Local' }])
    expect(board?.tickets[1].assigneeId).toBe('local')
    expect(board?.tickets[0].assigneeId).toBeUndefined()
    expect(board?.tickets[1].agentRun?.succeeded).toBe(true)
    expect(board?.tickets[0].moveToLaneId).toBe('prd')
    expect(board?.tickets[0].moveOnComplete).toBe(true)
    expect(board?.tickets[1].moveToLaneId).toBeUndefined()
    expect(board?.tickets[1].moveOnComplete).toBe(false)
  })

  it('adds ticket columns missing from a database created before they existed', () => {
    const { projectPath } = seededRepository(userDataPath)
    const olderDatabase = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN worktree_path')
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN pull_request_url')
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN pull_request_state')
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN pull_request_merged_at')
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN move_to_lane_id')
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN move_on_complete')
    olderDatabase.close()

    const repository = new StateRepository(userDataPath)
    const state = repository.getState()
    const migratedTicket = state.boards![projectPath].tickets[0]
    migratedTicket.worktreePath = '/code/app-a'
    migratedTicket.pullRequestUrl = 'https://github.com/o/r/pull/8'
    migratedTicket.pullRequestState = 'open'
    migratedTicket.pullRequestMergedAt = undefined
    expect(migratedTicket.moveOnComplete).toBe(false)
    migratedTicket.moveToLaneId = 'prd'
    migratedTicket.moveOnComplete = true
    repository.saveState(state)

    const reopenedTicket = reopenedBoard(userDataPath, projectPath).tickets[0]
    expect(reopenedTicket.worktreePath).toBe('/code/app-a')
    expect(reopenedTicket.pullRequestUrl).toBe('https://github.com/o/r/pull/8')
    expect(reopenedTicket).toMatchObject({ moveToLaneId: 'prd', moveOnComplete: true })
    expect(reopenedTicket.pullRequestState).toBe('open')
    expect(reopenedTicket.pullRequestMergedAt).toBeUndefined()
  })

  it('adds the version columns to a database created before they existed', () => {
    const { projectPath } = seededRepository(userDataPath)
    const olderDatabase = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN version')
    olderDatabase.exec('ALTER TABLE swim_lanes DROP COLUMN agent_sets_version')
    olderDatabase.close()

    const repository = new StateRepository(userDataPath)
    const state = repository.getState()
    const board = state.boards![projectPath]
    expect(board.tickets[0].version).toBeUndefined()
    expect(board.lanes[1].agentSetsVersion).toBe(false)
    board.tickets[0].version = '2.0.0'
    board.lanes[1].agentSetsVersion = true
    repository.saveState(state)

    const reopened = reopenedBoard(userDataPath, projectPath)
    expect(reopened.tickets[0].version).toBe('2.0.0')
    expect(reopened.lanes[1].agentSetsVersion).toBe(true)
  })

  it('adds the next lane column to a database created before it existed, then round-trips it', () => {
    const { projectPath } = seededRepository(userDataPath)
    const olderDatabase = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    olderDatabase.exec('ALTER TABLE swim_lanes DROP COLUMN next_lane_id')
    olderDatabase.close()

    const repository = new StateRepository(userDataPath)
    const state = repository.getState()
    const board = state.boards![projectPath]
    expect(board.lanes.map((lane) => lane.nextLaneId)).toEqual(board.lanes.map(() => undefined))
    board.lanes[0].nextLaneId = board.lanes[1].id
    repository.saveState(state)

    const reopened = reopenedBoard(userDataPath, projectPath)
    expect(reopened.lanes[0].nextLaneId).toBe(board.lanes[1].id)
    expect(reopened.lanes[1].nextLaneId).toBeUndefined()
  })

  it('adds the agent model columns to a database created before they existed', () => {
    const { projectPath } = seededRepository(userDataPath)
    const olderDatabase = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    for (const column of ['auto_run_model', 'orchestrator_agent_id', 'orchestrator_model']) {
      olderDatabase.exec(`ALTER TABLE swim_lanes DROP COLUMN ${column}`)
    }
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN agent_id')
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN model')
    olderDatabase.close()

    const repository = new StateRepository(userDataPath)
    const state = repository.getState()
    const board = state.boards![projectPath]
    expect(board.lanes[1]).toMatchObject({ autoRunModel: undefined, orchestratorAgentId: undefined, orchestratorModel: undefined })
    expect(board.tickets[0]).toMatchObject({ agentId: undefined, model: undefined })
    board.lanes[1].orchestratorAgentId = 'opencode'
    board.tickets[0].agentId = 'codex'
    board.tickets[0].model = 'gpt-5'
    repository.saveState(state)

    const reopened = reopenedBoard(userDataPath, projectPath)
    expect(reopened.lanes[1].orchestratorAgentId).toBe('opencode')
    expect(reopened.tickets[0]).toMatchObject({ agentId: 'codex', model: 'gpt-5' })
  })

  it('loads tickets with no links from a database created before external links existed', () => {
    const { projectPath } = seededRepository(userDataPath)
    const olderDatabase = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN external_links_json')
    olderDatabase.close()

    const repository = new StateRepository(userDataPath)
    const state = repository.getState()
    const migratedTicket = state.boards![projectPath].tickets[0]
    expect(migratedTicket.externalLinks).toBeUndefined()
    migratedTicket.externalLinks = ['https://a.dev']
    repository.saveState(state)

    expect(reopenedBoard(userDataPath, projectPath).tickets[0].externalLinks).toEqual(['https://a.dev'])
  })

  it('removes lanes, tickets and paths the saved state no longer has', () => {
    const { repository, projectPath } = seededRepository(userDataPath)
    const state = repository.getState()
    const board = state.boards![projectPath]
    board.lanes = board.lanes.filter((lane) => lane.id !== 'prd')
    board.tickets = board.tickets.filter((ticket) => ticket.id !== 'ticket-b')
    repository.saveState({ ...state, hiddenPaths: [] })

    const reopened = new StateRepository(userDataPath).getState()
    expect(reopened.boards![projectPath].lanes.map((lane) => lane.id)).toEqual(['idea'])
    expect(reopened.boards![projectPath].tickets.map((ticket) => ticket.id)).toEqual(['ticket-a'])
    expect(reopened.hiddenPaths).toEqual([])
  })
})

describe('row-level writes', () => {
  it('creates, updates, moves and deletes a single ticket', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)

    const created = repository.createTicket(projectPath, {
      id: 'ticket-c',
      laneId: 'idea',
      title: 'C',
      description: '',
      createdAt: '2026-01-03T00:00:00.000Z'
    })
    expect(created.number).toBe(3)

    repository.updateTicket('ticket-c', { title: 'C, retitled', labels: ['ui'] })
    repository.updateTicket('ticket-c', { laneId: 'prd' })
    const afterEdit = reopenedBoard(userDataPath, projectPath).tickets.find((ticket) => ticket.id === 'ticket-c')
    expect(afterEdit).toMatchObject({ number: 3, title: 'C, retitled', labels: ['ui'], laneId: 'prd' })

    repository.deleteTicket('ticket-c')
    const remainingIds = reopenedBoard(userDataPath, projectPath).tickets.map((ticket) => ticket.id)
    expect(remainingIds).toEqual(['ticket-a', 'ticket-b'])
  })

  it('creates, updates, reorders and deletes a swim lane', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)

    const created = repository.createSwimLane(projectPath, { id: 'qa', name: 'QA', agentPrompt: '', agentFilePath: '' })
    expect(created.name).toBe('QA')
    repository.updateSwimLane(projectPath, 'idea', { name: 'Ideas', autoRunModel: null })
    repository.reorderSwimLanes(projectPath, ['qa', 'idea', 'prd'])
    repository.deleteSwimLane(projectPath, 'prd')

    const lanes = reopenedBoard(userDataPath, projectPath).lanes
    expect(lanes.map((lane) => [lane.id, lane.name])).toEqual([['qa', 'QA'], ['idea', 'Ideas']])
  })

  it('refuses to create a lane whose id is already stored, keeping its config', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)
    repository.updateSwimLane(projectPath, 'idea', { agentPrompt: 'keep me' })

    const staleCopy = { id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '' }
    expect(() => repository.createSwimLane(projectPath, staleCopy)).toThrow('already exists')

    const idea = reopenedBoard(userDataPath, projectPath).lanes.find((lane) => lane.id === 'idea')
    expect(idea?.agentPrompt).toBe('keep me')
  })

  it('configures the unassigned column even before it has a row', () => {
    const userDataPath = freshUserDataPath()
    const repository = new StateRepository(userDataPath)
    const projectPath = repository.getState().snapshot.projects[0].path

    repository.updateSwimLane(projectPath, UNASSIGNED_LANE_ID, { agentPrompt: 'Sort it.' })

    expect(reopenedBoard(userDataPath, projectPath).unassignedLane?.agentPrompt).toBe('Sort it.')
  })

  it('stamps updatedAt only when the patch does not carry it', () => {
    const userDataPath = freshUserDataPath()
    const { repository } = seededRepository(userDataPath)

    const stamped = repository.updateTicket('ticket-a', { title: 'A2' })
    expect(stamped.updatedAt).toBeDefined()
    const kept = repository.updateTicket('ticket-a', { title: 'A3', updatedAt: '2026-02-02T00:00:00.000Z' })
    expect(kept.updatedAt).toBe('2026-02-02T00:00:00.000Z')
    const cleared = repository.updateTicket('ticket-b', { assigneeId: null, updatedAt: null })
    expect(cleared.updatedAt).toBeUndefined()
    expect(cleared.assigneeId).toBeUndefined()
  })

  it('keeps a lane missing from a reorder on the board, after the listed ones', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)
    new StateRepository(userDataPath).createSwimLane(projectPath, { id: 'late', name: 'Late', agentPrompt: '', agentFilePath: '' })

    repository.reorderSwimLanes(projectPath, ['prd', 'idea'])

    expect(reopenedBoard(userDataPath, projectPath).lanes.map((lane) => lane.id)).toEqual(['prd', 'idea', 'late'])
  })

  it('updates only the hand-edited fields of a project', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)

    const updated = repository.updateProject(projectPath, { notes: 'ship it', priority: 'high' })

    const reloaded = new StateRepository(userDataPath).getState().snapshot.projects[0]
    expect(reloaded).toEqual(updated)
    expect(reloaded).toMatchObject({ notes: 'ship it', priority: 'high' })
  })
})

const OTHER_PROJECT_PATH = '/Users/example/Projects/other'

// Two projects with boards, so a write to one can be checked against the other.
const twoProjectRepository = (userDataPath: string) => {
  const repository = new StateRepository(userDataPath)
  const base = stateWithBoard()
  const otherProject = { ...base.snapshot.projects[0], path: OTHER_PROJECT_PATH, name: 'other' }
  const otherBoard = {
    lanes: [
      { id: 'idea', name: 'Idea', agentPrompt: '', agentFilePath: '' },
      { id: 'prd', name: 'PRD', agentPrompt: '', agentFilePath: '' }
    ],
    tickets: [{ id: 'ticket-x', number: 1, laneId: 'idea', title: 'X', description: '', createdAt: '2026-01-01T00:00:00.000Z' }]
  }
  const projectPath = base.snapshot.projects[0].path
  repository.saveState({
    ...base,
    snapshot: { ...base.snapshot, projects: [...base.snapshot.projects, otherProject] },
    boards: { ...base.boards, [OTHER_PROJECT_PATH]: otherBoard }
  })
  return { repository, projectPath }
}

type DumpedRows = Record<string, unknown>[]
const dumpRows = (userDataPath: string) => {
  const db = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
  const rows = {
    tickets: db.prepare('SELECT * FROM tickets ORDER BY id').all() as DumpedRows,
    lanes: db.prepare('SELECT * FROM swim_lanes ORDER BY project_path, id').all() as DumpedRows,
    projects: db.prepare('SELECT * FROM projects ORDER BY path').all() as DumpedRows
  }
  db.close()
  return rows
}
const ticketRowsExcept = (rows: DumpedRows, ticketId: string) => rows.filter((row) => row.id !== ticketId)
const laneRowsOf = (rows: DumpedRows, projectPath: string) => rows.filter((row) => row.project_path === projectPath)
const laneRowsExcept = (rows: DumpedRows, projectPath: string, laneId: string) =>
  rows.filter((row) => !(row.project_path === projectPath && row.id === laneId))

describe('per-entity writes leave unrelated rows alone', () => {
  it('ticket create, update, move and delete touch only that ticket', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = twoProjectRepository(userDataPath)
    const before = dumpRows(userDataPath)

    repository.createTicket(projectPath, { id: 'ticket-c', laneId: 'idea', title: 'C', description: '', createdAt: '2026-01-05T00:00:00.000Z' })
    repository.updateTicket('ticket-c', { title: 'C2' })
    repository.updateTicket('ticket-c', { laneId: 'prd' })
    const afterEdits = dumpRows(userDataPath)
    repository.deleteTicket('ticket-c')
    const afterDelete = dumpRows(userDataPath)

    expect(ticketRowsExcept(afterEdits.tickets, 'ticket-c')).toEqual(before.tickets)
    expect(afterDelete.tickets).toEqual(before.tickets)
    expect(afterDelete.lanes).toEqual(before.lanes)
    expect(afterDelete.projects).toEqual(before.projects)
  })

  it('lane create, update and delete touch only that lane', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = twoProjectRepository(userDataPath)
    const before = dumpRows(userDataPath)

    repository.createSwimLane(projectPath, { id: 'qa', name: 'QA', agentPrompt: '', agentFilePath: '' })
    repository.updateSwimLane(projectPath, 'qa', { name: 'In QA' })
    const afterEdits = dumpRows(userDataPath)
    repository.deleteSwimLane(projectPath, 'qa')
    const afterDelete = dumpRows(userDataPath)

    expect(laneRowsExcept(afterEdits.lanes, projectPath, 'qa')).toEqual(before.lanes)
    expect(afterDelete).toEqual(before)
  })

  it('a lane reorder touches only that board', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = twoProjectRepository(userDataPath)
    const before = dumpRows(userDataPath)

    repository.reorderSwimLanes(projectPath, ['prd', 'idea'])
    const after = dumpRows(userDataPath)

    expect(laneRowsOf(after.lanes, OTHER_PROJECT_PATH)).toEqual(laneRowsOf(before.lanes, OTHER_PROJECT_PATH))
    expect(after.tickets).toEqual(before.tickets)
    expect(after.projects).toEqual(before.projects)
  })

  it('a project update touches only that project row', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = twoProjectRepository(userDataPath)
    const before = dumpRows(userDataPath)

    repository.updateProject(projectPath, { notes: 'n' })
    const after = dumpRows(userDataPath)

    expect(after.projects.filter((row) => row.path !== projectPath)).toEqual(
      before.projects.filter((row) => row.path !== projectPath)
    )
    expect(after.tickets).toEqual(before.tickets)
    expect(after.lanes).toEqual(before.lanes)
  })

  it('keeps what a second connection changed between the read and the write', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = twoProjectRepository(userDataPath)
    repository.getState()
    const otherWriter = new StateRepository(userDataPath)
    otherWriter.updateTicket('ticket-x', { title: 'X by agent' })
    otherWriter.updateSwimLane(OTHER_PROJECT_PATH, 'prd', { name: 'PRD by agent' })
    otherWriter.updateProject(OTHER_PROJECT_PATH, { notes: 'agent notes' })
    const afterOtherWriter = dumpRows(userDataPath)

    repository.updateTicket('ticket-a', { title: 'A edited' })
    repository.createSwimLane(projectPath, { id: 'qa', name: 'QA', agentPrompt: '', agentFilePath: '' })
    repository.reorderSwimLanes(projectPath, ['qa', 'prd', 'idea'])
    repository.updateProject(projectPath, { notes: 'mine' })
    const after = dumpRows(userDataPath)

    expect(ticketRowsExcept(after.tickets, 'ticket-a')).toEqual(ticketRowsExcept(afterOtherWriter.tickets, 'ticket-a'))
    expect(laneRowsOf(after.lanes, OTHER_PROJECT_PATH)).toEqual(laneRowsOf(afterOtherWriter.lanes, OTHER_PROJECT_PATH))
    expect(after.projects.find((row) => row.path === OTHER_PROJECT_PATH)?.notes).toBe('agent notes')
  })
})

describe('per-entity writes and the save baseline', () => {
  // The renderer splices each written entity into its state, so a later
  // whole-state save (a scan, board preferences) carries them unchanged. With
  // the baseline patched they diff as nothing, and an agent's later edit to the
  // same rows survives instead of being overwritten from the renderer's copy.
  it('a later whole-state save does not write them back over an outside edit', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = twoProjectRepository(userDataPath)
    repository.getState()

    repository.updateTicket('ticket-a', { title: 'A edited' })
    repository.createTicket(projectPath, { id: 'ticket-c', laneId: 'idea', title: 'C', description: '', createdAt: '2026-01-05T00:00:00.000Z' })
    repository.deleteTicket('ticket-b')
    repository.createSwimLane(projectPath, { id: 'qa', name: 'QA', agentPrompt: '', agentFilePath: '' })
    repository.updateSwimLane(projectPath, 'idea', { name: 'Ideas' })
    repository.reorderSwimLanes(projectPath, ['qa', 'prd', 'idea'])
    repository.updateProject(projectPath, { notes: 'mine' })
    const rendererState = new StateRepository(userDataPath).getState()

    const agent = new StateRepository(userDataPath)
    agent.updateTicket('ticket-a', { title: 'A by agent' })
    agent.updateSwimLane(projectPath, 'idea', { name: 'Ideas by agent' })
    agent.updateProject(projectPath, { notes: 'agent notes' })
    repository.saveState({ ...rendererState, scanDirectories: [...rendererState.scanDirectories, '/Users/example/More'] })

    const reloaded = new StateRepository(userDataPath).getState()
    const board = reloaded.boards![projectPath]
    expect(board.tickets.map((ticket) => [ticket.id, ticket.title])).toEqual([
      ['ticket-a', 'A by agent'],
      ['ticket-c', 'C']
    ])
    expect(board.lanes.map((lane) => [lane.id, lane.name])).toEqual([
      ['qa', 'QA'],
      ['prd', 'PRD'],
      ['idea', 'Ideas by agent']
    ])
    expect(reloaded.snapshot.projects.find((project) => project.path === projectPath)?.notes).toBe('agent notes')
    expect(reloaded.scanDirectories).toContain('/Users/example/More')
  })
})

describe('concurrent writers', () => {
  it('keeps a sqlite3 CLI edit to another ticket through the next whole-state save', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)
    const rendererState = repository.getState()

    const cli = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    cli.prepare("UPDATE tickets SET title = 'Edited in the CLI' WHERE id = 'ticket-b'").run()
    cli.prepare(
      `INSERT INTO tickets (id, project_path, lane_id, number, title, description, created_at)
       VALUES ('ticket-cli', ?, 'idea', 3, 'Inserted in the CLI', '', '2026-01-04T00:00:00.000Z')`
    ).run(projectPath)
    cli.close()

    const board = rendererState.boards![projectPath]
    board.tickets[0] = { ...board.tickets[0], title: 'Edited in the app' }
    const returned = repository.saveState(rendererState)

    const titles = reopenedBoard(userDataPath, projectPath).tickets.map((ticket) => ticket.title)
    expect(titles).toEqual(['Edited in the app', 'Edited in the CLI', 'Inserted in the CLI'])
    // The renderer adopts what saveState returns, so it sees the CLI edits too.
    expect(returned.boards![projectPath].tickets.map((ticket) => ticket.title)).toEqual(titles)
  })

  it('keeps a CLI lane move when the app edits a different field of the same ticket', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)
    const rendererState = repository.getState()

    const cli = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    cli.prepare("UPDATE tickets SET lane_id = 'prd' WHERE id = 'ticket-a'").run()
    cli.close()

    // The renderer still holds ticket-a in 'idea' and edits only its title.
    const board = rendererState.boards![projectPath]
    board.tickets[0] = { ...board.tickets[0], title: 'Renamed in the app' }
    repository.saveState(rendererState)

    const ticket = reopenedBoard(userDataPath, projectPath).tickets.find((entry) => entry.id === 'ticket-a')!
    expect(ticket.laneId).toBe('prd')
    expect(ticket.title).toBe('Renamed in the app')
  })

  // sqlite3's readfile() returns a BLOB, which SQLite keeps as-is in a TEXT column.
  it('reads BLOB-stored text and JSON columns as text, and keeps them intact through a save', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)

    const asBlob = (text: string) => new TextEncoder().encode(text)
    const cli = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    cli
      .prepare("UPDATE tickets SET description = ?, checklist_json = ?, labels_json = ? WHERE id = 'ticket-b'")
      .run(asBlob('## Context\nÜnïcode'), asBlob('[{"text":"read it","done":false}]'), asBlob('["agent"]'))
    cli.close()

    const expected = {
      description: '## Context\nÜnïcode',
      checklist: [{ text: 'read it', done: false }],
      labels: ['agent']
    }
    const state = repository.getState()
    const tickets = state.boards![projectPath].tickets
    const ticketIndex = tickets.findIndex((ticket) => ticket.id === 'ticket-b')
    expect(tickets[ticketIndex]).toMatchObject(expected)

    tickets[ticketIndex] = { ...tickets[ticketIndex], title: 'Edited in the app' }
    repository.saveState(state)

    const reopened = reopenedBoard(userDataPath, projectPath).tickets.find((ticket) => ticket.id === 'ticket-b')
    expect(reopened).toMatchObject({ ...expected, title: 'Edited in the app' })

    // Editing the ticket rewrites its row, so the BLOBs are stored as TEXT from then on.
    const inspector = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    const storedTypes = inspector
      .prepare("SELECT typeof(description) AS description, typeof(checklist_json) AS checklist FROM tickets WHERE id = 'ticket-b'")
      .get()
    inspector.close()
    expect(storedTypes).toEqual({ description: 'text', checklist: 'text' })
  })

  it('writes a field the app cleared', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)
    const rendererState = repository.getState()

    const board = rendererState.boards![projectPath]
    board.tickets[0] = { ...board.tickets[0], labels: undefined }
    repository.saveState(rendererState)

    const ticket = reopenedBoard(userDataPath, projectPath).tickets.find((entry) => entry.id === 'ticket-a')!
    expect(ticket.labels).toBeUndefined()
  })

  it('reports changes committed by another connection, not its own writes', () => {
    const userDataPath = freshUserDataPath()
    const { repository } = seededRepository(userDataPath)
    const rendererState = repository.getState()
    expect(repository.hasExternalChanges()).toBe(false)

    repository.saveState({ ...rendererState, scanDirectories: ['/Users/example/Other'] })
    expect(repository.hasExternalChanges()).toBe(false)

    const cli = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    cli.prepare("UPDATE tickets SET title = 'From outside' WHERE id = 'ticket-b'").run()
    cli.close()
    expect(repository.hasExternalChanges()).toBe(true)

    repository.getState()
    expect(repository.hasExternalChanges()).toBe(false)
  })

  it('lets two repositories on one file write different rows without losing either', () => {
    const userDataPath = freshUserDataPath()
    const { projectPath } = seededRepository(userDataPath)
    const first = new StateRepository(userDataPath)
    const second = new StateRepository(userDataPath)
    const firstState = first.getState()
    const secondState = second.getState()

    firstState.boards![projectPath].tickets[0].title = 'First instance'
    secondState.boards![projectPath].tickets[1].title = 'Second instance'
    first.saveState(firstState)
    second.saveState(secondState)

    const titles = reopenedBoard(userDataPath, projectPath).tickets.map((ticket) => ticket.title)
    expect(titles).toEqual(['First instance', 'Second instance'])
  })

  it('gives tickets created at once by two instances distinct numbers', () => {
    const userDataPath = freshUserDataPath()
    const { projectPath } = seededRepository(userDataPath)
    const first = new StateRepository(userDataPath)
    const second = new StateRepository(userDataPath)

    // Both renderers number their new ticket 3 from their own copy of the board.
    const newTicket = (id: string) => ({ id, number: 3, laneId: 'idea', title: id, description: '', createdAt: '' })
    const firstState = first.getState()
    const secondState = second.getState()
    firstState.boards![projectPath].tickets.push(newTicket('from-first'))
    secondState.boards![projectPath].tickets.push(newTicket('from-second'))
    first.saveState(firstState)
    second.saveState(secondState)
    const rowLevel = first.createTicket(projectPath, { id: 'row-level', laneId: 'idea', title: '', description: '', createdAt: '' })

    const numbers = reopenedBoard(userDataPath, projectPath).tickets.map((ticket) => [ticket.id, ticket.number])
    expect(numbers).toEqual([
      ['ticket-a', 1],
      ['ticket-b', 2],
      ['from-first', 3],
      ['from-second', 4],
      ['row-level', 5]
    ])
    expect(rowLevel.number).toBe(5)
  })
})

describe('legacy databases', () => {
  // sql.js wrote plain rollback-journal SQLite files, which is what a fresh
  // DatabaseSync produces before anything switches it to WAL.
  it('opens a sql.js-era file in place with its data intact, adds new columns and backs it up', () => {
    const userDataPath = freshUserDataPath()
    // sql.js ran with foreign keys off; node:sqlite turns them on by default.
    const legacy = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME), {
      enableForeignKeyConstraints: false
    })
    legacy.exec(`CREATE TABLE swim_lanes (
      id TEXT NOT NULL, project_path TEXT NOT NULL, name TEXT NOT NULL, agent_prompt TEXT NOT NULL,
      agent_file_path TEXT NOT NULL, position INTEGER NOT NULL, is_unassigned INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_path, id))`)
    legacy.exec(SCHEMA_SQL)
    legacy.exec(`
      INSERT INTO users VALUES ('local', 'Local', '2026-01-01T00:00:00.000Z');
      INSERT INTO projects (path, name, status, priority, notes, source, has_git, has_package_json, has_readme, last_scanned_at)
        VALUES ('/legacy', 'Legacy', 'active', 'medium', '', 'scan', 1, 0, 0, '2026-01-01T00:00:00.000Z');
      INSERT INTO project_members VALUES ('/legacy', 'local', '2026-01-01T00:00:00.000Z');
      INSERT INTO swim_lanes VALUES ('idea', '/legacy', 'Idea', '', '', 0, 0);
      INSERT INTO tickets (id, project_path, lane_id, number, title, description, created_at)
        VALUES ('old-ticket', '/legacy', 'idea', 1, 'From sql.js', '', '2026-01-01T00:00:00.000Z');
      INSERT INTO tickets (id, project_path, lane_id, assignee_id, number, title, description, created_at)
        VALUES ('ghost-assignee', '/legacy', 'idea', 'gone-user', 2, 'Kept', '', '2026-01-01T00:00:00.000Z');
      INSERT INTO project_members VALUES ('/deleted', 'local', '2026-01-01T00:00:00.000Z');
      INSERT INTO tickets (id, project_path, lane_id, number, title, description, created_at)
        VALUES ('orphan-ticket', '/deleted', 'idea', 1, 'Orphan', '', '2026-01-01T00:00:00.000Z');
      INSERT INTO user_settings VALUES ('local', 'version', '1');`)
    expect(legacy.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('delete')
    legacy.close()

    const state = new StateRepository(userDataPath).getState()
    expect(state.snapshot.projects.map((project) => project.name)).toEqual(['Legacy'])
    expect(state.boards!['/legacy'].tickets.map((ticket) => ticket.title)).toEqual(['From sql.js', 'Kept'])
    expect(state.boards!['/legacy'].lanes[0].outputTarget).toBe('')
    expect(state.boards!['/legacy'].lanes[0].orchestratorPrompt).toBe('')
    expect(state.boards!['/legacy'].lanes[0].fullAuto).toBe(false)
    expect(existsSync(path.join(userDataPath, LEGACY_BACKUP_FILE_NAME))).toBe(true)

    const reopened = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    expect(reopened.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal')
    const remainingViolations = reopened.prepare('PRAGMA foreign_key_check').all()
    expect(remainingViolations.map((violation) => violation.parent)).toEqual(['users'])
    reopened.close()
  })

  it('does not back up a database that is already in WAL mode', () => {
    const userDataPath = freshUserDataPath()
    new StateRepository(userDataPath)
    new StateRepository(userDataPath)
    expect(existsSync(path.join(userDataPath, LEGACY_BACKUP_FILE_NAME))).toBe(false)
  })
})

describe('shared projects', () => {
  it('shows one user the edits another made to the same ticket', () => {
    const userDataPath = freshUserDataPath()
    const asAlice = new StateRepository(userDataPath, 'alice')
    const seeded = asAlice.saveState({ ...stateWithBoard(), userId: 'alice' })
    const projectPath = seeded.snapshot.projects[0].path

    // Bob joins the same project, then re-titles a ticket Alice created.
    const asBob = new StateRepository(userDataPath, 'bob')
    const bobState = asBob.getState()
    expect(bobState.snapshot.projects).toHaveLength(0)

    asBob.addProjectMember(projectPath, 'bob')
    const joined = asBob.getState()
    expect(joined.snapshot.projects).toHaveLength(1)

    const board = joined.boards![projectPath]
    board.tickets[0] = { ...board.tickets[0], title: 'Edited by Bob', assigneeId: 'bob' }
    asBob.saveState(joined)

    const aliceSees = new StateRepository(userDataPath, 'alice').getState()
    expect(aliceSees.boards![projectPath].tickets[0].title).toBe('Edited by Bob')
    expect(aliceSees.boards![projectPath].tickets[0].assigneeId).toBe('bob')
  })

  it('leaves projects a user cannot see untouched when they save', () => {
    const userDataPath = freshUserDataPath()
    const asAlice = new StateRepository(userDataPath, 'alice')
    const seeded = asAlice.saveState({ ...stateWithBoard(), userId: 'alice' })
    const projectPath = seeded.snapshot.projects[0].path

    const asBob = new StateRepository(userDataPath, 'bob')
    asBob.saveState(asBob.getState())

    const aliceSees = new StateRepository(userDataPath, 'alice').getState()
    expect(aliceSees.snapshot.projects).toHaveLength(1)
    expect(aliceSees.boards![projectPath].tickets).toHaveLength(2)
  })
})

describe('board preferences', () => {
  it('survives a reopen and stays private to the user who set it', () => {
    const userDataPath = freshUserDataPath()
    const asAlice = new StateRepository(userDataPath, 'alice')
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

    const aliceReopened = new StateRepository(userDataPath, 'alice').getState()
    expect(aliceReopened.boardPreferences?.[projectPath]).toEqual({
      laneWidths: { idea: 420 },
      hiddenLaneIds: ['github-issues'],
      cardFields: ['number']
    })

    const asBob = new StateRepository(userDataPath, 'bob')
    asBob.addProjectMember(projectPath, 'bob')
    expect(asBob.getState().boardPreferences).toEqual({})
  })
})

describe('StateRepository archived projects', () => {
  it('keeps an archived project and its board through a save and reopen', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)
    const loaded = repository.getState()
    const archivedProjects = loaded.snapshot.projects.map((project) => ({ ...project, archived: true }))
    repository.saveState({ ...loaded, snapshot: { ...loaded.snapshot, projects: archivedProjects } })

    const reopened = new StateRepository(userDataPath).getState()
    expect(reopened.snapshot.projects.map((project) => [project.path, project.archived])).toEqual([[projectPath, true]])
    expect(reopened.boards?.[projectPath].tickets.map((ticket) => ticket.id)).toEqual(['ticket-a', 'ticket-b'])
  })

  it('adds the archived column to a database created before it existed', () => {
    const userDataPath = freshUserDataPath()
    const { projectPath } = seededRepository(userDataPath)
    const olderDatabase = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    olderDatabase.exec('ALTER TABLE projects DROP COLUMN archived')
    olderDatabase.close()

    const reopened = new StateRepository(userDataPath).getState()
    expect(reopened.snapshot.projects.map((project) => [project.path, project.archived])).toEqual([[projectPath, false]])
  })

  it('creates the unassigned lane row the first time it is configured', () => {
    const userDataPath = freshUserDataPath()
    const repository = new StateRepository(userDataPath)
    const initial = stateWithBoard()
    const projectPath = initial.snapshot.projects[0].path
    const { unassignedLane: _dropped, ...boardWithoutUnassigned } = initial.boards![projectPath]
    const saved = repository.saveState({ ...initial, boards: { [projectPath]: boardWithoutUnassigned } })

    const database = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    const countUnassignedRows = () =>
      database.prepare('SELECT COUNT(*) AS count FROM swim_lanes WHERE is_unassigned = 1').get() as { count: number }
    expect(countUnassignedRows().count).toBe(0)

    const agentFilePath = `${projectPath}/agent-context/app-No-status-AgentContext.md`
    const patch = { agentPrompt: 'Triage this.', agentFilePath }
    const updatedBoard = updateLaneInBoard(saved.boards![projectPath], UNASSIGNED_LANE_ID, patch)
    repository.saveState({ ...saved, boards: { [projectPath]: updatedBoard } })

    const row = database
      .prepare('SELECT id, agent_file_path FROM swim_lanes WHERE is_unassigned = 1')
      .get() as { id: string; agent_file_path: string }
    database.close()
    expect(row).toEqual({ id: UNASSIGNED_LANE_ID, agent_file_path: agentFilePath })
    expect(reopenedBoard(userDataPath, projectPath).unassignedLane?.agentFilePath).toBe(agentFilePath)
  })
})

describe('closed_at triggers (#27)', () => {
  const setUp = () => {
    const userDataPath = freshUserDataPath()
    const repository = new StateRepository(userDataPath)
    const state = stateWithBoard()
    const projectPath = state.snapshot.projects[0].path
    state.boards[projectPath].lanes.push(
      { id: 'in-dev', name: 'In Dev', agentPrompt: '', agentFilePath: '', closesTicket: true },
      { id: 'in-production', name: 'In Production', agentPrompt: '', agentFilePath: '', closesTicket: true }
    )
    repository.saveState(state)
    // A second connection stands in for an agent running the sqlite3 CLI.
    const cli = new DatabaseSync(path.join(userDataPath, DATABASE_FILE_NAME))
    const closedAt = (ticketId: string) =>
      cli.prepare('SELECT closed_at FROM tickets WHERE id = ?').get(ticketId)?.closed_at as string | null
    const moveWithCli = (ticketId: string, laneId: string) =>
      cli.prepare('UPDATE tickets SET lane_id = ? WHERE id = ?').run(laneId, ticketId)
    return { userDataPath, repository, projectPath, cli, closedAt, moveWithCli }
  }

  it('stamps on a move into a closing lane, keeps it closing to closing, clears it on the way out', () => {
    const { cli, closedAt, moveWithCli } = setUp()
    expect(closedAt('ticket-a')).toBeNull()

    moveWithCli('ticket-a', 'in-dev')
    const stamped = closedAt('ticket-a')
    expect(stamped).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)

    cli.prepare("UPDATE tickets SET closed_at = '2026-01-05T00:00:00.000Z' WHERE id = 'ticket-a'").run()
    moveWithCli('ticket-a', 'in-production')
    expect(closedAt('ticket-a')).toBe('2026-01-05T00:00:00.000Z')

    moveWithCli('ticket-a', 'idea')
    expect(closedAt('ticket-a')).toBeNull()
    cli.close()
  })

  it('stamps a ticket created straight into a closing lane, and an app-side move', () => {
    const { repository, projectPath, cli, closedAt } = setUp()
    const created = repository.createTicket(projectPath, {
      id: 'ticket-c',
      laneId: 'in-dev',
      title: 'C',
      description: '',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    expect(closedAt(created.id)).not.toBeNull()

    repository.updateTicket('ticket-b', { laneId: 'in-production' })
    expect(closedAt('ticket-b')).not.toBeNull()
    cli.close()
  })

  it('an app save that rewrites the row, lane_id included, leaves closed_at alone', () => {
    const { repository, projectPath, cli, closedAt, moveWithCli } = setUp()
    moveWithCli('ticket-a', 'in-dev')
    cli.prepare("UPDATE tickets SET closed_at = '2026-01-05T00:00:00.000Z' WHERE id = 'ticket-a'").run()

    const state = repository.getState()
    const ticket = state.boards[projectPath].tickets.find((entry) => entry.id === 'ticket-a')!
    ticket.title = 'Renamed'
    repository.saveState(state)

    expect(closedAt('ticket-a')).toBe('2026-01-05T00:00:00.000Z')
    cli.close()
  })

  it('flagging a lane later closes what sits in it; unflagging reopens them', () => {
    const { repository, projectPath, cli, closedAt } = setUp()
    const state = repository.getState()
    state.boards[projectPath] = updateLaneInBoard(state.boards[projectPath], 'idea', { closesTicket: true })
    repository.saveState(state)
    expect(closedAt('ticket-a')).toBe('2026-01-01T00:00:00.000Z')

    const next = repository.getState()
    next.boards[projectPath] = updateLaneInBoard(next.boards[projectPath], 'idea', { closesTicket: false })
    repository.saveState(next)
    expect(closedAt('ticket-a')).toBeNull()
    cli.close()
  })

  it('a lane row first inserted already flagged closes what sits in it', () => {
    const { projectPath, cli, closedAt, moveWithCli } = setUp()
    moveWithCli('ticket-a', 'later-lane')
    cli
      .prepare(
        `INSERT INTO swim_lanes (id, project_path, name, agent_prompt, agent_file_path, position, closes_ticket) VALUES ('later-lane', ?, 'Later', '', '', 99, 1)`
      )
      .run(projectPath)
    expect(closedAt('ticket-a')).not.toBeNull()
    cli.close()
  })

  it('a closing → closing move stamps a ticket that never got a closed_at', () => {
    const { cli, closedAt, moveWithCli } = setUp()
    moveWithCli('ticket-a', 'in-dev')
    cli.exec("UPDATE tickets SET closed_at = NULL WHERE id = 'ticket-a'")
    moveWithCli('ticket-a', 'in-production')
    expect(closedAt('ticket-a')).not.toBeNull()
    cli.close()
  })

  it('upgrading an older file seeds the closing lanes once and backfills their tickets', () => {
    const { userDataPath, cli, closedAt, moveWithCli } = setUp()
    moveWithCli('ticket-a', 'in-dev')
    cli.exec(`
      UPDATE swim_lanes SET closes_ticket = 0;
      UPDATE tickets SET closed_at = NULL, updated_at = '2026-02-02T00:00:00.000Z' WHERE id = 'ticket-a';
      UPDATE schema_meta SET version = 4;
    `)

    new StateRepository(userDataPath)
    const seeded = cli.prepare("SELECT id FROM swim_lanes WHERE closes_ticket = 1 ORDER BY id").all().map((row) => row.id)
    expect(seeded).toEqual(['in-dev', 'in-production'])
    expect(closedAt('ticket-a')).toBe('2026-02-02T00:00:00.000Z')

    // Already at the current version: a lane the user unflagged stays unflagged.
    cli.exec("UPDATE swim_lanes SET closes_ticket = 0 WHERE id = 'in-dev'")
    new StateRepository(userDataPath)
    const flag = cli.prepare("SELECT closes_ticket FROM swim_lanes WHERE id = 'in-dev'").get()?.closes_ticket
    expect(flag).toBe(0)
    cli.close()
  })

  it('counts closed tickets per window, only for visible, non-archived projects', () => {
    const { repository, projectPath, cli } = setUp()
    cli.exec(`
      UPDATE tickets SET lane_id = 'in-dev' WHERE id IN ('ticket-a', 'ticket-b');
      UPDATE tickets SET closed_at = '2026-11-09T10:00:00.000Z' WHERE id = 'ticket-a';
      UPDATE tickets SET closed_at = '2026-03-01T10:00:00.000Z' WHERE id = 'ticket-b';
    `)
    const windows = {
      today: '2026-11-09T05:00:00.000Z',
      week: '2026-11-02T10:00:00.000Z',
      month: '2026-11-01T04:00:00.000Z',
      year: '2026-01-01T05:00:00.000Z'
    }
    const [metrics] = repository.closedTicketMetrics([projectPath, '/not/a/project'], windows)
    expect(metrics).toMatchObject({
      projectPath,
      hasClosingLanes: true,
      closed: { today: 1, week: 1, month: 1, year: 2 }
    })
    expect(repository.closedTicketMetrics(['/not/a/project'], windows)).toEqual([])

    cli.exec(`UPDATE projects SET archived = 1`)
    expect(repository.closedTicketMetrics([projectPath], windows)).toEqual([])
    cli.close()
  })
})
