import { z } from "zod"

export const REVISION_LIMIT = 10
export const LOCAL_INDEX_DIR = ".opencharta"
export const ROLES = ["owner", "admin", "editor", "viewer"] as const

export type Role = (typeof ROLES)[number]
export type NodeKind = "folder" | "file"

export const roleSchema = z.enum(ROLES)

const roleRank: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
}

export function roleAtLeast(role: Role, minimum: Role) {
  return roleRank[role] >= roleRank[minimum]
}

export type User = {
  id: string
  email: string
  name: string
}

export type Workspace = {
  id: string
  name: string
  slug: string
  role: Role
  /** True when the person is not a member and only sees files shared with them. */
  shared: boolean
  createdAt: string
}

export type NodeShare = {
  nodeId: string
  userId: string
  email: string
  name: string
  role: ShareRole
}

export const SHARE_ROLES = ["editor", "viewer"] as const
export type ShareRole = (typeof SHARE_ROLES)[number]

export type Member = {
  userId: string
  email: string
  name: string
  role: Role
}

export type WorkspaceNode = {
  id: string
  parentId: string | null
  kind: NodeKind
  name: string
  path: string
  revision: number
  contentHash: string
  updatedAt: string
  /** What the person can do with this node. Null for a folder shown only because something inside it is shared. */
  role: Role | null
}

export type RevisionSummary = {
  revision: number
  contentHash: string
  authorId: string
  authorName: string
  createdAt: string
  byteLength: number
}

export type ChangeOp = "create" | "update" | "move" | "delete"

export type ChangeRecord = {
  seq: number
  op: ChangeOp
  nodeId: string
  actorId: string
  createdAt: string
  payload: Record<string, unknown>
}

export type ConflictDetails = {
  nodeId: string
  serverRevision: number
  serverContent: string
  serverHash: string
}

export type ApiErrorBody = {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export const registerBody = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(200),
})

export const loginBody = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200),
})

export const createWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(80),
})

export const addMemberBody = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  role: roleSchema.exclude(["owner"]),
})

export type ShareLink = {
  id: string
  nodeId: string
  role: ShareRole
  createdAt: string
  createdByName: string
  /** Only present right after the link is created; the server keeps a hash. */
  url?: string
}

export const createLinkBody = z.object({
  role: z.enum(SHARE_ROLES),
})

/** Pulls the secret out of a pasted share link, or accepts the bare secret. */
export function linkToken(input: string) {
  const trimmed = input.trim()
  const match = /\/l\/([A-Za-z0-9_-]+)\/?$/.exec(trimmed)
  if (match) return match[1]!
  return /^[A-Za-z0-9_-]{20,}$/.test(trimmed) ? trimmed : null
}

export const shareNodeBody = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  role: z.enum(SHARE_ROLES),
})

export const patchMemberBody = z.object({
  role: roleSchema,
})

export const createNodeBody = z.object({
  parentId: z.string().nullable(),
  kind: z.enum(["folder", "file"]),
  name: z.string().trim().min(1).max(180),
  content: z.string().max(2_000_000).optional(),
})

export const patchNodeBody = z.object({
  name: z.string().trim().min(1).max(180).optional(),
  parentId: z.string().nullable().optional(),
})

export const putContentBody = z.object({
  content: z.string().max(2_000_000),
  baseRevision: z.number().int().nonnegative(),
})

export function normalizeFileName(name: string) {
  const trimmed = name.trim()
  return trimmed.toLowerCase().endsWith(".md") ? trimmed : `${trimmed}.md`
}

export function validateNodeName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return "Name is required."
  if (trimmed === "." || trimmed === ".." || trimmed === LOCAL_INDEX_DIR) {
    return "That name is reserved."
  }
  if (/[\\/]|\0/.test(trimmed)) return "Names cannot include slashes."
  return null
}

export function rewriteMarkdownLinks(
  content: string,
  moves: Array<{ from: string; to: string }>,
) {
  const ordered = [...moves].sort((a, b) => b.from.length - a.from.length)
  let next = content
  for (const move of ordered) {
    for (const prefix of ["", "./", "/"]) {
      const from = `${prefix}${move.from}`
      const to = `${prefix}${move.to}`
      next = next.replaceAll(`](${from})`, `](${to})`)
      next = next.replaceAll(`](<${from}>)`, `](<${to}>)`)
    }
  }
  return next
}

