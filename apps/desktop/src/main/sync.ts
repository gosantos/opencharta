import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  LOCAL_INDEX_DIR,
  planSync,
  type ConflictDetails,
  type IndexEntry,
  type LocalEntry,
  type RemoteNode,
  type SyncAction,
  type WorkspaceNode,
} from "@opencharta/shared"

type FolderIndex = {
  workspaceId: string
  cursor: number
  nodes: IndexEntry[]
}

type SyncResult = {
  changed: boolean
  message: string
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown,
  ) {
    super(message)
  }
}

export async function syncFolder(input: {
  root: string
  serverUrl: string
  token: string
  workspaceId: string
}): Promise<SyncResult> {
  const indexPath = join(input.root, LOCAL_INDEX_DIR, "index.json")
  const index = readIndex(indexPath, input.workspaceId)
  const api = new Api(input.serverUrl, input.token)
  let changed = false
  let note = "Synced"

  for (let pass = 0; pass < 4; pass += 1) {
    const remote = await api.nodes(input.workspaceId)
    const local = scan(input.root)
    const actions = planSync({
      remote: remote.map(toRemote),
      local,
      index: index.nodes,
      conflictDate: new Date().toISOString().slice(0, 10),
    })
    if (actions.length === 0) break
    const outcome = await applyActions(input.root, input.workspaceId, api, index, actions)
    changed = true
    if (outcome.note) note = outcome.note
    if (!outcome.progress) break
  }

  const changes = await api.changes(input.workspaceId, index.cursor)
  index.cursor = changes.cursor
  writeIndex(indexPath, index)
  return { changed, message: note }
}

async function applyActions(
  root: string,
  workspaceId: string,
  api: Api,
  index: FolderIndex,
  actions: SyncAction[],
) {
  const failed = new Set<string>()
  const byId = new Map(index.nodes.map((entry) => [entry.nodeId, entry]))
  let note = ""
  let progress = false
  const pathToId = new Map<string, string>()
  for (const entry of index.nodes) pathToId.set(entry.path, entry.nodeId)
  const remote = await api.nodes(workspaceId)
  for (const node of remote) pathToId.set(node.path, node.id)

  for (const action of actions) {
    if (action.type === "mkdir") {
      mkdirSync(join(root, action.path), { recursive: true })
      progress = true
    } else if (action.type === "conflict-copy") {
      const from = join(root, action.from)
      const to = join(root, action.to)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to)
      note = "Kept both copies of a file that changed in two places."
      progress = true
    } else if (action.type === "rename-local") {
      mkdirSync(dirname(join(root, action.to)), { recursive: true })
      renameSync(join(root, action.from), join(root, action.to))
      progress = true
    } else if (action.type === "write") {
      try {
        const content = await api.content(workspaceId, action.nodeId)
        const path = join(root, action.path)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, content.content)
        progress = true
      } catch {
        failed.add(action.nodeId)
        note = "Could not download a file."
      }
    } else if (action.type === "delete-local") {
      rmSync(join(root, action.path), { recursive: true, force: true })
      progress = true
    } else if (action.type === "push-create") {
      try {
        const created = await createNode(root, workspaceId, api, pathToId, action.path, action.kind)
        pathToId.set(created.path, created.id)
        byId.set(created.id, {
          nodeId: created.id,
          path: created.path,
          kind: created.kind,
          baseRevision: created.revision,
          contentHash: created.contentHash,
        })
        progress = true
      } catch (error) {
        note = error instanceof Error ? error.message : "Could not upload a file."
      }
    } else if (action.type === "push-update") {
      try {
        const content = readFileSync(join(root, action.path), "utf8")
        const saved = await api.putContent(workspaceId, action.nodeId, content, action.baseRevision)
        const current = byId.get(action.nodeId)
        byId.set(action.nodeId, {
          nodeId: action.nodeId,
          path: action.path,
          kind: "file",
          baseRevision: saved.revision,
          contentHash: saved.contentHash,
        })
        if (current) current.path = action.path
        progress = true
      } catch (error) {
        if (error instanceof HttpError && (error.code === "conflict" || error.code === "editing")) {
          const resolved = resolveConflict(root, action.path, error.details)
          byId.set(action.nodeId, {
            nodeId: action.nodeId,
            path: action.path,
            kind: "file",
            baseRevision: resolved.revision,
            contentHash: resolved.hash,
          })
          note = "Kept both copies of a file that changed in two places."
          progress = true
        } else {
          note = error instanceof Error ? error.message : "Could not upload a file."
        }
      }
    } else if (action.type === "push-rename") {
      try {
        const parentPath = action.path.includes("/") ? action.path.slice(0, action.path.lastIndexOf("/")) : ""
        const parentId = parentPath ? (pathToId.get(parentPath) ?? null) : null
        const name = action.path.slice(action.path.lastIndexOf("/") + 1)
        const node = await api.patchNode(workspaceId, action.nodeId, { name, parentId })
        pathToId.set(node.path, node.id)
        const current = byId.get(action.nodeId)
        if (current) current.path = node.path
        progress = true
      } catch (error) {
        note = error instanceof Error ? error.message : "Could not rename a file."
      }
    } else if (action.type === "push-delete") {
      try {
        await api.deleteNode(workspaceId, action.nodeId)
        byId.delete(action.nodeId)
        progress = true
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) byId.delete(action.nodeId)
        else note = error instanceof Error ? error.message : "Could not delete a file."
      }
    } else if (action.type === "adopt") {
      if (failed.has(action.nodeId)) continue
      byId.set(action.nodeId, {
        nodeId: action.nodeId,
        path: action.path,
        kind: action.kind,
        baseRevision: action.baseRevision,
        contentHash: action.contentHash,
      })
    } else if (action.type === "drop-index") {
      byId.delete(action.nodeId)
    }
  }

  index.nodes = [...byId.values()]
  return { progress, note }
}

