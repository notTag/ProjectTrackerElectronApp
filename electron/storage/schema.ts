// Projects, lanes and tickets are shared: one row per real-world thing, so an
// edit by any member is immediately what every other member sees. Users attach
// to that shared data two ways — membership (who can see a project) and
// assignment (who is working a ticket) — never by owning a private copy.
export const SCHEMA_VERSION = 2

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

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
  last_scanned_at TEXT NOT NULL
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
  labels_json TEXT,
  checklist_json TEXT,
  agent_run_json TEXT,
  external_id TEXT,
  external_url TEXT,
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
