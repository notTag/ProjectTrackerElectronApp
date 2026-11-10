import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import {
  createSeedState,
  DEFAULT_USER_ID,
  DEFAULT_USER_NAME,
  UNASSIGNED_LANE_ID,
  type BoardPreferences,
  type ProjectBoard,
  type ProjectRecord,
  type ProjectTrackerState,
  type ScanFailure,
  type SwimLane,
  type Ticket,
  type User
} from '../../src/shared/projectTypes.js'
import {
  ADDED_COLUMNS,
  PATH_KIND_HIDDEN,
  PATH_KIND_SCAN,
  PATH_KIND_THIRD_PARTY,
  SCHEMA_SQL,
  SCHEMA_VERSION,
  SETTING_BOARD_PREFERENCES,
  SETTING_SCAN_FAILURES,
  SETTING_SCANNED_AT,
  SETTING_UPDATED_AT,
  SETTING_VERSION
} from './schema.js'

export const DATABASE_FILE_NAME = 'project-tracker.sqlite'
// Copied once, the first time a database written by the old sql.js engine is
// switched to WAL mode. Cheap insurance for the one-way upgrade.
export const LEGACY_BACKUP_FILE_NAME = 'project-tracker.pre-wal-backup.sqlite'

type Row = Record<string, unknown>
type PositionedLane = { lane: SwimLane; position: number }

// SQLite stores whatever type it is given, so an outside writer can leave a
// BLOB in a TEXT column (sqlite3's readfile() does). node:sqlite returns it as
// a Uint8Array, and String() on that gives "35,35,32,…" instead of the text.
// The schema has no real BLOB columns, so every one is decoded on the way out.
// ponytail: bytes that aren't valid UTF-8 decode to U+FFFD, and the next edit to
// that row saves the lossy text. Use a fatal decoder if non-UTF-8 writers appear.
const utf8Decoder = new TextDecoder()
const decodeBlobs = (row: Row): Row => {
  const entries = Object.entries(row).map(([column, value]) => [
    column,
    value instanceof Uint8Array ? utf8Decoder.decode(value) : value
  ])
  return Object.fromEntries(entries)
}

const asText = (value: unknown) => (value === null || value === undefined ? undefined : String(value))
const asBool = (value: unknown) => Number(value) === 1
const parseJson = <T>(value: unknown, fallback: T): T => {
  const text = asText(value)
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}
const jsonOrNull = (value: unknown) => (value ? JSON.stringify(value) : null)

// Key order differs between objects read from the database and objects the
// renderer rebuilt with a spread, so rows are compared with sorted keys.
const canonicalJson = (value: unknown) =>
  JSON.stringify(value, (_key, nested: unknown) => {
    const isPlainObject = nested !== null && typeof nested === 'object' && !Array.isArray(nested)
    if (!isPlainObject) return nested
    const sortedEntries = Object.entries(nested).sort(([left], [right]) => left.localeCompare(right))
    return Object.fromEntries(sortedEntries)
  })
const sameRow = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right)

// Includes fields present on only one side, so a cleared field (now undefined)
// counts as a change and gets written as NULL.
const changedFields = <T extends object>(next: T, previous: T): Partial<T> => {
  const nextRecord = next as Record<string, unknown>
  const previousRecord = previous as Record<string, unknown>
  const allKeys = new Set([...Object.keys(nextRecord), ...Object.keys(previousRecord)])
  const changedKeys = [...allKeys].filter((key) => !sameRow(nextRecord[key], previousRecord[key]))
  const changedEntries = changedKeys.map((key) => [key, nextRecord[key]])
  return Object.fromEntries(changedEntries) as Partial<T>
}
const keyBy = <T>(items: T[], keyOf: (item: T) => string) => new Map(items.map((item) => [keyOf(item), item]))

