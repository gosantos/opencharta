import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type {
  AgentMessage,
  AgentPart,
  AgentPermission,
  AgentPermissionDecision,
  AgentSettings,
  AgentState,
  AgentStatus,
} from "@opencharta/shared"
import type { AgentContextFile } from "../shared/bridge"

type Endpoint = { url: string; password: string }

type RawEvent = { type: string; data: Record<string, any> }

const INLINE_ATTACHMENT_LIMIT = 200_000

/** Standing instruction key that names the document the user is looking at. */
const ACTIVE_DOCUMENT_KEY = "opencharta.active-document"

export type AgentSessionRef = { id: string; directory: string }

type SessionStore = {
  load: () => AgentSessionRef | null
  save: (ref: AgentSessionRef | null) => void
}

const DEFAULT_URL = "http://127.0.0.1:4096"
const RECONNECT_MS = [1000, 2000, 4000, 8000, 10000]

export class AgentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export class AgentManager {
  private status: AgentStatus = {
    state: "idle",
    message: "Not connected",
    url: null,
    version: null,
    directory: null,
  }
  private settings: AgentSettings
  private endpoint: Endpoint | null = null
  private session: { id: string; directory: string } | null = null
  private messages: AgentMessage[] = []
  private permissions: AgentPermission[] = []
  private running = false
  private wantStream = false
  private streamAbort: AbortController | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private emitTimer: ReturnType<typeof setTimeout> | null = null
  private directory: string | null = null

  constructor(
    settings: AgentSettings,
    private readonly emit: (state: AgentState) => void,
    private readonly store?: SessionStore,
  ) {
    this.settings = { ...settings }
  }

  state(): AgentState {
    return {
      status: { ...this.status },
      settings: { ...this.settings },
      messages: this.messages,
      running: this.running,
      permissions: this.permissions,
    }
  }

  /** The directory the agent works in — the workspace's synced folder. */
  setDirectory(directory: string | null) {
    const next = directory || null
    if (next === this.directory) return
    this.directory = next
    this.status = { ...this.status, directory: next }
    if (this.session && this.session.directory !== next) {
      this.session = null
      this.messages = []
      this.running = false
    }
    if (this.status.state === "ready" && next) void this.ensureSession()
    this.publish()
  }

  async setSettings(patch: Partial<AgentSettings>): Promise<AgentState> {
    this.settings = { ...this.settings, ...patch }
    return this.state()
  }

  async connect(): Promise<AgentState> {
    this.reconnectAttempt = 0
    await this.open()
    return this.state()
  }

  disconnect(): AgentState {
    this.wantStream = false
    this.clearReconnect()
    this.streamAbort?.abort()
    this.streamAbort = null
    this.endpoint = null
    this.running = false
    this.status = { ...this.status, state: "idle", message: "Not connected", url: null, version: null }
    this.publish()
    return this.state()
  }

  async shutdown() {
    this.wantStream = false
    this.clearReconnect()
    this.streamAbort?.abort()
  }

  async newSession(): Promise<AgentState> {
    this.session = null
    this.messages = []
    this.permissions = []
    this.running = false
    this.store?.save(null)
    if (this.status.state === "ready") await this.ensureSession()
    this.publish()
    return this.state()
  }

  async send(text: string, active?: AgentContextFile): Promise<AgentState> {
    const trimmed = text.trim()
    if (!trimmed) return this.state()
    if (this.status.state !== "ready") {
      throw new AgentError(0, "The agent is not connected.")
    }
    if (!this.directory) {
      throw new AgentError(0, "Choose a folder to sync first — the agent works in that folder.")
    }
    await this.ensureSession()
    if (!this.session) throw new AgentError(0, "Couldn't open an agent session.")
    await this.attachContext(active)
    const body: Record<string, unknown> = { text: trimmed }
    if (active && active.content.length > 0 && active.content.length <= INLINE_ATTACHMENT_LIMIT) {
      body.files = [
        {
          uri: `data:text/markdown;base64,${Buffer.from(active.content, "utf8").toString("base64")}`,
          name: active.name || active.path,
          description: "The Markdown document the user is looking at in the OpenCharta editor.",
        },
      ]
    }
    const result = await this.call<{ data: { id?: string; time?: { created?: number } } }>(
      `/api/session/${this.session.id}/prompt`,
      { method: "POST", body: JSON.stringify(body) },
    )
    this.messages = [
      ...this.messages,
      {
        id: result?.data?.id ?? `local-${Date.now()}`,
        role: "user",
        at: result?.data?.time?.created ?? Date.now(),
        parts: [{ kind: "text", id: "text", text: trimmed }],
      },
    ]
    this.running = true
    this.publish()
    return this.state()
  }

