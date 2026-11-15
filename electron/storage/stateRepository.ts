import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import {
  createSeedState,
  changedFields,
  createUnassignedLane,
  DEFAULT_USER_ID,
  DEFAULT_USER_NAME,
  orderedIds,
  sameRow,
  SEEDED_CLOSING_LANE_IDS,
  UNASSIGNED_LANE_ID,
  type BoardPreferences,
  type MetricWindowCounts,
  type MetricWindows,
  type ProjectBoard,
  type ProjectRecord,
  type ProjectTrackerState,
  type ScanFailure,
  type SwimLane,
  type Ticket,
  type TicketWritePatch,
  type LaneWritePatch,
  type ProjectWritePatch,
  type User
} from '../../src/shared/projectTypes.js'
import {
  ADDED_COLUMNS,
  CLOSED_AT_TRIGGERS_SQL,
  CLOSING_LANES_SCHEMA_VERSION,
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
export const SNAPSHOTS_DIRECTORY_NAME = 'snapshots'
export const SNAPSHOT_RETENTION_COUNT = 7
const SNAPSHOT_PREFIX = 'project-tracker-'
const SNAPSHOT_SUFFIX = '.sqlite'
const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000

type Row = Record<string, unknown>
type PositionedLane = { lane: SwimLane; position: number }

export interface ClosedTicketMetrics {
  projectPath: string
  name: string
  githubUrl?: string
  hasClosingLanes: boolean
  closed: MetricWindowCounts
}

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
// For NOT NULL DEFAULT '' columns, where '' means the field was never set.
const asNonEmptyText = (value: unknown) => asText(value) || undefined
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

const keyBy = <T>(items: T[], keyOf: (item: T) => string) => new Map(items.map((item) => [keyOf(item), item]))

const positionedLanes = (board: ProjectBoard): PositionedLane[] => {
  const normalizeLane = (lane: SwimLane): SwimLane => ({
    ...lane,
    outputTarget: lane.outputTarget ?? '',
    orchestratorPrompt: lane.orchestratorPrompt ?? ''
  })
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
  fullAuto: asBool(row.full_auto),
  externalLinks: parseJson<Ticket['externalLinks']>(row.external_links_json, undefined),
  moveToLaneId: asText(row.move_to_lane_id),
  moveOnComplete: asBool(row.move_on_complete),
  version: asText(row.version),
  agentId: asText(row.agent_id),
  model: asNonEmptyText(row.model)
})

const laneFromRow = (row: Row): SwimLane => ({
    id: String(row.id),
    name: String(row.name),
    agentPrompt: String(row.agent_prompt),
    agentFilePath: String(row.agent_file_path),
    outputTarget: String(row.output_target),
    orchestratorPrompt: String(row.orchestrator_prompt),
    autoRunAgentId: asText(row.auto_run_agent_id),
    autoRunTerminalId: asText(row.auto_run_terminal_id),
    autoRunWorktrees: asBool(row.auto_run_worktrees),
    fullAuto: asBool(row.full_auto),
    agentSetsVersion: asBool(row.agent_sets_version),
    closesTicket: asBool(row.closes_ticket),
    autoRunModel: asNonEmptyText(row.auto_run_model),
    orchestratorAgentId: asText(row.orchestrator_agent_id),
    orchestratorModel: asNonEmptyText(row.orchestrator_model),
    nextLaneId: asText(row.next_lane_id)
  })

