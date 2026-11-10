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
          { id: 'prd', name: 'PRD', agentPrompt: '', agentFilePath: '/tmp/prd.md', outputTarget: 'docs/prd/', autoRunAgentId: 'codex', autoRunTerminalId: 'iterm2', autoRunWorktrees: false, fullAuto: true }
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
            fullAuto: true,
            moveToLaneId: 'prd',
            moveOnComplete: true
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
    expect(board?.lanes[1].autoRunAgentId).toBe('codex')
    expect(board?.lanes[1].autoRunTerminalId).toBe('iterm2')
    expect(board?.lanes[0].autoRunAgentId).toBeUndefined()
    expect(board?.lanes[1].autoRunWorktrees).toBe(false)
    expect(board?.lanes[0].autoRunWorktrees).toBe(true)
    expect(board?.lanes[1].fullAuto).toBe(true)
    expect(board?.lanes[0].fullAuto).toBe(false)
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
    expect(board?.tickets[1].worktreePath).toBeUndefined()
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
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN move_to_lane_id')
    olderDatabase.exec('ALTER TABLE tickets DROP COLUMN move_on_complete')
    olderDatabase.close()

    const repository = new StateRepository(userDataPath)
    const state = repository.getState()
    const migratedTicket = state.boards![projectPath].tickets[0]
    migratedTicket.worktreePath = '/code/app-a'
    migratedTicket.pullRequestUrl = 'https://github.com/o/r/pull/8'
    expect(migratedTicket.moveOnComplete).toBe(false)
    migratedTicket.moveToLaneId = 'prd'
    migratedTicket.moveOnComplete = true
    repository.saveState(state)

    const reopenedTicket = reopenedBoard(userDataPath, projectPath).tickets[0]
    expect(reopenedTicket.worktreePath).toBe('/code/app-a')
    expect(reopenedTicket.pullRequestUrl).toBe('https://github.com/o/r/pull/8')
    expect(reopenedTicket).toMatchObject({ moveToLaneId: 'prd', moveOnComplete: true })
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
    repository.moveTicket('ticket-c', 'prd')
    const afterEdit = reopenedBoard(userDataPath, projectPath).tickets.find((ticket) => ticket.id === 'ticket-c')
    expect(afterEdit).toMatchObject({ number: 3, title: 'C, retitled', labels: ['ui'], laneId: 'prd' })

    repository.deleteTicket('ticket-c')
    const remainingIds = reopenedBoard(userDataPath, projectPath).tickets.map((ticket) => ticket.id)
    expect(remainingIds).toEqual(['ticket-a', 'ticket-b'])
  })

  it('upserts and deletes a swim lane', () => {
    const userDataPath = freshUserDataPath()
    const { repository, projectPath } = seededRepository(userDataPath)

    repository.upsertSwimLane(projectPath, { id: 'idea', name: 'Ideas', agentPrompt: '', agentFilePath: '' }, 0)
    repository.deleteSwimLane(projectPath, 'prd')

    const lanes = reopenedBoard(userDataPath, projectPath).lanes
    expect(lanes.map((lane) => [lane.id, lane.name])).toEqual([['idea', 'Ideas']])
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
