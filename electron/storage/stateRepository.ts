import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'

import { createSeedState, ProjectTrackerState } from '../../src/shared/projectTypes.js'

const STATE_KEY = 'project-tracker-state'

export class StateRepository {
  private readonly db: Database
  private readonly databasePath: string

  private constructor(userDataPath: string, sql: SqlJsStatic) {
    mkdirSync(userDataPath, { recursive: true })
    this.databasePath = path.join(userDataPath, 'project-tracker.sqlite')
    this.db = existsSync(this.databasePath) ? new sql.Database(readFileSync(this.databasePath)) : new sql.Database()
    this.db.run(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
    this.persist()
  }

  static async create(userDataPath: string) {
    const sql = await initSqlJs()
    return new StateRepository(userDataPath, sql)
  }

  getState(): ProjectTrackerState {
    const statement = this.db.prepare('SELECT value FROM app_state WHERE key = ?')
    statement.bind([STATE_KEY])

    if (!statement.step()) {
      statement.free()
      const seed = createSeedState()
      this.saveState(seed)
      return seed
    }

    const row = statement.getAsObject() as { value: string }
    statement.free()
    return JSON.parse(row.value) as ProjectTrackerState
  }

  saveState(state: ProjectTrackerState): ProjectTrackerState {
    const normalized = { ...state, updatedAt: new Date().toISOString() }
    this.db.run('BEGIN TRANSACTION')
    try {
      this.db.run(
        `INSERT INTO app_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        [STATE_KEY, JSON.stringify(normalized), normalized.updatedAt]
      )
      this.db.run('COMMIT')
      this.persist()
    } catch (error) {
      this.db.run('ROLLBACK')
      throw error
    }
    return normalized
  }

  private persist() {
    writeFileSync(this.databasePath, Buffer.from(this.db.export()))
  }
}