const projectFromRow = (row: Row): ProjectRecord => ({
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
  ticket.fullAuto ? 1 : 0,
  jsonOrNull(ticket.externalLinks),
  ticket.moveToLaneId ?? null,
  ticket.moveOnComplete ? 1 : 0,
  ticket.version ?? null,
  ticket.agentId ?? null,
  ticket.model ?? ''
]

export class StateRepository {
  private readonly db: DatabaseSync
  private readonly userId: string
  private readonly snapshotsPath: string
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
    this.snapshotsPath = path.join(userDataPath, SNAPSHOTS_DIRECTORY_NAME)
    // Before migrations, so a migration bug can always be rolled back by hand.
    if (databaseExisted) this.snapshotIfStale()
    if (databaseExisted) this.backUpLegacyDatabase(databasePath, path.join(userDataPath, LEGACY_BACKUP_FILE_NAME))
    // WAL lets readers and one writer work at once across processes; WAL mode
    // is stored in the file, foreign_keys is per connection.
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')

    this.transaction(() => {
      this.db.exec(SCHEMA_SQL)
      this.addMissingColumns()
      this.db.exec(CLOSED_AT_TRIGGERS_SQL)
      this.seedClosingLanesOnce()
      this.removeRowsOfDeletedProjects()
      this.recordSchemaVersion()
      this.ensureUser()
    })
  }

  get snapshotsDirectory() {
    return this.snapshotsPath
  }

  // VACUUM INTO reads one consistent snapshot through the WAL, so commits still
  // in the -wal file are included; a plain file copy would miss them.
  backUpNow(): string {
    mkdirSync(this.snapshotsPath, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const snapshotPath = path.join(this.snapshotsPath, `${SNAPSHOT_PREFIX}${timestamp}${SNAPSHOT_SUFFIX}`)
    try {
      this.db.prepare('VACUUM INTO ?').run(snapshotPath)
    } catch (error) {
      // A half-written file would count as the newest snapshot and skip tomorrow's.
      rmSync(snapshotPath, { force: true })
      throw error
    }
    this.pruneSnapshots()
    return snapshotPath
  }

  // Timestamped names sort lexically = chronologically, oldest first.
  private listSnapshots(): string[] {
    if (!existsSync(this.snapshotsPath)) return []
    const isSnapshot = (name: string) => name.startsWith(SNAPSHOT_PREFIX) && name.endsWith(SNAPSHOT_SUFFIX)
    return readdirSync(this.snapshotsPath).filter(isSnapshot).sort()
  }

  private snapshotIfStale() {
    try {
      const newestName = this.listSnapshots().at(-1)
      if (newestName) {
        const newestModifiedAt = statSync(path.join(this.snapshotsPath, newestName)).mtimeMs
        const isFresh = Date.now() - newestModifiedAt < SNAPSHOT_INTERVAL_MS
        if (isFresh) return
      }
      this.backUpNow()
    } catch (error) {
      console.warn('[snapshot] launch snapshot failed', error)
    }
  }

  private pruneSnapshots() {
    const snapshotNames = this.listSnapshots()
    const expiredNames = snapshotNames.slice(0, -SNAPSHOT_RETENTION_COUNT)
    for (const name of expiredNames) rmSync(path.join(this.snapshotsPath, name))
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

  // Runs before recordSchemaVersion bumps the stored version. Flagging a lane
  // fires swim_lanes_closed_at_on_flag, which backfills closed_at for the
  // tickets already in it — approximate, since updated_at moves on every edit.
  private seedClosingLanesOnce() {
    const storedVersion = Number(this.select('SELECT version FROM schema_meta')[0]?.version ?? 0)
    if (storedVersion >= CLOSING_LANES_SCHEMA_VERSION) return
    const placeholders = SEEDED_CLOSING_LANE_IDS.map(() => '?').join(', ')
    this.run(`UPDATE swim_lanes SET closes_ticket = 1 WHERE id IN (${placeholders})`, SEEDED_CLOSING_LANE_IDS)
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

  // ponytail: whole state is only sent for the seed, scan merges
  // (mergeScannedProjects, GitHub data refresh), scan-directory / hidden /
  // third-party path edits (incl. setStatus) and board preferences. Ordinary
  // ticket / lane / project edits use the per-entity methods below. Each save is
  // diffed against the baseline and only changed rows are written. Returns a
  // fresh read, so the renderer also picks up rows other writers changed.
  saveState(state: ProjectTrackerState): ProjectTrackerState {
    const normalized = { ...state, userId: this.userId, updatedAt: new Date().toISOString() }
    this.transaction(() => this.writeChanges(normalized, this.baseline))
    return this.getState()
  }

  // Per-entity writes below commit one entity each and splice what they wrote
  // into the baseline, so a later saveState built from an older read sees no
  // difference for that entity and cannot revert it.

  createTicket(projectPath: string, ticket: Omit<Ticket, 'number'>): Ticket {
    // Numbered inside the write transaction, so two writers creating at once
    // get distinct numbers. UNIQUE (project_path, number) is the backstop.
    const created = this.transaction(() => {
      const numbered = { ...ticket, number: this.nextTicketNumber(projectPath) }
      this.insertTicketRow(projectPath, numbered)
      return this.readTicket(ticket.id)
    })
    this.spliceBaselineTicket(projectPath, created)
    return created
  }

  // Stamps updatedAt unless the patch carries it (even as null): the renderer
  // always sends its own value, so marking a run seen stays unstamped, while
  // agents and the CLI get a stamp for free. A null value clears the field.
  updateTicket(id: string, patch: TicketWritePatch): Ticket {
    const updated = this.transaction(() => {
      const { ticket: current, projectPath } = this.readTicketWithProject(id)
      const stamp = 'updatedAt' in patch ? {} : { updatedAt: new Date().toISOString() }
      const merged = { ...current, ...patch, ...stamp } as Ticket
      this.updateTicketRow(projectPath, merged)
      return { ticket: this.readTicket(id), projectPath }
    })
    this.spliceBaselineTicket(updated.projectPath, updated.ticket)
    return updated.ticket
  }

  deleteTicket(id: string) {
    const projectPath = this.transaction(() => {
      const [row] = this.select('SELECT project_path FROM tickets WHERE id = ?', [id])
      this.deleteTicketRow(id)
      return row ? String(row.project_path) : undefined
    })
    if (!projectPath) return
    this.patchBaselineBoard(projectPath, (board) => ({
      ...board,
      tickets: board.tickets.filter((ticket) => ticket.id !== id)
    }))
  }

  // Appended after every lane already on the board, whatever the caller's copy
  // says. An existing id throws rather than upserting, so a stale renderer copy
  // can't wipe another writer's lane config; the store's failure path re-reads.
  createSwimLane(projectPath: string, lane: SwimLane): SwimLane {
    const created = this.transaction(() => {
      const existing = this.select('SELECT 1 FROM swim_lanes WHERE project_path = ? AND id = ?', [projectPath, lane.id])
      if (existing.length > 0) throw new Error(`Lane ${lane.id} already exists.`)
      const [row] = this.select(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM swim_lanes WHERE project_path = ? AND is_unassigned = 0',
        [projectPath]
      )
      this.upsertLaneRow(projectPath, lane, Number(row.next))
      return this.readLane(projectPath, lane.id)
    })
    this.spliceBaselineLane(projectPath, created)
    return created
  }

  // The unassigned column has no row until it is first configured, so it
  // starts from the default instead of failing.
  updateSwimLane(projectPath: string, laneId: string, patch: LaneWritePatch): SwimLane {
    const updated = this.transaction(() => {
      const [row] = this.select('SELECT * FROM swim_lanes WHERE project_path = ? AND id = ?', [projectPath, laneId])
      if (!row && laneId !== UNASSIGNED_LANE_ID) throw new Error(`Lane ${laneId} does not exist.`)
      const current = row ? laneFromRow(row) : createUnassignedLane()
      const position = row ? Number(row.position) : -1
      const merged = { ...current, ...patch, id: laneId } as SwimLane
      this.upsertLaneRow(projectPath, merged, position)
      return this.readLane(projectPath, laneId)
    })
    this.spliceBaselineLane(projectPath, updated)
    return updated
  }

  // Lanes on the board but not listed (another writer added them) keep their
  // relative order after the listed ones, so nothing ever drops off the board.
  reorderSwimLanes(projectPath: string, laneIds: string[]) {
    this.transaction(() => {
      const storedRows = this.select(
        'SELECT id FROM swim_lanes WHERE project_path = ? AND is_unassigned = 0 ORDER BY position',
        [projectPath]
      )
      const storedIds = storedRows.map((row) => String(row.id))
      const order = orderedIds(storedIds, laneIds)
      order.forEach((laneId, position) => {
        this.run('UPDATE swim_lanes SET position = ? WHERE project_path = ? AND id = ?', [position, projectPath, laneId])
      })
    })
    this.patchBaselineBoard(projectPath, (board) => {
      const laneById = keyBy(board.lanes, (lane) => lane.id)
      const order = orderedIds([...laneById.keys()], laneIds)
      return { ...board, lanes: order.map((laneId) => laneById.get(laneId)!) }
    })
  }

  deleteSwimLane(projectPath: string, laneId: string) {
    this.transaction(() => this.deleteLaneRow(projectPath, laneId))
    this.patchBaselineBoard(projectPath, (board) => ({
      ...board,
      lanes: board.lanes.filter((lane) => lane.id !== laneId)
    }))
  }

  // Only the hand-edited fields: everything else on the row belongs to the scanner.
  updateProject(projectPath: string, patch: ProjectWritePatch): ProjectRecord {
    const updated = this.transaction(() => {
      const current = this.readProject(projectPath)
      const editable = { notes: patch.notes, priority: patch.priority, status: patch.status }
      const definedEntries = Object.entries(editable).filter(([, value]) => value !== undefined)
      this.writeProjectRow({ ...current, ...Object.fromEntries(definedEntries) })
      return this.readProject(projectPath)
    })
    if (this.baseline) {
      const projects = this.baseline.snapshot.projects.map((project) =>
        project.path === projectPath ? structuredClone(updated) : project
      )
      this.baseline = { ...this.baseline, snapshot: { ...this.baseline.snapshot, projects } }
    }
    return updated
  }

  setSetting(key: string, value: string) {
    this.run(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      [this.userId, key, value]
    )
  }

  // Only projects this user can see and hasn't archived come back, so the
  // renderer can't widen what is counted by naming other paths.
  closedTicketMetrics(projectPaths: string[], windows: MetricWindows): ClosedTicketMetrics[] {
    if (projectPaths.length === 0) return []
    const placeholders = projectPaths.map(() => '?').join(', ')
    const rows = this.select(
      `SELECT projects.path, projects.name, projects.github_url,
         EXISTS (SELECT 1 FROM swim_lanes
                 WHERE swim_lanes.project_path = projects.path AND swim_lanes.closes_ticket = 1) AS has_closing_lanes,
         COALESCE(SUM(CASE WHEN tickets.closed_at >= ? THEN 1 ELSE 0 END), 0) AS today,
         COALESCE(SUM(CASE WHEN tickets.closed_at >= ? THEN 1 ELSE 0 END), 0) AS week,
         COALESCE(SUM(CASE WHEN tickets.closed_at >= ? THEN 1 ELSE 0 END), 0) AS month,
         COALESCE(SUM(CASE WHEN tickets.closed_at >= ? THEN 1 ELSE 0 END), 0) AS year
       FROM projects
       JOIN project_members ON project_members.project_path = projects.path AND project_members.user_id = ?
       LEFT JOIN tickets ON tickets.project_path = projects.path AND tickets.closed_at IS NOT NULL
       WHERE projects.archived = 0 AND projects.path IN (${placeholders})
       GROUP BY projects.path
       ORDER BY projects.name`,
      [windows.today, windows.week, windows.month, windows.year, this.userId, ...projectPaths]
    )
    return rows.map((row) => ({
      projectPath: String(row.path),
      name: String(row.name),
      githubUrl: asText(row.github_url),
      hasClosingLanes: asBool(row.has_closing_lanes),
      closed: { today: Number(row.today), week: Number(row.week), month: Number(row.month), year: Number(row.year) }
    }))
  }

  upsertProject(project: ProjectRecord) {
    this.transaction(() => this.writeProjectRow(project))
  }

  private upsertLaneRow(projectPath: string, lane: SwimLane, position: number) {
    this.run(
      `INSERT INTO swim_lanes (
         id, project_path, name, agent_prompt, agent_file_path, output_target, orchestrator_prompt,
         auto_run_agent_id, auto_run_terminal_id, auto_run_worktrees, full_auto, agent_sets_version, closes_ticket, position, is_unassigned,
         auto_run_model, orchestrator_agent_id, orchestrator_model, next_lane_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_path, id) DO UPDATE SET
         name = excluded.name, agent_prompt = excluded.agent_prompt,
         agent_file_path = excluded.agent_file_path, output_target = excluded.output_target,
         orchestrator_prompt = excluded.orchestrator_prompt,
         auto_run_agent_id = excluded.auto_run_agent_id, auto_run_terminal_id = excluded.auto_run_terminal_id,
         auto_run_worktrees = excluded.auto_run_worktrees, full_auto = excluded.full_auto,
         agent_sets_version = excluded.agent_sets_version, closes_ticket = excluded.closes_ticket, position = excluded.position, is_unassigned = excluded.is_unassigned,
         auto_run_model = excluded.auto_run_model, orchestrator_agent_id = excluded.orchestrator_agent_id,
         orchestrator_model = excluded.orchestrator_model, next_lane_id = excluded.next_lane_id`,
      [
        lane.id,
        projectPath,
        lane.name,
        lane.agentPrompt,
        lane.agentFilePath,
        lane.outputTarget ?? '',
        lane.orchestratorPrompt ?? '',
        lane.autoRunAgentId ?? null,
        lane.autoRunTerminalId ?? null,
        lane.autoRunWorktrees === false ? 0 : 1,
        lane.fullAuto ? 1 : 0,
        lane.agentSetsVersion ? 1 : 0,
        lane.closesTicket ? 1 : 0,
        position,
        lane.id === UNASSIGNED_LANE_ID ? 1 : 0,
        lane.autoRunModel ?? '',
        lane.orchestratorAgentId ?? null,
        lane.orchestratorModel ?? '',
        lane.nextLaneId ?? null
      ]
    )
  }

  private deleteLaneRow(projectPath: string, laneId: string) {
    this.run('DELETE FROM swim_lanes WHERE project_path = ? AND id = ?', [projectPath, laneId])
  }

  private deleteTicketRow(id: string) {
    this.run('DELETE FROM tickets WHERE id = ?', [id])
  }

  private readTicketWithProject(id: string): { ticket: Ticket; projectPath: string } {
    const [row] = this.select('SELECT * FROM tickets WHERE id = ?', [id])
    if (!row) throw new Error(`Ticket ${id} does not exist.`)
    return { ticket: ticketFromRow(row), projectPath: String(row.project_path) }
  }

  private readTicket(id: string): Ticket {
    return this.readTicketWithProject(id).ticket
  }

  private readLane(projectPath: string, laneId: string): SwimLane {
    const [row] = this.select('SELECT * FROM swim_lanes WHERE project_path = ? AND id = ?', [projectPath, laneId])
    return laneFromRow(row)
  }

  private readProject(projectPath: string): ProjectRecord {
    const [row] = this.select('SELECT * FROM projects WHERE path = ?', [projectPath])
    if (!row) throw new Error(`Project ${projectPath} does not exist.`)
    return projectFromRow(row)
  }

  // No baseline yet means nothing has been handed out, so nothing can be reverted.
  private patchBaselineBoard(projectPath: string, patch: (board: ProjectBoard) => ProjectBoard) {
    if (!this.baseline) return
    const board = this.baseline.boards?.[projectPath] ?? { lanes: [], tickets: [] }
    const boards = { ...this.baseline.boards, [projectPath]: patch(board) }
    this.baseline = { ...this.baseline, boards }
  }

  private spliceBaselineTicket(projectPath: string, ticket: Ticket) {
    const stored = structuredClone(ticket)
    this.patchBaselineBoard(projectPath, (board) => {
      const exists = board.tickets.some((entry) => entry.id === ticket.id)
      const tickets = exists
        ? board.tickets.map((entry) => (entry.id === ticket.id ? stored : entry))
        : [...board.tickets, stored]
      return { ...board, tickets }
    })
  }

  private spliceBaselineLane(projectPath: string, lane: SwimLane) {
    const stored = structuredClone(lane)
    this.patchBaselineBoard(projectPath, (board) => {
      if (lane.id === UNASSIGNED_LANE_ID) return { ...board, unassignedLane: stored }
      const exists = board.lanes.some((entry) => entry.id === lane.id)
      const lanes = exists
        ? board.lanes.map((entry) => (entry.id === lane.id ? stored : entry))
        : [...board.lanes, stored]
      return { ...board, lanes }
    })
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
    return rows.map(projectFromRow)
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
      const lane = laneFromRow(row)
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
      if (laneChanged) this.upsertLaneRow(projectPath, entry.lane, entry.position)
    }
    for (const laneId of baselineLanes.keys()) {
      if (!keptLaneIds.has(laneId)) this.deleteLaneRow(projectPath, laneId)
    }

    const baselineTickets = keyBy(baselineBoard.tickets, (ticket) => ticket.id)
    const keptTicketIds = new Set(board.tickets.map((ticket) => ticket.id))
    for (const ticket of board.tickets) {
      const baselineTicket = baselineTickets.get(ticket.id)
      if (!sameRow(ticket, baselineTicket)) this.writeTicketRow(projectPath, ticket, baselineTicket)
    }
    for (const ticketId of baselineTickets.keys()) {
      if (!keptTicketIds.has(ticketId)) this.deleteTicketRow(ticketId)
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
         worktree_path, pull_request_url, pull_request_state, pull_request_merged_at, full_auto, external_links_json, move_to_lane_id, move_on_complete, version,
         agent_id, model, id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
         pull_request_state = ?, pull_request_merged_at = ?, full_auto = ?, external_links_json = ?, move_to_lane_id = ?, move_on_complete = ?,
         version = ?, agent_id = ?, model = ?
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