const positionedLanes = (board: ProjectBoard): PositionedLane[] => {
  const normalizeLane = (lane: SwimLane): SwimLane => ({ ...lane, outputTarget: lane.outputTarget ?? '' })
  // Position -1 keeps the unassigned column ahead of the ordered lanes.
  const unassigned = board.unassignedLane
    ? [{ lane: normalizeLane({ ...board.unassignedLane, id: UNASSIGNED_LANE_ID }), position: -1 }]
    : []
  const ordered = board.lanes.map((lane, position) => ({ lane: normalizeLane(lane), position }))
  return [...unassigned, ...ordered]
}

const settingsOf = (state: ProjectTrackerState): Record<string, string | undefined> => ({
  [SETTING_VERSION]: String(state.version),
  [SETTING_UPDATED_AT]: state.updatedAt,
  [SETTING_SCAN_FAILURES]: JSON.stringify(state.snapshot.failures ?? []),
  [SETTING_BOARD_PREFERENCES]: JSON.stringify(state.boardPreferences ?? {}),
  [SETTING_SCANNED_AT]: state.snapshot.scannedAt
})

const listChanges = (next: string[], previous: string[]) => ({
  added: next.filter((entry) => !previous.includes(entry)),
  removed: previous.filter((entry) => !next.includes(entry))
})

const ticketFromRow = (row: Row): Ticket => ({
  id: String(row.id),
  number: Number(row.number),
  laneId: String(row.lane_id),
  title: String(row.title),
  description: String(row.description),
  createdAt: String(row.created_at),
  updatedAt: asText(row.updated_at),
  branchName: asText(row.branch_name),
  worktreePath: asText(row.worktree_path),
  pullRequestUrl: asText(row.pull_request_url),
  pullRequestState: asText(row.pull_request_state) as Ticket['pullRequestState'],
  pullRequestMergedAt: asText(row.pull_request_merged_at),
  assigneeId: asText(row.assignee_id),
  labels: parseJson<string[] | undefined>(row.labels_json, undefined),
  checklist: parseJson<Ticket['checklist']>(row.checklist_json, undefined),
  agentRun: parseJson<Ticket['agentRun']>(row.agent_run_json, undefined),
  externalId: asText(row.external_id),
  externalUrl: asText(row.external_url),
  fullAuto: asBool(row.full_auto)
})

// Column order shared by the ticket INSERT and UPDATE statements below.
const ticketValues = (projectPath: string, ticket: Ticket): SQLInputValue[] => [
  projectPath,
  ticket.laneId,
  ticket.assigneeId ?? null,
  ticket.number,
  ticket.title,
  ticket.description,
  ticket.createdAt,
  ticket.updatedAt ?? null,
  ticket.branchName ?? null,
  jsonOrNull(ticket.labels),
  jsonOrNull(ticket.checklist),
  jsonOrNull(ticket.agentRun),
  ticket.externalId ?? null,
  ticket.externalUrl ?? null,
  ticket.worktreePath ?? null,
  ticket.pullRequestUrl ?? null,
  ticket.pullRequestState ?? null,
  ticket.pullRequestMergedAt ?? null,
  ticket.fullAuto ? 1 : 0
]

export class StateRepository {
  private readonly db: DatabaseSync
  private readonly userId: string
  // The state this instance last handed out. saveState writes only the rows
  // that differ from it, so rows another process changed in the meantime — a
  // second app window, the sqlite3 CLI — are left alone instead of clobbered.
  private baseline: ProjectTrackerState | undefined
  // PRAGMA data_version as of the last read. It only moves when another
  // connection commits, so a mismatch means someone else wrote to the file.
  private dataVersionAtLastRead: number | undefined

  constructor(userDataPath: string, userId: string = DEFAULT_USER_ID) {
    mkdirSync(userDataPath, { recursive: true })
    const databasePath = path.join(userDataPath, DATABASE_FILE_NAME)
    const databaseExisted = existsSync(databasePath)
    this.db = new DatabaseSync(databasePath)
    this.userId = userId

    // busy_timeout first: switching to WAL needs a lock another process may hold.
    this.db.exec('PRAGMA busy_timeout = 5000')
    if (databaseExisted) this.backUpLegacyDatabase(databasePath, path.join(userDataPath, LEGACY_BACKUP_FILE_NAME))
    // WAL lets readers and one writer work at once across processes; WAL mode
    // is stored in the file, foreign_keys is per connection.
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')

    this.transaction(() => {
      this.db.exec(SCHEMA_SQL)
      this.addMissingColumns()
      this.removeRowsOfDeletedProjects()
      this.recordSchemaVersion()
      this.ensureUser()
    })
  }