export type RemoteNode = {
  id: string
  parentId: string | null
  kind: NodeKind
  name: string
  path: string
  revision: number
  contentHash: string
}

export type LocalEntry = {
  path: string
  kind: NodeKind
  contentHash: string
}

export type IndexEntry = {
  nodeId: string
  path: string
  kind: NodeKind
  baseRevision: number
  contentHash: string
}

export type SyncAction =
  | { type: "mkdir"; path: string }
  | { type: "write"; path: string; nodeId: string; revision: number }
  | { type: "rename-local"; from: string; to: string }
  | { type: "delete-local"; path: string }
  | { type: "conflict-copy"; from: string; to: string }
  | { type: "push-create"; path: string; kind: NodeKind }
  | { type: "push-update"; nodeId: string; path: string; baseRevision: number }
  | { type: "push-rename"; nodeId: string; path: string }
  | { type: "push-delete"; nodeId: string }
  | {
      type: "adopt"
      nodeId: string
      path: string
      kind: NodeKind
      baseRevision: number
      contentHash: string
    }
  | { type: "drop-index"; nodeId: string }

export function conflictCopyPath(path: string, label: string, date: string) {
  const slash = path.lastIndexOf("/")
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ""
  const base = slash >= 0 ? path.slice(slash + 1) : path
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ""
  return `${dir}${stem} (conflict, ${label}, ${date})${ext}`
}

function depth(path: string) {
  return path.split("/").length
}

function uniqueConflictPath(path: string, taken: Set<string>) {
  if (!taken.has(path)) return path
  const slash = path.lastIndexOf("/")
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ""
  const base = slash >= 0 ? path.slice(slash + 1) : path
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ""
  let n = 2
  while (taken.has(`${dir}${stem} ${n}${ext}`)) n += 1
  return `${dir}${stem} ${n}${ext}`
}

