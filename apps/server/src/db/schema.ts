import { blob, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
})

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
})

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at").notNull(),
})

export const memberships = sqliteTable(
  "memberships",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
)

export const nodes = sqliteTable(
  "nodes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    parentId: text("parent_id"),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    revision: integer("revision").notNull().default(0),
    content: text("content").notNull().default(""),
    contentHash: text("content_hash").notNull().default(""),
    yjsState: blob("yjs_state", { mode: "buffer" }),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
  },
  (table) => [index("nodes_workspace_idx").on(table.workspaceId)],
)

export const revisions = sqliteTable(
  "revisions",
  {
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id),
    revision: integer("revision").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    authorId: text("author_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.nodeId, table.revision] })],
)

export const changes = sqliteTable(
  "changes",
  {
    workspaceId: text("workspace_id").notNull(),
    seq: integer("seq").notNull(),
    op: text("op").notNull(),
    nodeId: text("node_id").notNull(),
    payload: text("payload").notNull(),
    actorId: text("actor_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.seq] })],
)

export const nodeShares = sqliteTable(
  "node_shares",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.nodeId, table.userId] }),
    index("node_shares_user_idx").on(table.userId, table.workspaceId),
  ],
)

export const shareLinks = sqliteTable(
  "share_links",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id),
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("share_links_node_idx").on(table.nodeId)],
)

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    nodeId: text("node_id")
      .notNull()
      .references(() => nodes.id),
    parentId: text("parent_id"),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    quote: text("quote").notNull().default(""),
    resolvedAt: integer("resolved_at"),
    suggestion: text("suggestion"),
    acceptedAt: integer("accepted_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("comments_node_idx").on(table.nodeId)],
)
