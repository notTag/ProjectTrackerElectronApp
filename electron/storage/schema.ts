// Projects, lanes and tickets are shared: one row per real-world thing, so an
// edit by any member is immediately what every other member sees. Users attach
// to that shared data two ways — membership (who can see a project) and
// assignment (who is working a ticket) — never by owning a private copy.
export const SCHEMA_VERSION = 5
// First version with closing lanes; opening an older file seeds and backfills them once.
export const CLOSING_LANES_SCHEMA_VERSION = 5

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- archived = 1 once the user deleted its scan directory: the row and its board
-- are kept but never shown, so re-adding the directory restores them.
-- ponytail: on the shared row, so archiving hides it for every member. Move it
-- to project_members if a second user ever needs their own archive.
CREATE TABLE IF NOT EXISTS projects (
  path TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  notes TEXT NOT NULL,
  source TEXT NOT NULL,
  package_manager TEXT,
  github_url TEXT,
  github_json TEXT,
  has_git INTEGER NOT NULL,
  has_package_json INTEGER NOT NULL,
  has_readme INTEGER NOT NULL,
  last_modified_at TEXT,
  last_scanned_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

-- Who can see a project. A project with no members is visible to nobody, so
-- scanning adds the scanning user as a member.
CREATE TABLE IF NOT EXISTS project_members (
  project_path TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (project_path, user_id)
);

CREATE TABLE IF NOT EXISTS swim_lanes (
  id TEXT NOT NULL,
  project_path TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
  name TEXT NOT NULL,
  agent_prompt TEXT NOT NULL,
  agent_file_path TEXT NOT NULL,
  output_target TEXT NOT NULL DEFAULT '',
  auto_run_agent_id TEXT,
  auto_run_terminal_id TEXT,
  auto_run_worktrees INTEGER NOT NULL DEFAULT 1,
  full_auto INTEGER NOT NULL DEFAULT 0,
  -- A ticket entering a lane with this set counts as closed for metrics.
  closes_ticket INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  -- The unassigned column owns an agent prompt but must never be deletable, so
  -- it is flagged here rather than living in the ordered lane list.
  is_unassigned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_path, id)
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
  -- Deliberately not a foreign key: a ticket may sit in the virtual unassigned
  -- column, which has no swim_lanes row until someone configures its prompt.
  lane_id TEXT NOT NULL,
  -- NULL means nobody has picked it up. ON DELETE SET NULL so removing a user
  -- releases their tickets back to the board instead of deleting the work.
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  branch_name TEXT,
  worktree_path TEXT,
  pull_request_url TEXT,
  labels_json TEXT,
  checklist_json TEXT,
  agent_run_json TEXT,
  external_id TEXT,
  external_url TEXT,
  full_auto INTEGER NOT NULL DEFAULT 0,
  -- Owned by the triggers in CLOSED_AT_TRIGGERS_SQL, never written by the app.
  closed_at TEXT,
  UNIQUE (project_path, number)
);

-- Classification of a project, shared like the project itself.
CREATE TABLE IF NOT EXISTS project_paths (
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (kind, path)
);

-- Where a person scans on their own disk: genuinely per-user, never shared.
CREATE TABLE IF NOT EXISTS user_paths (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, path)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS tickets_by_board ON tickets (project_path, lane_id);
CREATE INDEX IF NOT EXISTS tickets_by_assignee ON tickets (assignee_id);
CREATE INDEX IF NOT EXISTS tickets_by_external_id ON tickets (external_id);
CREATE INDEX IF NOT EXISTS lanes_by_board ON swim_lanes (project_path, position);
CREATE INDEX IF NOT EXISTS members_by_user ON project_members (user_id);
`

// CREATE TABLE IF NOT EXISTS leaves tables from older databases untouched, so
// columns added after a table first shipped are listed here and added on open.
export const ADDED_COLUMNS = [
  { table: 'swim_lanes', column: 'output_target', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'swim_lanes', column: 'auto_run_agent_id', definition: 'TEXT' },
  { table: 'swim_lanes', column: 'auto_run_terminal_id', definition: 'TEXT' },
  { table: 'swim_lanes', column: 'auto_run_worktrees', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'swim_lanes', column: 'full_auto', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tickets', column: 'full_auto', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tickets', column: 'worktree_path', definition: 'TEXT' },
  { table: 'tickets', column: 'pull_request_url', definition: 'TEXT' },
  { table: 'projects', column: 'archived', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'swim_lanes', column: 'closes_ticket', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tickets', column: 'closed_at', definition: 'TEXT' }
]

// closed_at lives in triggers, not app code, because agents move tickets by
// writing lane_id with the sqlite3 CLI while the app may be closed. The app's
// ticket UPDATE always lists lane_id, so each trigger checks the value moved.
const isClosingLane = (laneIdExpression: string) =>
  `EXISTS (SELECT 1 FROM swim_lanes WHERE project_path = NEW.project_path AND id = ${laneIdExpression} AND closes_ticket = 1)`
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

export const CLOSED_AT_TRIGGERS_SQL = `
CREATE TRIGGER IF NOT EXISTS tickets_closed_at_on_move
AFTER UPDATE OF lane_id ON tickets
WHEN NEW.lane_id IS NOT OLD.lane_id
BEGIN
  UPDATE tickets SET closed_at = CASE
    WHEN NOT ${isClosingLane('NEW.lane_id')} THEN NULL
    WHEN ${isClosingLane('OLD.lane_id')} THEN COALESCE(closed_at, ${NOW})
    ELSE ${NOW}
  END
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS tickets_closed_at_on_insert
AFTER INSERT ON tickets
WHEN ${isClosingLane('NEW.lane_id')}
BEGIN
  UPDATE tickets SET closed_at = ${NOW} WHERE id = NEW.id;
END;

-- Flagging a lane later counts what already sits in it, dated like the
-- migration backfill; unflagging it un-closes them.
CREATE TRIGGER IF NOT EXISTS swim_lanes_closed_at_on_flag
AFTER UPDATE OF closes_ticket ON swim_lanes
WHEN NEW.closes_ticket IS NOT OLD.closes_ticket
BEGIN
  UPDATE tickets SET closed_at = CASE WHEN NEW.closes_ticket = 1 THEN COALESCE(updated_at, created_at) END
  WHERE project_path = NEW.project_path AND lane_id = NEW.id;
END;

-- A lane row can first appear already flagged (the unassigned column gets its
-- row on first configure), so the insert path backfills the same way.
CREATE TRIGGER IF NOT EXISTS swim_lanes_closed_at_on_flagged_insert
AFTER INSERT ON swim_lanes
WHEN NEW.closes_ticket = 1
BEGIN
  UPDATE tickets SET closed_at = COALESCE(closed_at, updated_at, created_at)
  WHERE project_path = NEW.project_path AND lane_id = NEW.id;
END;
`

export const PATH_KIND_SCAN = 'scan'
export const PATH_KIND_HIDDEN = 'hidden'
export const PATH_KIND_THIRD_PARTY = 'third_party'

export const SETTING_VERSION = 'version'
export const SETTING_SCANNED_AT = 'snapshot_scanned_at'
export const SETTING_SCAN_FAILURES = 'snapshot_failures'
export const SETTING_UPDATED_AT = 'updated_at'
// Board view preferences live in user_settings as one JSON blob rather than
// columns on swim_lanes: they are per-user and purely presentational, so they
// never need to be queried, joined, or migrated alongside the shared board.
export const SETTING_BOARD_PREFERENCES = 'board_preferences'