export function planSync(input: {
  remote: RemoteNode[]
  local: LocalEntry[]
  index: IndexEntry[]
  conflictDate: string
  conflictLabel?: string
}): SyncAction[] {
  const label = input.conflictLabel ?? "local"
  const remoteById = new Map(input.remote.map((node) => [node.id, node]))
  const remoteByPath = new Map(input.remote.map((node) => [node.path, node]))
  const localByPath = new Map(input.local.map((entry) => [entry.path, entry]))
  const indexById = new Map(input.index.map((entry) => [entry.nodeId, entry]))
  const indexByPath = new Map(input.index.map((entry) => [entry.path, entry]))
  const claimed = new Set<string>()
  const actions: SyncAction[] = []
  const taken = new Set(input.local.map((entry) => entry.path))

  const reserveConflict = (from: string, blockedPrefixes: string[]) => {
    let dest = conflictCopyPath(from, label, input.conflictDate)
    const blocked = blockedPrefixes.some(
      (prefix) => dest === prefix || dest.startsWith(`${prefix}/`),
    )
    if (blocked) dest = conflictCopyPath(from.slice(from.lastIndexOf("/") + 1), label, input.conflictDate)
    dest = uniqueConflictPath(dest, taken)
    taken.add(dest)
    return dest
  }

  const localByHash = new Map<string, LocalEntry[]>()
  for (const entry of input.local) {
    if (entry.kind !== "file" || !entry.contentHash) continue
    const list = localByHash.get(entry.contentHash) ?? []
    list.push(entry)
    localByHash.set(entry.contentHash, list)
  }

  const renamedLocally = new Set<string>()
  for (const indexed of input.index) {
    if (indexed.kind !== "file") continue
    const remote = remoteById.get(indexed.nodeId)
    if (!remote) continue
    if (remote.path !== indexed.path || remote.revision !== indexed.baseRevision) continue
    if (localByPath.has(indexed.path)) continue
    const twins = (localByHash.get(indexed.contentHash) ?? []).filter((entry) => {
      return !indexByPath.has(entry.path) && !remoteByPath.has(entry.path)
    })
    if (twins.length !== 1) continue
    const dest = twins[0]
    if (!dest) continue
    actions.push({ type: "push-rename", nodeId: indexed.nodeId, path: dest.path })
    claimed.add(dest.path)
    claimed.add(indexed.path)
    renamedLocally.add(indexed.nodeId)
  }

  const remoteSorted = [...input.remote].sort(
    (a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path),
  )

  for (const node of remoteSorted) {
    if (renamedLocally.has(node.id)) continue
    const indexed = indexById.get(node.id)
    const local = localByPath.get(node.path)

    if (!indexed) {
      if (!local) {
        actions.push(
          node.kind === "folder"
            ? { type: "mkdir", path: node.path }
            : { type: "write", path: node.path, nodeId: node.id, revision: node.revision },
        )
      } else if (
        node.kind === local.kind &&
        (node.kind === "folder" || local.contentHash === node.contentHash)
      ) {
        // Same path, same bytes: adopt it.
      } else {
        actions.push({
          type: "conflict-copy",
          from: node.path,
          to: reserveConflict(node.path, []),
        })
        actions.push(
          node.kind === "folder"
            ? { type: "mkdir", path: node.path }
            : { type: "write", path: node.path, nodeId: node.id, revision: node.revision },
        )
      }
      actions.push({
        type: "adopt",
        nodeId: node.id,
        path: node.path,
        kind: node.kind,
        baseRevision: node.revision,
        contentHash: node.contentHash,
      })
      claimed.add(node.path)
      continue
    }

    const localAtIndex = localByPath.get(indexed.path)
    const localDirty =
      indexed.kind === "file" &&
      localAtIndex?.kind === "file" &&
      localAtIndex.contentHash !== indexed.contentHash
    const localMissing = !localAtIndex
    const serverChanged =
      node.revision !== indexed.baseRevision ||
      node.path !== indexed.path ||
      node.contentHash !== indexed.contentHash
    const pathChanged = node.path !== indexed.path

    if (!serverChanged) {
      if (localMissing) {
        actions.push({ type: "push-delete", nodeId: node.id })
      } else if (localDirty) {
        actions.push({
          type: "push-update",
          nodeId: node.id,
          path: indexed.path,
          baseRevision: indexed.baseRevision,
        })
        claimed.add(indexed.path)
      } else {
        claimed.add(indexed.path)
      }
      continue
    }

    if (localDirty && localAtIndex) {
      const dest = reserveConflict(indexed.path, pathChanged ? [indexed.path] : [])
      actions.push({ type: "conflict-copy", from: indexed.path, to: dest })
      if (pathChanged) actions.push({ type: "delete-local", path: indexed.path })
      actions.push(
        node.kind === "file"
          ? { type: "write", path: node.path, nodeId: node.id, revision: node.revision }
          : { type: "mkdir", path: node.path },
      )
      actions.push({
        type: "adopt",
        nodeId: node.id,
        path: node.path,
        kind: node.kind,
        baseRevision: node.revision,
        contentHash: node.contentHash,
      })
      claimed.add(indexed.path)
      claimed.add(node.path)
      continue
    }

    if (localMissing && pathChanged) {
      const atNew = localByPath.get(node.path)
      if (atNew && (node.kind === "folder" || atNew.contentHash === node.contentHash)) {
        actions.push({
          type: "adopt",
          nodeId: node.id,
          path: node.path,
          kind: node.kind,
          baseRevision: node.revision,
          contentHash: node.contentHash,
        })
        claimed.add(node.path)
        continue
      }
    }

    if (pathChanged && node.kind === "file" && localAtIndex && !localDirty) {
      actions.push({ type: "mkdir", path: parentPath(node.path) })
      actions.push({ type: "rename-local", from: indexed.path, to: node.path })
      if (node.contentHash !== indexed.contentHash) {
        actions.push({ type: "write", path: node.path, nodeId: node.id, revision: node.revision })
      }
    } else if (pathChanged && node.kind === "folder") {
      actions.push({ type: "mkdir", path: node.path })
      if (localAtIndex) actions.push({ type: "delete-local", path: indexed.path })
    } else if (node.kind === "file" && node.contentHash !== indexed.contentHash) {
      actions.push({ type: "write", path: node.path, nodeId: node.id, revision: node.revision })
    } else if (node.kind === "folder") {
      actions.push({ type: "mkdir", path: node.path })
    }

    actions.push({
      type: "adopt",
      nodeId: node.id,
      path: node.path,
      kind: node.kind,
      baseRevision: node.revision,
      contentHash: node.contentHash,
    })
    claimed.add(indexed.path)
    claimed.add(node.path)
  }

  for (const indexed of input.index) {
    if (remoteById.has(indexed.nodeId) || renamedLocally.has(indexed.nodeId)) continue
    const local = localByPath.get(indexed.path)
    const dirty =
      local?.kind === "file" &&
      indexed.kind === "file" &&
      local.contentHash !== indexed.contentHash
    if (dirty) {
      actions.push({ type: "push-create", path: indexed.path, kind: "file" })
      claimed.add(indexed.path)
    } else if (local) {
      actions.push({ type: "delete-local", path: indexed.path })
      claimed.add(indexed.path)
    }
    actions.push({ type: "drop-index", nodeId: indexed.nodeId })
  }

  const unclaimed = input.local
    .filter((entry) => !claimed.has(entry.path) && !indexByPath.has(entry.path))
    .sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))
  for (const entry of unclaimed) {
    actions.push({ type: "push-create", path: entry.path, kind: entry.kind })
  }

  return sortActions(actions.filter((action) => action.type !== "mkdir" || action.path !== ""))
}

