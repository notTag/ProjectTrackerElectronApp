import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { normalizeSemanticVersion } from '../src/shared/projectTypes'
import { applyVersion, normalizeVersion, parseArgs } from './set-ticket-version.mjs'

describe('parseArgs', () => {
  it('accepts #, comma, and space separated tickets and dedupes them', () => {
    expect(parseArgs(['0.5.0', '12', '#14', '15,16', '#12'])).toEqual({
      version: '0.5.0',
      ticketNumbers: [12, 14, 15, 16],
      projectPath: undefined,
      dbPath: undefined
    })
  })

  it('normalizes the version and reads --project and --db', () => {
    const parsed = parseArgs(['v1.2.3', '7', '--project', '/repo', '--db', '/tmp/x.sqlite'])
    expect(parsed).toMatchObject({ version: '1.2.3', ticketNumbers: [7], projectPath: '/repo', dbPath: '/tmp/x.sqlite' })
  })

  it('rejects a missing version, missing tickets, a bad version, and a bad ticket', () => {
    expect(() => parseArgs([])).toThrow('Missing version')
    expect(() => parseArgs(['0.5.0'])).toThrow('Missing ticket numbers')
    expect(() => parseArgs(['1.2', '12'])).toThrow('Not a semantic version')
    expect(() => parseArgs(['0.5.0', 'abc'])).toThrow('Not a ticket number')
  })
})

describe('normalizeVersion', () => {
  it.each(['1.2.3', 'v1.2.3', 'V0.5.0', ' 1.2.3-rc.1+b5 ', '1.2', '1.2.3.4', '01.2.3', '', '   ', 'v'])(
    'matches normalizeSemanticVersion for %j',
    (input) => {
      expect(normalizeVersion(input)).toBe(normalizeSemanticVersion(input))
    }
  )
})

const createDatabase = () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE tickets (
    id TEXT PRIMARY KEY, project_path TEXT, number INTEGER, title TEXT, version TEXT, updated_at TEXT,
    UNIQUE (project_path, number))`)
  const insert = db.prepare('INSERT INTO tickets VALUES (?, ?, ?, ?, ?, ?)')
  insert.run('a12', '/repo-a', 12, 'Twelve', null, 'old')
  insert.run('a14', '/repo-a', 14, 'Fourteen', '0.4.0', 'old')
  insert.run('b12', '/repo-b', 12, 'Other twelve', null, 'old')
  return db
}

const ticketRow = (db, id) => db.prepare('SELECT version, updated_at FROM tickets WHERE id = ?').get(id)

describe('applyVersion', () => {
  it('sets and overwrites versions, bumps updated_at, and reports from → to', () => {
    const db = createDatabase()
    const changes = applyVersion({ db, projectPath: '/repo-a', version: '0.5.0', ticketNumbers: [12, 14] })

    expect(changes).toEqual([
      { number: 12, title: 'Twelve', from: null, to: '0.5.0' },
      { number: 14, title: 'Fourteen', from: '0.4.0', to: '0.5.0' }
    ])
    expect(ticketRow(db, 'a12').version).toBe('0.5.0')
    expect(ticketRow(db, 'a14').version).toBe('0.5.0')
    expect(ticketRow(db, 'a12').updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  })

  it('leaves the same number in another project untouched', () => {
    const db = createDatabase()
    applyVersion({ db, projectPath: '/repo-a', version: '0.5.0', ticketNumbers: [12] })
    expect(ticketRow(db, 'b12')).toEqual({ version: null, updated_at: 'old' })
  })

  it('writes nothing when any ticket is missing', () => {
    const db = createDatabase()
    expect(() => applyVersion({ db, projectPath: '/repo-a', version: '0.5.0', ticketNumbers: [12, 99] })).toThrow(
      'No tickets #99'
    )
    expect(ticketRow(db, 'a12')).toEqual({ version: null, updated_at: 'old' })
    expect(db.isTransaction).toBe(false)
  })
})
