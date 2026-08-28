import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'

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

type Row = Record<string, unknown>

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

export class StateRepository {
  private readonly db: Database
  private readonly databasePath: string
  private readonly userId: string

  private constructor(userDataPath: string, sql: SqlJsStatic, userId: string) {
    mkdirSync(userDataPath, { recursive: true })
    this.databasePath = path.join(userDataPath, 'project-tracker.sqlite')
    this.db = existsSync(this.databasePath) ? new sql.Database(readFileSync(this.databasePath)) : new sql.Database()
    this.userId = userId

    this.db.run('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA_SQL)
    this.recordSchemaVersion()
    this.ensureUser()
    this.persist()
  }

  static async create(userDataPath: string, userId: string = DEFAULT_USER_ID) {
    const sql = await initSqlJs()
    return new StateRepository(userDataPath, sql, userId)
  }

  private select(sql: string, params: unknown[] = []): Row[] {
    const statement = this.db.prepare(sql)
    statement.bind(params as never)
    const rows: Row[] = []
    while (statement.step()) rows.push(statement.getAsObject() as Row)
    statement.free()
    return rows
  }

  private recordSchemaVersion() {
    this.db.run('DELETE FROM schema_meta')
    this.db.run('INSERT INTO schema_meta (version) VALUES (?)', [SCHEMA_VERSION])
  }

  private readUsers(): User[] {
    const rows = this.select('SELECT id, name FROM users ORDER BY name')
    return rows.map((row) => ({ id: String(row.id), name: String(row.name) }))
  }

  private ensureUser() {
    this.db.run('INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)', [
      this.userId,
      DEFAULT_USER_NAME,
      new Date().toISOString()
    ])
  }

  // Membership is what makes a shared project visible. Scanning grants it
  // implicitly; this is the explicit path for adding someone else.
  addProjectMember(projectPath: string, userId: string) {
    this.db.run('INSERT OR IGNORE INTO users (id, name, created_at) VALUES (?, ?, ?)', [
      userId,
      userId,
      new Date().toISOString()
    ])
    this.db.run('INSERT OR IGNORE INTO project_members (project_path, user_id, joined_at) VALUES (?, ?, ?)', [
      projectPath,
      userId,
      new Date().toISOString()
    ])
    this.persist()
  }

  getState(): ProjectTrackerState {
    const projects = this.readProjects()
    // Seed only into a genuinely empty database. Checking this user's projects
    // instead would re-seed for every new user and collide with shared rows.
    const databaseIsEmpty = this.select('SELECT 1 FROM projects LIMIT 1').length === 0
    if (projects.length === 0 && databaseIsEmpty && this.readSetting(SETTING_VERSION) === undefined) {
      return this.saveState({ ...createSeedState(), userId: this.userId })
    }

    return {
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
  }

  saveState(state: ProjectTrackerState): ProjectTrackerState {
    const normalized = { ...state, userId: this.userId, updatedAt: new Date().toISOString() }
    this.db.run('BEGIN TRANSACTION')
    try {
      this.writeState(normalized)
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
    return normalized
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
      lastScannedAt: String(row.last_scanned_at)
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
        agentFilePath: String(row.agent_file_path)
      }
      if (asBool(row.is_unassigned)) board.unassignedLane = lane
      else board.lanes.push(lane)
    }

    for (const row of ticketRows) {
      const board = boardFor(String(row.project_path))
      board.tickets.push({
        id: String(row.id),
        number: Number(row.number),
        laneId: String(row.lane_id),
        title: String(row.title),
        description: String(row.description),
        createdAt: String(row.created_at),
        updatedAt: asText(row.updated_at),
        branchName: asText(row.branch_name),
        assigneeId: asText(row.assignee_id),
        labels: parseJson<string[] | undefined>(row.labels_json, undefined),
        checklist: parseJson<Ticket['checklist']>(row.checklist_json, undefined),
        agentRun: parseJson<Ticket['agentRun']>(row.agent_run_json, undefined),
        externalId: asText(row.external_id),
        externalUrl: asText(row.external_url)
      })
    }

    return boards
  }

  // The renderer still hands over the whole state, so each save replaces the
  // rows this user can see, inside one transaction. Only projects this user is a
  // member of are touched — another member's projects are never in this state
  // object and must survive the save untouched.
  private writeState(state: ProjectTrackerState) {
    this.ensureUser()
    const visibleProjects = `SELECT project_path FROM project_members WHERE user_id = ?`
    this.db.run(`DELETE FROM tickets WHERE project_path IN (${visibleProjects})`, [this.userId])
    this.db.run(`DELETE FROM swim_lanes WHERE project_path IN (${visibleProjects})`, [this.userId])

    this.db.run('DELETE FROM user_paths WHERE user_id = ?', [this.userId])
    this.db.run('DELETE FROM project_paths')

    for (const project of state.snapshot.projects) {
      // Upserted, never delete-then-insert: the row may already exist because
      // another member created it, and their membership must survive this save.
      this.db.run(
        `INSERT INTO projects (
           path, name, status, priority, notes, source, package_manager, github_url,
           github_json, has_git, has_package_json, has_readme, last_modified_at, last_scanned_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           name = excluded.name, status = excluded.status, priority = excluded.priority,
           notes = excluded.notes, source = excluded.source,
           package_manager = excluded.package_manager, github_url = excluded.github_url,
           github_json = excluded.github_json, has_git = excluded.has_git,
           has_package_json = excluded.has_package_json, has_readme = excluded.has_readme,
           last_modified_at = excluded.last_modified_at, last_scanned_at = excluded.last_scanned_at`,
        [
          project.path,
          project.name,
          project.status,
          project.priority,
          project.notes,
          project.source,
          project.packageManager ?? null,
          project.githubUrl ?? null,
          project.github ? JSON.stringify(project.github) : null,
          project.hasGit ? 1 : 0,
          project.hasPackageJson ? 1 : 0,
          project.hasReadme ? 1 : 0,
          project.lastModifiedAt ?? null,
          project.lastScannedAt
        ]
      )
      // Scanning a project is what grants the scanner access to it.
      this.db.run(
        'INSERT OR IGNORE INTO project_members (project_path, user_id, joined_at) VALUES (?, ?, ?)',
        [project.path, this.userId, new Date().toISOString()]
      )
    }

    const knownProjectPaths = new Set(state.snapshot.projects.map((project) => project.path))
    for (const [projectPath, board] of Object.entries(state.boards ?? {})) {
      // Boards hang off projects by foreign key, so a board whose project is no
      // longer in the snapshot is dropped rather than orphaned.
      if (!knownProjectPaths.has(projectPath)) continue
      this.writeBoard(projectPath, board)
    }

    // A project this user could see but did not send back has been removed by
    // them; drop it. Projects they never could see are left alone entirely.
    const survivingPaths = state.snapshot.projects.map((project) => project.path)
    const placeholders = survivingPaths.map(() => '?').join(', ')
    this.db.run(
      `DELETE FROM projects WHERE path IN (${visibleProjects})
       ${survivingPaths.length ? `AND path NOT IN (${placeholders})` : ''}`,
      [this.userId, ...survivingPaths]
    )

    this.writeUserPaths(PATH_KIND_SCAN, state.scanDirectories)
    this.writeProjectPaths(PATH_KIND_HIDDEN, state.hiddenPaths)
    this.writeProjectPaths(PATH_KIND_THIRD_PARTY, state.thirdPartyPaths)

    this.writeSetting(SETTING_VERSION, String(state.version))
    this.writeSetting(SETTING_UPDATED_AT, state.updatedAt)
    this.writeSetting(SETTING_SCAN_FAILURES, JSON.stringify(state.snapshot.failures ?? []))
    this.writeSetting(SETTING_BOARD_PREFERENCES, JSON.stringify(state.boardPreferences ?? {}))
    if (state.snapshot.scannedAt) this.writeSetting(SETTING_SCANNED_AT, state.snapshot.scannedAt)
  }

  private writeBoard(projectPath: string, board: ProjectBoard) {
    const insertLane = (lane: SwimLane, position: number, isUnassigned: boolean) => {
      this.db.run(
        `INSERT INTO swim_lanes (
           id, project_path, name, agent_prompt, agent_file_path, position, is_unassigned
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          lane.id,
          projectPath,
          lane.name,
          lane.agentPrompt,
          lane.agentFilePath,
          position,
          isUnassigned ? 1 : 0
        ]
      )
    }

    // Position -1 keeps the unassigned column ahead of the ordered lanes.
    if (board.unassignedLane) insertLane({ ...board.unassignedLane, id: UNASSIGNED_LANE_ID }, -1, true)
    board.lanes.forEach((lane, position) => insertLane(lane, position, false))

    for (const ticket of board.tickets) {
      this.db.run(
        `INSERT INTO tickets (
           id, project_path, lane_id, assignee_id, number, title, description, created_at, updated_at,
           branch_name, labels_json, checklist_json, agent_run_json, external_id, external_url
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ticket.id,
          projectPath,
          ticket.laneId,
          ticket.assigneeId ?? null,
          ticket.number,
          ticket.title,
          ticket.description,
          ticket.createdAt,
          ticket.updatedAt ?? null,
          ticket.branchName ?? null,
          ticket.labels ? JSON.stringify(ticket.labels) : null,
          ticket.checklist ? JSON.stringify(ticket.checklist) : null,
          ticket.agentRun ? JSON.stringify(ticket.agentRun) : null,
          ticket.externalId ?? null,
          ticket.externalUrl ?? null
        ]
      )
    }
  }

  private writeUserPaths(kind: string, paths: string[]) {
    for (const entry of paths) {
      this.db.run('INSERT OR IGNORE INTO user_paths (user_id, kind, path) VALUES (?, ?, ?)', [
        this.userId,
        kind,
        entry
      ])
    }
  }

  private writeProjectPaths(kind: string, paths: string[]) {
    for (const entry of paths) {
      this.db.run('INSERT OR IGNORE INTO project_paths (kind, path) VALUES (?, ?)', [kind, entry])
    }
  }

  private writeSetting(key: string, value: string) {
    this.db.run(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      [this.userId, key, value]
    )
  }

  private persist() {
    writeFileSync(this.databasePath, Buffer.from(this.db.export()))
  }
}