function parentPath(path: string) {
  const slash = path.lastIndexOf("/")
  return slash >= 0 ? path.slice(0, slash) : ""
}

function sortActions(actions: SyncAction[]) {
  const rank: Record<SyncAction["type"], number> = {
    "conflict-copy": 0,
    mkdir: 1,
    "rename-local": 2,
    write: 3,
    "delete-local": 4,
    "push-create": 5,
    "push-update": 6,
    "push-rename": 7,
    "push-delete": 8,
    adopt: 9,
    "drop-index": 10,
  }
  return [...actions].sort((a, b) => {
    const byType = rank[a.type] - rank[b.type]
    if (byType !== 0) return byType
    const pathA = "path" in a ? a.path : "from" in a ? a.from : ""
    const pathB = "path" in b ? b.path : "from" in b ? b.from : ""
    if (a.type === "delete-local" && b.type === "delete-local") {
      return depth(pathB) - depth(pathA)
    }
    return depth(pathA) - depth(pathB) || pathA.localeCompare(pathB)
  })
}

export type CollabClientMessage =
  | { type: "update"; update: string }
  | { type: "checkpoint" }

export type CollabPeer = { userId: string; name: string }

export type CollabServerMessage =
  | { type: "sync"; update: string; revision: number; peers: CollabPeer[] }
  | { type: "update"; update: string }
  | { type: "presence"; peers: CollabPeer[] }
  | { type: "checkpoint"; revision: number }
  | { type: "error"; message: string }

export function wsUrl(serverUrl: string, workspaceId: string, nodeId: string, token: string) {
  const url = new URL(serverUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = `/workspaces/${workspaceId}/collab`
  url.searchParams.set("nodeId", nodeId)
  url.searchParams.set("token", token)
  return url.toString()
}

export type AgentMode = "auto" | "manual"

export type AgentSettings = {
  mode: AgentMode
  url: string
  password: string
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  mode: "auto",
  url: "",
  password: "",
}

export type AgentConnectionState = "idle" | "connecting" | "ready" | "error"

export type AgentStatus = {
  state: AgentConnectionState
  message: string
  url: string | null
  version: string | null
  directory: string | null
}

export type AgentPart =
  | { kind: "text"; id: string; text: string }
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "error"; id: string; text: string }
  | {
      kind: "tool"
      id: string
      name: string
      input?: unknown
      status: "running" | "completed" | "error"
      output?: string
    }

export type AgentMessage = {
  id: string
  role: "user" | "assistant"
  at: number
  parts: AgentPart[]
}

export type AgentPermission = {
  id: string
  action: string
  resources: string[]
  message?: string
}

export type AgentPermissionDecision = "once" | "always" | "reject"

export type AgentState = {
  status: AgentStatus
  settings: AgentSettings
  messages: AgentMessage[]
  running: boolean
  permissions: AgentPermission[]
}

/** A file the agent changed on disk while it was open in the editor. */
export type DocExternalChange = {
  nodeId: string
  path: string
  content: string
}