async function createNode(
  root: string,
  workspaceId: string,
  api: Api,
  pathToId: Map<string, string>,
  path: string,
  kind: "file" | "folder",
) {
  const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
  let parentId: string | null = null
  if (parentPath) {
    parentId = pathToId.get(parentPath) ?? null
    if (!parentId) {
      const parent = await createNode(root, workspaceId, api, pathToId, parentPath, "folder")
      parentId = parent.id
    }
  }
  const name = path.slice(path.lastIndexOf("/") + 1)
  const content = kind === "file" ? readFileSync(join(root, path), "utf8") : undefined
  const node = await api.createNode(workspaceId, { parentId, kind, name, content })
  pathToId.set(node.path, node.id)
  return node
}

function resolveConflict(root: string, path: string, details: unknown) {
  const payload = details as Partial<ConflictDetails> & {
    revision?: number
    content?: string
    contentHash?: string
  }
  const revision = payload.serverRevision ?? payload.revision ?? 0
  const content = payload.serverContent ?? payload.content ?? ""
  const hash = payload.serverHash ?? payload.contentHash ?? sha256(content)
  const from = join(root, path)
  const dest = join(root, conflictName(path))
  mkdirSync(dirname(dest), { recursive: true })
  if (exists(from)) copyFileSync(from, dest)
  writeFileSync(from, content)
  return { revision, hash }
}

function conflictName(path: string) {
  const date = new Date().toISOString().slice(0, 10)
  const slash = path.lastIndexOf("/")
  const dir = slash >= 0 ? path.slice(0, slash + 1) : ""
  const base = slash >= 0 ? path.slice(slash + 1) : path
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ""
  return `${dir}${stem} (conflict, local, ${date})${ext}`
}

function scan(root: string): LocalEntry[] {
  const entries: LocalEntry[] = []
  const walk = (dir: string, rel: string) => {
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name === LOCAL_INDEX_DIR || name === ".DS_Store") continue
      const abs = join(dir, name)
      const path = rel ? `${rel}/${name}` : name
      const stat = statSync(abs)
      if (stat.isDirectory()) {
        entries.push({ path, kind: "folder", contentHash: "" })
        walk(abs, path)
      } else if (name.toLowerCase().endsWith(".md")) {
        entries.push({ path, kind: "file", contentHash: sha256(readFileSync(abs, "utf8")) })
      }
    }
  }
  walk(root, "")
  return entries
}

function readIndex(path: string, workspaceId: string): FolderIndex {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as FolderIndex
    if (parsed.workspaceId !== workspaceId) {
      throw new Error("This folder is already synced to another workspace.")
    }
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message.includes("another workspace")) throw error
    return { workspaceId, cursor: 0, nodes: [] }
  }
}

function writeIndex(path: string, index: FolderIndex) {
  mkdirSync(dirname(path), { recursive: true })
  const next = JSON.stringify(index, null, 2)
  try {
    if (readFileSync(path, "utf8") === next) return
  } catch {
    // first write
  }
  writeFileSync(path, next)
}

function toRemote(node: WorkspaceNode): RemoteNode {
  return {
    id: node.id,
    parentId: node.parentId,
    kind: node.kind,
    name: node.name,
    path: node.path,
    revision: node.revision,
    contentHash: node.contentHash,
  }
}

function sha256(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

function exists(path: string) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

class Api {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  nodes(workspaceId: string) {
    return this.get<{ nodes: WorkspaceNode[] }>(`/workspaces/${workspaceId}/nodes`).then((body) => body.nodes)
  }

  changes(workspaceId: string, since: number) {
    return this.get<{ cursor: number }>(`/workspaces/${workspaceId}/changes?since=${since}`)
  }

  content(workspaceId: string, nodeId: string) {
    return this.get<{ content: string; revision: number; contentHash: string }>(
      `/workspaces/${workspaceId}/nodes/${nodeId}/content`,
    )
  }

  createNode(
    workspaceId: string,
    body: { parentId: string | null; kind: "file" | "folder"; name: string; content?: string },
  ) {
    return this.send<{ node: WorkspaceNode }>(`/workspaces/${workspaceId}/nodes`, "POST", body).then((result) => result.node)
  }

  patchNode(workspaceId: string, nodeId: string, body: { name: string; parentId: string | null }) {
    return this.send<{ node: WorkspaceNode }>(`/workspaces/${workspaceId}/nodes/${nodeId}`, "PATCH", body).then(
      (result) => result.node,
    )
  }

  deleteNode(workspaceId: string, nodeId: string) {
    return this.send(`/workspaces/${workspaceId}/nodes/${nodeId}`, "DELETE")
  }

  putContent(workspaceId: string, nodeId: string, content: string, baseRevision: number) {
    return this.send<{ revision: number; contentHash: string }>(
      `/workspaces/${workspaceId}/nodes/${nodeId}/content`,
      "PUT",
      { content, baseRevision },
    )
  }

  private get<T>(path: string) {
    return this.send<T>(path, "GET")
  }

  private async send<T>(path: string, method: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new Error("Can't reach the server.")
    }
    const payload = (await response.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null
    if (!response.ok) {
      throw new HttpError(
        response.status,
        payload?.error?.code ?? "http",
        payload?.error?.message ?? "The server rejected that change.",
        payload?.error?.details,
      )
    }
    return payload as T
  }
}
