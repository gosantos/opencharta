import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Role, WorkspaceNode } from "@opencharta/shared"
import { startServer } from "../../apps/server/src/server"
import { syncFolder } from "../../apps/desktop/src/main/sync"
import { LiveDoc } from "../../apps/desktop/src/renderer/src/lib/collab"

/** A real server on a free port with its own database file. */
export async function bootServer(options: { dir?: string; keep?: boolean } = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "opencharta-e2e-"))
  const server = await startServer({
    dataFile: join(dir, "data.sqlite"),
    port: 0,
    hostname: "127.0.0.1",
    collab: { persistMs: 20, idleMs: 0 },
  })
  return {
    url: server.url,
    dir,
    async close() {
      await server.close()
      if (!options.keep) rmSync(dir, { recursive: true, force: true })
    },
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** One signed-in person talking to the server over HTTP. */
export class Client {
  constructor(
    readonly url: string,
    readonly token: string,
    readonly user: { id: string; email: string; name: string },
  ) {}

  static async register(url: string, email: string, name: string) {
    const body = await request<{ token: string; user: Client["user"] }>(url, "/auth/register", "POST", null, {
      email,
      name,
      password: "password123",
    })
    return new Client(url, body.token, body.user)
  }

  call<T>(path: string, method = "GET", body?: unknown) {
    return request<T>(this.url, path, method, this.token, body)
  }

  async createWorkspace(name: string) {
    return (await this.call<{ workspace: { id: string } }>("/workspaces", "POST", { name })).workspace
  }

  async addMember(workspaceId: string, email: string, role: Role) {
    return this.call(`/workspaces/${workspaceId}/members`, "POST", { email, role })
  }

  async nodes(workspaceId: string) {
    return (await this.call<{ nodes: WorkspaceNode[] }>(`/workspaces/${workspaceId}/nodes`)).nodes
  }

  async createFile(workspaceId: string, name: string, content = "", parentId: string | null = null) {
    return (
      await this.call<{ node: WorkspaceNode }>(`/workspaces/${workspaceId}/nodes`, "POST", {
        parentId,
        kind: "file",
        name,
        content,
      })
    ).node
  }

  async createFolder(workspaceId: string, name: string, parentId: string | null = null) {
    return (
      await this.call<{ node: WorkspaceNode }>(`/workspaces/${workspaceId}/nodes`, "POST", {
        parentId,
        kind: "folder",
        name,
      })
    ).node
  }

  async content(workspaceId: string, nodeId: string) {
    return this.call<{ content: string; revision: number }>(`/workspaces/${workspaceId}/nodes/${nodeId}/content`)
  }

  /** Opens a live editing session, the way the app's editor does. */
  async open(workspaceId: string, nodeId: string) {
    const peers: string[][] = []
    const errors: string[] = []
    const revisions: number[] = []
    const notices = { comments: 0 }
    let ready: () => void = () => {}
    const opened = new Promise<void>((resolve) => (ready = resolve))
    const doc = new LiveDoc(this.url, workspaceId, nodeId, this.token, {
      onReady: () => ready(),
      onPeers: (next) => peers.push(next.map((peer) => peer.name)),
      onRevision: (revision) => revisions.push(revision),
      onError: (message) => errors.push(message),
      onComments: () => {
        notices.comments += 1
      },
    })
    await Promise.race([opened, waitFor(() => errors.length > 0, "the file to open")])
    return { doc, peers, errors, revisions, notices }
  }
}

/** A Mac with a synced folder on disk. */
export class Mac {
  readonly root: string

  constructor(
    readonly client: Client,
    readonly workspaceId: string,
  ) {
    this.root = mkdtempSync(join(tmpdir(), "opencharta-mac-"))
  }

  sync() {
    return syncFolder({
      root: this.root,
      serverUrl: this.client.url,
      token: this.client.token,
      workspaceId: this.workspaceId,
    })
  }

  write(path: string, content: string) {
    const abs = join(this.root, path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }

  read(path: string) {
    return readFileSync(join(this.root, path), "utf8")
  }

  has(path: string) {
    return existsSync(join(this.root, path))
  }

  remove(path: string) {
    rmSync(join(this.root, path), { recursive: true, force: true })
  }

  files(dir = ""): string[] {
    const out: string[] = []
    for (const name of readdirSync(join(this.root, dir), { withFileTypes: true })) {
      if (name.name === ".opencharta") continue
      const rel = dir ? `${dir}/${name.name}` : name.name
      if (name.isDirectory()) out.push(...this.files(rel))
      else out.push(rel)
    }
    return out.sort()
  }

  dispose() {
    rmSync(this.root, { recursive: true, force: true })
  }
}

export async function waitFor(check: () => boolean, what: string, timeoutMs = 3000) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}.`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Polls an async read until it passes, for state the server settles in the background. */
export async function eventually<T>(read: () => Promise<T>, check: (value: T) => boolean, timeoutMs = 3000) {
  const started = Date.now()
  for (;;) {
    const value = await read()
    if (check(value)) return value
    if (Date.now() - started > timeoutMs) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function request<T>(url: string, path: string, method: string, token: string | null, body?: unknown) {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error?.code ?? "http", payload?.error?.message ?? "Request failed.")
  }
  return payload as T
}