  /**
   * Keep a standing instruction on the session that names the file the user is
   * looking at, so "make this shorter" resolves without them spelling it out.
   */
  private async attachContext(active?: AgentContextFile) {
    if (!this.session) return
    const path = `/api/experimental/session/${this.session.id}/instructions/entries/${ACTIVE_DOCUMENT_KEY}`
    try {
      if (active) {
        await this.call(path, {
          method: "PUT",
          body: JSON.stringify({
            value: {
              path: active.path,
              note: 'The user is looking at this file in the OpenCharta editor. When they say "this", "it", or "the document" without naming a file, they mean this one. Its current contents are attached to their message.',
            },
          }),
        })
      } else {
        await this.call(path, { method: "DELETE" })
      }
    } catch {
      // Standing context is best effort; the attachment still carries the file.
    }
  }

  async interrupt(): Promise<AgentState> {
    if (this.session) {
      try {
        await this.call(`/api/session/${this.session.id}/interrupt`, { method: "POST" })
      } catch {
        // The turn may have already finished.
      }
    }
    this.running = false
    this.publish()
    return this.state()
  }

  async replyPermission(id: string, decision: AgentPermissionDecision): Promise<AgentState> {
    if (this.session) {
      await this.call(`/api/session/${this.session.id}/permission/${id}/reply`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      })
    }
    this.permissions = this.permissions.filter((permission) => permission.id !== id)
    this.publish()
    return this.state()
  }

  private async open() {
    this.wantStream = true
    const endpoint = this.resolveEndpoint()
    this.status = { ...this.status, state: "connecting", message: "Connecting…", url: endpoint.url, version: null }
    this.publish()
    try {
      const info = await this.callWith<{ version?: string }>(endpoint, "/api/info")
      this.endpoint = endpoint
      this.status = {
        ...this.status,
        state: "ready",
        message: "Connected",
        url: endpoint.url,
        version: info?.version ?? null,
      }
      this.reconnectAttempt = 0
      this.publish()
      if (this.directory) await this.ensureSession()
      this.startStream()
    } catch (error) {
      this.endpoint = null
      const message = error instanceof AgentError ? error.message : "Can't reach the OpenCode server."
      this.status = { ...this.status, state: "error", message, url: endpoint.url, version: null }
      this.publish()
    }
  }

  private resolveEndpoint(): Endpoint {
    if (this.settings.mode === "manual" && this.settings.url.trim()) {
      return { url: this.settings.url.trim().replace(/\/$/, ""), password: this.settings.password }
    }
    const discovered = discoverLocal()
    if (discovered) return discovered
    return { url: DEFAULT_URL, password: this.settings.password }
  }

  private async ensureSession() {
    if (!this.endpoint || !this.directory) return
    if (this.session && this.session.directory === this.directory) return
    const saved = this.store?.load()
    if (saved && saved.directory === this.directory) {
      try {
        await this.call(`/api/session/${saved.id}`)
        this.session = { id: saved.id, directory: saved.directory }
        this.messages = []
        this.permissions = []
        this.publish()
        this.reconcile()
        return
      } catch {
        this.store?.save(null)
      }
    }
    try {
      const created = await this.call<{ data: { id: string } }>(`/api/session`, {
        method: "POST",
        body: JSON.stringify({
          location: { directory: this.directory },
          title: "OpenCharta",
        }),
      })
      const id = created?.data?.id
      if (!id) throw new AgentError(0, "The server did not return a session.")
      this.session = { id, directory: this.directory }
      this.store?.save({ id, directory: this.directory })
      this.messages = []
      this.permissions = []
      this.status = { ...this.status, message: "Connected" }
      this.publish()
    } catch (error) {
      const message = error instanceof AgentError ? error.message : "Couldn't open an agent session."
      this.status = { ...this.status, state: "error", message }
      this.publish()
      throw error
    }
  }

  private startStream() {
    this.clearReconnect()
    this.streamAbort?.abort()
    const endpoint = this.endpoint
    if (!endpoint) return
    const abort = new AbortController()
    this.streamAbort = abort
    void (async () => {
      try {
        const response = await fetch(`${endpoint.url}/api/event`, {
          headers: { authorization: basicAuth(endpoint.password) },
          signal: abort.signal,
        })
        if (!response.ok || !response.body) {
          throw new AgentError(response.status, `Event stream failed (${response.status}).`)
        }
        this.reconnectAttempt = 0
        await readFrames(response.body, (event) => this.handleEvent(event))
        if (!abort.signal.aborted) this.scheduleReconnect()
      } catch {
        if (!abort.signal.aborted) this.scheduleReconnect()
      }
    })()
  }

  private scheduleReconnect() {
    if (!this.wantStream) return
    const delay = RECONNECT_MS[Math.min(this.reconnectAttempt, RECONNECT_MS.length - 1)] ?? 10000
    this.reconnectAttempt += 1
    this.status = { ...this.status, state: "connecting", message: "Reconnecting…" }
    this.publish()
    this.clearReconnect()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void (async () => {
        try {
          const endpoint = this.endpoint ?? this.resolveEndpoint()
          const info = await this.callWith<{ version?: string }>(endpoint, "/api/info")
          this.endpoint = endpoint
          this.status = {
            ...this.status,
            state: "ready",
            message: "Connected",
            url: endpoint.url,
            version: info?.version ?? this.status.version,
          }
          this.publish()
          if (this.directory) {
            this.session = null
            await this.ensureSession()
          }
          this.reconcile()
          this.startStream()
        } catch {
          this.scheduleReconnect()
        }
      })()
    }, delay)
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private handleEvent(event: RawEvent) {
    const data = event.data ?? {}
    const sessionID = typeof data.sessionID === "string" ? data.sessionID : null
    if (sessionID && this.session && sessionID !== this.session.id) return

    switch (event.type) {
      case "session.step.started":
        this.running = true
        this.assistant(data.assistantMessageID, data.started)
        break
      case "session.text.started":
        this.part(data, "text")
        break
      case "session.text.delta":
        this.appendText(data, "text", data.delta)
        break
      case "session.text.ended":
        this.finishText(data, "text")
        break
      case "session.reasoning.started":
        this.part(data, "reasoning")
        break
      case "session.reasoning.delta":
        this.appendText(data, "reasoning", data.delta)
        break
      case "session.reasoning.ended":
        this.finishText(data, "reasoning")
        break
      case "session.tool.input.started":
        this.tool(data, data.id, data.name)
        break
      case "session.tool.input.ended":
        this.setToolInput(data.id, parseMaybeJson(data.text))
        break
      case "session.tool.called":
        this.tool(data, data.id, data.name)
        this.setToolInput(data.id, data.input)
        break
      case "session.tool.success":
        this.setToolResult(data.id, "completed", contentText(data.content))
        break
      case "session.tool.error":
      case "session.tool.failed":
        this.setToolInput(data.id, data.input)
        this.setToolResult(data.id, "error", data.error?.message ?? contentText(data.content))
        break
      case "session.execution.started":
        this.running = true
        break
      case "session.execution.succeeded":
      case "session.execution.interrupted":
        this.running = false
        this.reconcile()
        break
      case "session.execution.failed":
        this.running = false
        this.addError(data.error?.message ?? "The agent turn failed.")
        break
      case "session.error":
        this.addError(data.error?.message ?? data.message ?? "The agent reported an error.")
        break
      case "session.idle":
        this.running = false
        if (data.error?.message) this.addError(data.error.message)
        this.reconcile()
        break
      case "permission.asked":
        this.addPermission(data)
        break
      case "permission.replied":
        this.permissions = this.permissions.filter((permission) => permission.id !== data.id)
        break
      default:
        break
    }
    this.publish()
  }

  private assistant(id: string | undefined, at: number | undefined): AgentMessage | null {
    if (!id) return null
    const existing = this.messages.find((message) => message.id === id)
    if (existing) return existing
    const created: AgentMessage = { id, role: "assistant", at: at ?? Date.now(), parts: [] }
    this.messages = [...this.messages, created]
    return created
  }

  private part(data: Record<string, any>, kind: "text" | "reasoning"): AgentPart | null {
    const message = this.assistant(data.assistantMessageID, undefined)
    if (!message) return null
    const id = partId(kind, data.ordinal)
    return ensurePart(message, kind, id)
  }

  private appendText(data: Record<string, any>, kind: "text" | "reasoning", delta: unknown) {
    if (typeof delta !== "string") return
    const message = this.assistant(data.assistantMessageID, undefined)
    if (!message) return
    const id = partId(kind, data.ordinal)
    const existing = ensurePart(message, kind, id)
    if (existing && (existing.kind === "text" || existing.kind === "reasoning")) {
      existing.text += delta
    }
  }

  private finishText(data: Record<string, any>, kind: "text" | "reasoning") {
    if (typeof data.text !== "string") return
    const message = this.assistant(data.assistantMessageID, undefined)
    if (!message) return
    const id = partId(kind, data.ordinal)
    const existing = ensurePart(message, kind, id)
    if (existing && (existing.kind === "text" || existing.kind === "reasoning")) {
      existing.text = data.text
    }
  }

  private tool(data: Record<string, any>, callId: unknown, name: unknown) {
    const message = this.assistant(data.assistantMessageID, undefined)
    if (!message || typeof callId !== "string") return
    const existing = message.parts.find(
      (part): part is Extract<AgentPart, { kind: "tool" }> =>
        part.kind === "tool" && part.id === callId,
    )
    if (existing) {
      if (typeof name === "string") existing.name = name
      return
    }
    message.parts.push({
      kind: "tool",
      id: callId,
      name: typeof name === "string" ? name : "tool",
      status: "running",
    })
  }

  private setToolInput(callId: unknown, input: unknown) {
    if (typeof callId !== "string") return
    const part = this.findTool(callId)
    if (part && input !== undefined) part.input = input
  }

  private setToolResult(callId: unknown, status: "completed" | "error", output: string | undefined) {
    if (typeof callId !== "string") return
    const part = this.findTool(callId)
    if (!part) return
    part.status = status
    if (output) part.output = output
  }

  private findTool(callId: string): Extract<AgentPart, { kind: "tool" }> | null {
    for (const message of this.messages) {
      for (const part of message.parts) {
        if (part.kind === "tool" && part.id === callId) return part
      }
    }
    return null
  }

  private addError(text: string) {
    this.messages = [
      ...this.messages,
      {
        id: `error-${Date.now()}`,
        role: "assistant",
        at: Date.now(),
        parts: [{ kind: "error", id: "error", text }],
      },
    ]
  }

  private addPermission(data: Record<string, any>) {
    if (typeof data.id !== "string" || this.permissions.some((permission) => permission.id === data.id)) {
      return
    }
    this.permissions = [
      ...this.permissions,
      {
        id: data.id,
        action: typeof data.action === "string" ? data.action : "tool",
        resources: Array.isArray(data.resources) ? data.resources.map(String) : [],
        message: typeof data.message === "string" ? data.message : undefined,
      },
    ]
  }

  /** Rebuild the conversation from the server so late or missed details converge. */
  private reconcile() {
    if (!this.session) return
    void (async () => {
      try {
        const result = await this.call<{ data: SessionMessage[] }>(
          `/api/session/${this.session?.id}/message`,
        )
        const messages = rebuild(result?.data ?? [])
        if (messages.length) this.messages = messages
        this.publish()
      } catch {
        // Keep what we already have.
      }
    })()
  }

  private publish() {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emit(this.state())
    }, 60)
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.endpoint) throw new AgentError(0, "Not connected.")
    return this.callWith<T>(this.endpoint, path, init)
  }

  private async callWith<T>(endpoint: Endpoint, path: string, init: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${endpoint.url}${path}`, {
        ...init,
        headers: {
          authorization: basicAuth(endpoint.password),
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      })
    } catch {
      throw new AgentError(0, "Can't reach the OpenCode server.")
    }
    const text = await response.text()
    let body: any = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    if (!response.ok) {
      const message =
        body?.message ?? body?.error?.message ?? `The server rejected the request (${response.status}).`
      throw new AgentError(response.status, String(message))
    }
    return body as T
  }
}

type SessionMessage = {
  id: string
  type: string
  time?: { created?: number }
  text?: string
  content?: Array<{ type: string; text?: string; name?: string; id?: string; input?: unknown; state?: any }>
}

function rebuild(input: SessionMessage[]): AgentMessage[] {
  const sorted = [...input].sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0))
  const messages: AgentMessage[] = []
  for (const raw of sorted) {
    if (raw.type === "user") {
      messages.push({
        id: raw.id,
        role: "user",
        at: raw.time?.created ?? 0,
        parts: [{ kind: "text", id: "text", text: raw.text ?? "" }],
      })
      continue
    }
    if (raw.type !== "assistant") continue
    const parts: AgentPart[] = []
    for (const [index, item] of (raw.content ?? []).entries()) {
      if (item.type === "text" && item.text) {
        parts.push({ kind: "text", id: `text:${index}`, text: item.text })
      } else if (item.type === "reasoning" && item.text) {
        parts.push({ kind: "reasoning", id: `reasoning:${index}`, text: item.text })
      } else if (item.type === "tool") {
        const status = item.state?.status
        parts.push({
          kind: "tool",
          id: item.id ?? `tool:${index}`,
          name: item.name ?? "tool",
          input: item.state?.input ?? item.input,
          status: status === "error" ? "error" : status === "running" ? "running" : "completed",
          output: contentText(item.state?.content),
        })
      }
    }
    if (parts.length) {
      messages.push({ id: raw.id, role: "assistant", at: raw.time?.created ?? 0, parts })
    }
  }
  return messages
}

function ensurePart(
  message: AgentMessage,
  kind: "text" | "reasoning",
  id: string,
): Extract<AgentPart, { kind: "text" | "reasoning" }> {
  const existing = message.parts.find((part) => part.id === id && part.kind === kind)
  if (existing && (existing.kind === "text" || existing.kind === "reasoning")) return existing
  const created: AgentPart = { kind, id, text: "" }
  message.parts.push(created)
  return created as Extract<AgentPart, { kind: "text" | "reasoning" }>
}

function partId(kind: string, ordinal: unknown) {
  return `${kind}:${typeof ordinal === "number" ? ordinal : 0}`
}

function contentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const text = content
    .map((item) => (item && typeof item === "object" && "text" in item ? String((item as any).text) : ""))
    .filter(Boolean)
    .join("\n")
  return text || undefined
}

function parseMaybeJson(text: unknown): unknown {
  if (typeof text !== "string") return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function basicAuth(password: string) {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
}

function stateDirectory() {
  const configured = process.env.XDG_STATE_HOME
  return configured && configured.trim() ? configured : join(homedir(), ".local", "state")
}

function discoverLocal(): Endpoint | null {
  const candidates = [
    join(stateDirectory(), "opencode", "service.json"),
    join(homedir(), ".config", "opencode", "service.json"),
  ]
  for (const file of candidates) {
    try {
      const info = JSON.parse(readFileSync(file, "utf8")) as { url?: string; password?: string }
      if (info.url) return { url: info.url.replace(/\/$/, ""), password: info.password ?? "" }
    } catch {
      // Try the next location.
    }
  }
  return null
}

async function readFrames(body: ReadableStream<Uint8Array>, onEvent: (event: RawEvent) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split("\n\n")
    buffer = frames.pop() ?? ""
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
      if (!data) continue
      try {
        const parsed = JSON.parse(data) as { type?: string; data?: Record<string, any> }
        if (parsed && typeof parsed.type === "string") {
          onEvent({ type: parsed.type, data: parsed.data ?? {} })
        }
      } catch {
        // Ignore malformed frames.
      }
    }
  }
}
