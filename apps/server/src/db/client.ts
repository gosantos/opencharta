import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"
import { migrate } from "./migrate"

export function openDatabase(filename: string) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true })
  const sqlite = new Database(filename)
  if (filename !== ":memory:") sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  migrate(sqlite)
  const db = drizzle({ client: sqlite, schema })
  return { sqlite, db }
}

export type Db = ReturnType<typeof openDatabase>["db"]