  // sql.js ran with foreign keys off, so deleting a project never cascaded and
  // left its members, lanes and tickets behind. Remove what the cascade would
  // have. Unknown assignees are a different violation, handled by ensureAssignee.
  private removeRowsOfDeletedProjects() {
    const violations = this.select('PRAGMA foreign_key_check')
    const orphanedByProjectDelete = violations.filter((violation) => violation.parent === 'projects')
    for (const orphan of orphanedByProjectDelete) {
      this.run(`DELETE FROM ${String(orphan.table)} WHERE rowid = ?`, [Number(orphan.rowid)])
    }
  }

  // sql.js never used WAL, so a non-WAL file is one it wrote. It is already a
  // valid SQLite file and opens in place; the copy only guards the upgrade.
  private backUpLegacyDatabase(databasePath: string, backupPath: string) {
    const journalMode = this.select('PRAGMA journal_mode')[0]?.journal_mode
    if (journalMode !== 'wal' && !existsSync(backupPath)) copyFileSync(databasePath, backupPath)
  }

  // IMMEDIATE takes the write lock up front, so a competing writer waits out
  // busy_timeout. A deferred transaction would fail outright with SQLITE_BUSY
  // when its read lock tried to upgrade while another process was writing.
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private select(sql: string, params: SQLInputValue[] = []): Row[] {
    const rows = this.db.prepare(sql).all(...params)
    return rows.map(decodeBlobs)
  }

  private run(sql: string, params: SQLInputValue[] = []) {
    this.db.prepare(sql).run(...params)
  }

