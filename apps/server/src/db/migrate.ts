import type Database from "better-sqlite3"

const initial = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  parent_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  yjs_state BLOB,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS nodes_workspace_idx ON nodes(workspace_id);

CREATE TABLE IF NOT EXISTS revisions (
  node_id TEXT NOT NULL REFERENCES nodes(id),
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, revision)
);

CREATE TABLE IF NOT EXISTS changes (
  workspace_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  op TEXT NOT NULL,
  node_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, seq)
);
`

export function migrate(sqlite: Database.Database) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY)`)
  const applied = sqlite.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>
  if (applied.some((row) => row.id === "0001_init")) return
  sqlite.exec(initial)
  sqlite.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run("0001_init")
}