  private addMissingColumns() {
    for (const { table, column, definition } of ADDED_COLUMNS) {
      const existingColumns = this.select(`PRAGMA table_info(${table})`)
      const columnExists = existingColumns.some((row) => row.name === column)
      if (!columnExists) this.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }

  private recordSchemaVersion() {
    this.run('DELETE FROM schema_meta')
    this.run('INSERT INTO schema_meta (version) VALUES (?)', [SCHEMA_VERSION])
  }

  private readUsers(): User[] {
    const rows = this.select('SELECT id, name FROM users ORDER BY name')
    return rows.map((row) => ({ id: String(row.id), name: String(row.name) }))
  }

  private ensureUser() {
    this.run('INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)', [
      this.userId,
      DEFAULT_USER_NAME,
      new Date().toISOString()
    ])
  }

  // Membership is what makes a shared project visible. Scanning grants it
  // implicitly; this is the explicit path for adding someone else.
  addProjectMember(projectPath: string, userId: string) {
    this.transaction(() => {
      this.run('INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)', [
        userId,
        userId,
        new Date().toISOString()
      ])
      this.run('INSERT OR IGNORE INTO project_members (project_path, user_id, joined_at) VALUES (?, ?, ?)', [
        projectPath,
        userId,
        new Date().toISOString()
      ])
    })
  }

  private dataVersion(): number {
    return Number(this.select('PRAGMA data_version')[0].data_version)
  }

  // Cheap enough to poll: a header check, no table reads.
  hasExternalChanges(): boolean {
    return this.dataVersion() !== this.dataVersionAtLastRead
  }

  getState(): ProjectTrackerState {
    // Taken before reading, so a commit landing mid-read shows up as a change
    // on the next check instead of being missed.
    this.dataVersionAtLastRead = this.dataVersion()
    const projects = this.readProjects()
    // Seed only into a genuinely empty database. Checking this user's projects
    // instead would re-seed for every new user and collide with shared rows.
    const databaseIsEmpty = this.select('SELECT 1 FROM projects LIMIT 1').length === 0
    if (projects.length === 0 && databaseIsEmpty && this.readSetting(SETTING_VERSION) === undefined) {
      return this.saveState({ ...createSeedState(), userId: this.userId })
    }

    const state: ProjectTrackerState = {
      userId: this.userId,
      users: this.readUsers(),
      version: Number(this.readSetting(SETTING_VERSION) ?? 1),
      updatedAt: this.readSetting(SETTING_UPDATED_AT) ?? new Date().toISOString(),
      scanDirectories: this.readUserPaths(PATH_KIND_SCAN),
      hiddenPaths: this.readProjectPaths(PATH_KIND_HIDDEN),
      thirdPartyPaths: this.readProjectPaths(PATH_KIND_THIRD_PARTY),
      snapshot: {
        projects,
        scannedAt: this.readSetting(SETTING_SCANNED_AT),
        failures: parseJson<ScanFailure[]>(this.readSetting(SETTING_SCAN_FAILURES), [])
      },
      boards: this.readBoards(),
      boardPreferences: parseJson<Record<string, BoardPreferences>>(
        this.readSetting(SETTING_BOARD_PREFERENCES),
        {}
      )
    }
    // Cloned because callers may mutate what they get back before saving it.
    this.baseline = structuredClone(state)
    return state
  }

  // ponytail: the renderer still hands over the whole state (#12 moves it onto
  // the row-level methods below). Until then each save is diffed against the
  // baseline and only changed rows are written. Returns a fresh read, so the
  // renderer also picks up rows other writers changed since its last load.
  saveState(state: ProjectTrackerState): ProjectTrackerState {
    const normalized = { ...state, userId: this.userId, updatedAt: new Date().toISOString() }
    this.transaction(() => this.writeChanges(normalized, this.baseline))
    return this.getState()
  }

  createTicket(projectPath: string, ticket: Omit<Ticket, 'number'>): Ticket {
    // Numbered inside the write transaction, so two writers creating at once
    // get distinct numbers. UNIQUE (project_path, number) is the backstop.
    return this.transaction(() => {
      const created = { ...ticket, number: this.nextTicketNumber(projectPath) }
      this.insertTicketRow(projectPath, created)
      return created
    })
  }

  updateTicket(id: string, patch: Partial<Omit<Ticket, 'id' | 'number' | 'createdAt'>>): Ticket {
    return this.transaction(() => {
      const [row] = this.select('SELECT * FROM tickets WHERE id = ?', [id])
      if (!row) throw new Error(`Ticket ${id} does not exist.`)
      const updated = { ...ticketFromRow(row), ...patch, updatedAt: new Date().toISOString() }
      this.updateTicketRow(String(row.project_path), updated)
      return updated
    })
  }

  moveTicket(id: string, laneId: string): Ticket {
    return this.updateTicket(id, { laneId })
  }

  deleteTicket(id: string) {
    this.run('DELETE FROM tickets WHERE id = ?', [id])
  }

  upsertSwimLane(projectPath: string, lane: SwimLane, position: number) {
    this.run(
      `INSERT INTO swim_lanes (
         id, project_path, name, agent_prompt, agent_file_path, output_target,
         auto_run_agent_id, auto_run_terminal_id, auto_run_worktrees, full_auto, position, is_unassigned
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_path, id) DO UPDATE SET
         name = excluded.name, agent_prompt = excluded.agent_prompt,
         agent_file_path = excluded.agent_file_path, output_target = excluded.output_target,
         auto_run_agent_id = excluded.auto_run_agent_id, auto_run_terminal_id = excluded.auto_run_terminal_id,
         auto_run_worktrees = excluded.auto_run_worktrees, full_auto = excluded.full_auto,
         position = excluded.position, is_unassigned = excluded.is_unassigned`,
      [
        lane.id,
        projectPath,
        lane.name,
        lane.agentPrompt,
        lane.agentFilePath,
        lane.outputTarget ?? '',
        lane.autoRunAgentId ?? null,
        lane.autoRunTerminalId ?? null,
        lane.autoRunWorktrees === false ? 0 : 1,
        lane.fullAuto ? 1 : 0,
        position,
        lane.id === UNASSIGNED_LANE_ID ? 1 : 0
      ]
    )
  }

  deleteSwimLane(projectPath: string, laneId: string) {
    this.run('DELETE FROM swim_lanes WHERE project_path = ? AND id = ?', [projectPath, laneId])
  }

  setSetting(key: string, value: string) {
    this.run(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      [this.userId, key, value]
    )
  }

  upsertProject(project: ProjectRecord) {
    this.transaction(() => this.writeProjectRow(project))
  }

  private readSetting(key: string): string | undefined {
    const rows = this.select('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [this.userId, key])
    return asText(rows[0]?.value)
  }

  private readUserPaths(kind: string): string[] {
    const rows = this.select('SELECT path FROM user_paths WHERE user_id = ? AND kind = ? ORDER BY path', [
      this.userId,
      kind
    ])
    return rows.map((row) => String(row.path))
  }

  private readProjectPaths(kind: string): string[] {
    const rows = this.select('SELECT path FROM project_paths WHERE kind = ? ORDER BY path', [kind])
    return rows.map((row) => String(row.path))
  }

  private readProjects(): ProjectRecord[] {
    const rows = this.select(
      `SELECT projects.* FROM projects
       JOIN project_members ON project_members.project_path = projects.path
       WHERE project_members.user_id = ?
       ORDER BY projects.name`,
      [this.userId]
    )
    return rows.map((row) => ({
      path: String(row.path),
      name: String(row.name),
      status: String(row.status) as ProjectRecord['status'],
      priority: String(row.priority) as ProjectRecord['priority'],
      notes: String(row.notes),
      source: String(row.source) as ProjectRecord['source'],
      packageManager: asText(row.package_manager),
      githubUrl: asText(row.github_url),
      github: parseJson<ProjectRecord['github']>(row.github_json, undefined),
      hasGit: asBool(row.has_git),
      hasPackageJson: asBool(row.has_package_json),
      hasReadme: asBool(row.has_readme),
      lastModifiedAt: asText(row.last_modified_at),
      lastScannedAt: String(row.last_scanned_at),
      archived: asBool(row.archived)
    }))
  }

  private readBoards(): Record<string, ProjectBoard> {
    const visibleProjects = `SELECT project_path FROM project_members WHERE user_id = ?`
    const laneRows = this.select(
      `SELECT * FROM swim_lanes WHERE project_path IN (${visibleProjects}) ORDER BY project_path, position`,
      [this.userId]
    )
    const ticketRows = this.select(
      `SELECT * FROM tickets WHERE project_path IN (${visibleProjects}) ORDER BY number`,
      [this.userId]
    )

    const boards: Record<string, ProjectBoard> = {}
    const boardFor = (projectPath: string): ProjectBoard =>
      (boards[projectPath] ??= { lanes: [], tickets: [] })

    for (const row of laneRows) {
      const board = boardFor(String(row.project_path))
      const lane: SwimLane = {
        id: String(row.id),
        name: String(row.name),
        agentPrompt: String(row.agent_prompt),
        agentFilePath: String(row.agent_file_path),
        outputTarget: String(row.output_target),
        autoRunAgentId: asText(row.auto_run_agent_id),
        autoRunTerminalId: asText(row.auto_run_terminal_id),
        autoRunWorktrees: asBool(row.auto_run_worktrees),
        fullAuto: asBool(row.full_auto)
      }
      if (asBool(row.is_unassigned)) board.unassignedLane = lane
      else board.lanes.push(lane)
    }

    for (const row of ticketRows) boardFor(String(row.project_path)).tickets.push(ticketFromRow(row))

    return boards
  }

  // Only projects this user is a member of are ever in the baseline, so another
  // member's projects can never be deleted or rewritten by this save.
  private writeChanges(state: ProjectTrackerState, baseline: ProjectTrackerState | undefined) {
    this.ensureUser()

    const baselineProjects = keyBy(baseline?.snapshot.projects ?? [], (project) => project.path)
    const keptProjectPaths = new Set(state.snapshot.projects.map((project) => project.path))
    for (const project of state.snapshot.projects) {
      if (!sameRow(project, baselineProjects.get(project.path))) this.writeProjectRow(project)

      // A board left out of the state is untouched, not cleared. Boards hang
      // off projects by foreign key, so boards of unknown projects are skipped.
      const board = state.boards?.[project.path]
      const baselineBoard = baseline?.boards?.[project.path] ?? { lanes: [], tickets: [] }
      if (board) this.writeBoardChanges(project.path, board, baselineBoard)
    }
    // A project this user could see but did not send back has been removed by them.
    for (const projectPath of baselineProjects.keys()) {
      if (!keptProjectPaths.has(projectPath)) this.run('DELETE FROM projects WHERE path = ?', [projectPath])
    }

    const scanDirectories = listChanges(state.scanDirectories, baseline?.scanDirectories ?? [])
    for (const entry of scanDirectories.added) {
      this.run('INSERT OR IGNORE INTO user_paths (user_id, kind, path) VALUES (?, ?, ?)', [
        this.userId,
        PATH_KIND_SCAN,
        entry
      ])
    }
    for (const entry of scanDirectories.removed) {
      this.run('DELETE FROM user_paths WHERE user_id = ? AND kind = ? AND path = ?', [
        this.userId,
        PATH_KIND_SCAN,
        entry
      ])
    }
    this.writeProjectPathChanges(PATH_KIND_HIDDEN, state.hiddenPaths, baseline?.hiddenPaths ?? [])
    this.writeProjectPathChanges(PATH_KIND_THIRD_PARTY, state.thirdPartyPaths, baseline?.thirdPartyPaths ?? [])

    const baselineSettings = baseline ? settingsOf(baseline) : {}
    for (const [key, value] of Object.entries(settingsOf(state))) {
      if (value !== undefined && value !== baselineSettings[key]) this.setSetting(key, value)
    }
  }

  private writeBoardChanges(projectPath: string, board: ProjectBoard, baselineBoard: ProjectBoard) {
    const lanes = positionedLanes(board)
    const baselineLanes = keyBy(positionedLanes(baselineBoard), (entry) => entry.lane.id)
    const keptLaneIds = new Set(lanes.map((entry) => entry.lane.id))
    for (const entry of lanes) {
      const laneChanged = !sameRow(entry, baselineLanes.get(entry.lane.id))
      if (laneChanged) this.upsertSwimLane(projectPath, entry.lane, entry.position)
    }
    for (const laneId of baselineLanes.keys()) {
      if (!keptLaneIds.has(laneId)) this.deleteSwimLane(projectPath, laneId)
    }

    const baselineTickets = keyBy(baselineBoard.tickets, (ticket) => ticket.id)
    const keptTicketIds = new Set(board.tickets.map((ticket) => ticket.id))
    for (const ticket of board.tickets) {
      const baselineTicket = baselineTickets.get(ticket.id)
      if (!sameRow(ticket, baselineTicket)) this.writeTicketRow(projectPath, ticket, baselineTicket)
    }
    for (const ticketId of baselineTickets.keys()) {
      if (!keptTicketIds.has(ticketId)) this.deleteTicket(ticketId)
    }
  }

  // Field-level: only the fields this save changed relative to the baseline are
  // laid over the row as it stands now. Another writer's change to a different
  // field of the same ticket (a CLI lane move, say) survives the save.
  private writeTicketRow(projectPath: string, ticket: Ticket, baselineTicket: Ticket | undefined) {
    const [currentRow] = this.select('SELECT * FROM tickets WHERE id = ?', [ticket.id])
    if (currentRow) {
      const editedFields = baselineTicket ? changedFields(ticket, baselineTicket) : ticket
      const merged = { ...ticketFromRow(currentRow), ...editedFields }
      this.updateTicketRow(projectPath, merged)
      return
    }
    // The renderer numbers a new ticket from its own copy of the board, and
    // another writer may have used that number since. Take the next free one.
    const numberTaken =
      this.select('SELECT 1 FROM tickets WHERE project_path = ? AND number = ?', [projectPath, ticket.number])
        .length > 0
    const number = numberTaken ? this.nextTicketNumber(projectPath) : ticket.number
    this.insertTicketRow(projectPath, { ...ticket, number })
  }

  private nextTicketNumber(projectPath: string): number {
    const [row] = this.select('SELECT COALESCE(MAX(number), 0) + 1 AS next FROM tickets WHERE project_path = ?', [
      projectPath
    ])
    return Number(row.next)
  }

  // sql.js never actually enforced foreign keys, so existing boards can assign
  // tickets to users with no users row. Give them one rather than fail the write.
  private ensureAssignee(ticket: Ticket) {
    if (!ticket.assigneeId) return
    this.run('INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)', [
      ticket.assigneeId,
      ticket.assigneeId,
      new Date().toISOString()
    ])
  }

  private insertTicketRow(projectPath: string, ticket: Ticket) {
    this.ensureAssignee(ticket)
    this.run(
      `INSERT INTO tickets (
         project_path, lane_id, assignee_id, number, title, description, created_at, updated_at,
         branch_name, labels_json, checklist_json, agent_run_json, external_id, external_url,
         worktree_path, pull_request_url, pull_request_state, pull_request_merged_at, full_auto, id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...ticketValues(projectPath, ticket), ticket.id]
    )
  }

  private updateTicketRow(projectPath: string, ticket: Ticket) {
    this.ensureAssignee(ticket)
    this.run(
      `UPDATE tickets SET
         project_path = ?, lane_id = ?, assignee_id = ?, number = ?, title = ?, description = ?,
         created_at = ?, updated_at = ?, branch_name = ?, labels_json = ?, checklist_json = ?,
         agent_run_json = ?, external_id = ?, external_url = ?, worktree_path = ?, pull_request_url = ?,
         pull_request_state = ?, pull_request_merged_at = ?, full_auto = ?
       WHERE id = ?`,
      [...ticketValues(projectPath, ticket), ticket.id]
    )
  }

  // Upserted, never delete-then-insert: the row may already exist because
  // another member created it, and their membership must survive this write.
  private writeProjectRow(project: ProjectRecord) {
    this.run(
      `INSERT INTO projects (
         path, name, status, priority, notes, source, package_manager, github_url,
         github_json, has_git, has_package_json, has_readme, last_modified_at, last_scanned_at,
         archived
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         name = excluded.name, status = excluded.status, priority = excluded.priority,
         notes = excluded.notes, source = excluded.source,
         package_manager = excluded.package_manager, github_url = excluded.github_url,
         github_json = excluded.github_json, has_git = excluded.has_git,
         has_package_json = excluded.has_package_json, has_readme = excluded.has_readme,
         last_modified_at = excluded.last_modified_at, last_scanned_at = excluded.last_scanned_at,
         archived = excluded.archived`,
      [
        project.path,
        project.name,
        project.status,
        project.priority,
        project.notes,
        project.source,
        project.packageManager ?? null,
        project.githubUrl ?? null,
        jsonOrNull(project.github),
        project.hasGit ? 1 : 0,
        project.hasPackageJson ? 1 : 0,
        project.hasReadme ? 1 : 0,
        project.lastModifiedAt ?? null,
        project.lastScannedAt,
        project.archived ? 1 : 0
      ]
    )
    // Scanning a project is what grants the scanner access to it.
    this.run('INSERT OR IGNORE INTO project_members (project_path, user_id, joined_at) VALUES (?, ?, ?)', [
      project.path,
      this.userId,
      new Date().toISOString()
    ])
  }

  private writeProjectPathChanges(kind: string, next: string[], previous: string[]) {
    const { added, removed } = listChanges(next, previous)
    for (const entry of added) this.run('INSERT OR IGNORE INTO project_paths (kind, path) VALUES (?, ?)', [kind, entry])
    for (const entry of removed) this.run('DELETE FROM project_paths WHERE kind = ? AND path = ?', [kind, entry])
  }
}
