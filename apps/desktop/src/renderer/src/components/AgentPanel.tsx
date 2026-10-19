import { useEffect, useRef, useState, type ReactNode } from "react"
import DOMPurify from "dompurify"
import { marked } from "marked"
import type { AgentMessage, AgentPart, AgentPermission, AgentSettings, AgentState } from "@opencharta/shared"
import type { AgentContextFile } from "../../../shared/bridge"
import { ArrowUp, Asterisk, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const emptyState: AgentState = {
  status: { state: "idle", message: "Not connected", url: null, version: null, directory: null },
  settings: { mode: "auto", url: "", password: "" },
  messages: [],
  running: false,
  permissions: [],
}

export function AgentPanel({
  syncRoot,
  activeDoc,
  getActiveContext,
  onClose,
  onFilesChanged,
}: {
  syncRoot: string | null
  activeDoc: { path: string; name: string } | null
  getActiveContext: () => AgentContextFile | null
  onClose: () => void
  onFilesChanged: () => void
}) {
  const [state, setState] = useState<AgentState>(emptyState)
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [attachFile, setAttachFile] = useState(true)
  const scroll = useRef<HTMLDivElement>(null)
  const wasRunning = useRef(false)

  useEffect(() => {
    const stop = window.opencharta.onAgentState(setState)
    void window.opencharta.agentState().then(setState)
    return stop
  }, [])

  useEffect(() => {
    if (wasRunning.current && !state.running) onFilesChanged()
    wasRunning.current = state.running
  }, [state.running, onFilesChanged])

  useEffect(() => {
    const el = scroll.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.messages, state.running])

  const connected = state.status.state === "ready"

  async function run(action: () => Promise<AgentState>) {
    setError("")
    try {
      setState(await action())
    } catch (caught) {
      setError(cleanError(caught))
    }
  }

  async function send() {
    const value = text.trim()
    if (!value || state.running) return
    const active = attachFile ? getActiveContext() : null
    setText("")
    await run(() => window.opencharta.agentSend(value, active))
  }

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-line-soft bg-background">
      <header className="drag flex h-12 items-center justify-between gap-2 border-b border-line-soft px-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-agent text-background">
            <Asterisk className="size-3.5" strokeWidth={2.4} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              Agent
              <span className={cn("size-1.5 rounded-full", statusDot(state.status.state))} />
            </span>
            <span className="truncate text-[11px] text-subtle-foreground">Works on the files in your folder</span>
          </span>
        </div>
        <div className="no-drag flex items-center gap-1">
          {connected ? (
            <Button variant="ghost" size="xs" onClick={() => void run(() => window.opencharta.agentNewSession())}>
              New chat
            </Button>
          ) : null}
          <Button variant="ghost" size="xs" onClick={() => setSettingsOpen(true)}>
            Setup
          </Button>
          <Button variant="ghost" size="xs" onClick={onClose}>
            Hide
          </Button>
        </div>
      </header>

      <div ref={scroll} className="min-h-0 flex-1 overflow-auto px-4 py-4">
        {!syncRoot ? (
          <Notice
            title="Choose a folder first"
            body="The agent edits real Markdown files. Pick a sync folder and the agent will work inside it, so its changes appear here and sync to your team."
          />
        ) : !connected ? (
          <Notice
            title={state.status.state === "connecting" ? "Connecting…" : "No OpenCode server"}
            body={`${state.status.message}. Start one with “opencode serve”, or set the address in Setup.`}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void run(() => window.opencharta.agentConnect())}
              >
                Try again
              </Button>
            }
          />
        ) : state.messages.length === 0 ? (
          <Notice
            title="Ask the agent to edit your files"
            body={
              activeDoc
                ? `${activeDoc.name} is attached to your messages, so “make this shorter” just works. The agent edits files in ${syncRoot}.`
                : `It edits files in ${syncRoot}. Open a document to include it in your messages automatically.`
            }
          />
        ) : (
          <div className="flex flex-col gap-5">
            {state.messages.map((message) => (
              <MessageView key={message.id} message={message} />
            ))}
            {state.running ? (
              <p className="flex items-center gap-2 text-xs font-medium text-agent-ink">
                <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-agent" />
                Working…
              </p>
            ) : null}
          </div>
        )}
      </div>

      {state.permissions.length ? (
        <div className="border-t border-line-soft">
          {state.permissions.map((permission) => (
            <PermissionView
              key={permission.id}
              permission={permission}
              onReply={(decision) =>
                void run(() => window.opencharta.agentReplyPermission(permission.id, decision))
              }
            />
          ))}
        </div>
      ) : null}

      {syncRoot ? (
        <div className="border-t border-line-soft p-3">
          {error ? <p className="mb-2 text-xs">{error}</p> : null}
          {activeDoc ? (
            <button
              type="button"
              onClick={() => setAttachFile((value) => !value)}
              title={
                attachFile
                  ? "The open document is attached to your message. Click to send without it."
                  : "The open document is not attached. Click to include it."
              }
              className={cn(
                "mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
                attachFile ? "border-agent text-agent-ink" : "border-border text-muted-foreground",
              )}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", attachFile ? "bg-agent" : "bg-border")} />
              <span className="truncate">{activeDoc.name}</span>
            </button>
          ) : null}
          <textarea
            className="h-20 w-full resize-none rounded-lg border border-input bg-background p-2.5 text-sm outline-none focus-visible:border-agent focus-visible:ring-[3px] focus-visible:ring-agent/15 disabled:opacity-50"
            placeholder={connected ? "Tell the agent what to change…" : "Connect to start chatting"}
            value={text}
            disabled={!connected}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="truncate text-xs text-muted-foreground">{state.status.message}</span>
            {state.running ? (
              <Button variant="outline" size="sm" onClick={() => void run(() => window.opencharta.agentInterrupt())}>
                <Square className="size-3 fill-current" />
                Stop
              </Button>
            ) : (
              <Button variant="agent" size="sm" disabled={!connected || !text.trim()} onClick={() => void send()}>
                <ArrowUp />
                Send
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={state.settings}
        status={state.status}
        onSave={async (patch) => {
          await run(() => window.opencharta.agentSetSettings(patch))
          await run(() => window.opencharta.agentConnect())
        }}
      />
    </aside>
  )
}

function MessageView({ message }: { message: AgentMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[88%] rounded-[12px_12px_4px_12px] bg-foreground px-3 py-2 text-sm whitespace-pre-wrap text-background">
          <span className="sr-only">You: </span>
          {textOf(message.parts)}
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {message.parts.map((part) => (
        <PartView key={part.id} part={part} />
      ))}
    </div>
  )
}

function PartView({ part }: { part: AgentPart }) {
  if (part.kind === "reasoning") {
    if (!part.text.trim()) return null
    return (
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Thinking</summary>
        <p className="mt-1 whitespace-pre-wrap">{part.text}</p>
      </details>
    )
  }
  if (part.kind === "error") {
    return <p className="border-l-2 border-destructive pl-2 text-sm">{part.text}</p>
  }
  if (part.kind === "tool") {
    return (
      <details className="rounded-md border border-line-soft bg-muted/50 text-xs">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-2 py-1.5">
          <span className="font-medium">{part.name}</span>
          <span className="text-muted-foreground">{toolLabel(part.status)}</span>
        </summary>
        {part.input !== undefined ? (
          <pre className="overflow-auto border-t border-line-soft px-2 py-1.5 text-[11px]">
            {stringify(part.input)}
          </pre>
        ) : null}
        {part.output ? (
          <pre className="max-h-48 overflow-auto border-t border-line-soft px-2 py-1.5 text-[11px] whitespace-pre-wrap">
            {part.output}
          </pre>
        ) : null}
      </details>
    )
  }
  const html = DOMPurify.sanitize(marked.parse(part.text, { async: false }) as string)
  return <div className="agent-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

function PermissionView({
  permission,
  onReply,
}: {
  permission: AgentPermission
  onReply: (decision: "once" | "always" | "reject") => void
}) {
  return (
    <div className="border-b border-conflict-border bg-conflict p-3 text-sm">
      <p>
        The agent wants to <span className="font-medium">{permission.action}</span>
        {permission.resources.length ? `: ${permission.resources.join(", ")}` : ""}
      </p>
      {permission.message ? <p className="mt-1 text-xs text-muted-foreground">{permission.message}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => onReply("once")}>
          Allow once
        </Button>
        <Button variant="outline" size="sm" onClick={() => onReply("always")}>
          Always
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onReply("reject")}>
          Deny
        </Button>
      </div>
    </div>
  )
}

function SettingsDialog({
  open,
  onOpenChange,
  settings,
  status,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: AgentSettings
  status: AgentState["status"]
  onSave: (patch: Partial<AgentSettings>) => Promise<void>
}) {
  const [mode, setMode] = useState<AgentSettings["mode"]>(settings.mode)
  const [url, setUrl] = useState(settings.url)
  const [password, setPassword] = useState(settings.password)

  useEffect(() => {
    if (!open) return
    setMode(settings.mode)
    setUrl(settings.url)
    setPassword(settings.password)
  }, [open, settings])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>OpenCode server</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void onSave({ mode, url: mode === "manual" ? url.trim() : "", password })
            onOpenChange(false)
          }}
        >
          <div className="grid gap-2">
            <Label>Connection</Label>
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={mode}
              onChange={(event) => setMode(event.target.value as AgentSettings["mode"])}
            >
              <option value="auto">Find the OpenCode server on this Mac</option>
              <option value="manual">Use a specific address</option>
            </select>
          </div>
          {mode === "manual" ? (
            <>
              <div className="grid gap-2">
                <Label>Address</Label>
                <Input
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="http://127.0.0.1:4096"
                />
              </div>
              <div className="grid gap-2">
                <Label>Password (optional)</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Leave blank if the server needs no auth"
                />
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              OpenCharta reads the running server’s registration file from your state directory.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {status.url ? `Last address: ${status.url}` : "No address yet."}
            {status.version ? ` · v${status.version}` : ""}
          </p>
          <DialogFooter>
            <Button type="submit">Save and connect</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Notice({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-agent/20 bg-agent-soft/60 p-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

function textOf(parts: AgentPart[]) {
  return parts
    .map((part) => (part.kind === "text" ? part.text : ""))
    .join("")
    .trim()
}

function toolLabel(status: "running" | "completed" | "error") {
  if (status === "running") return "running…"
  if (status === "error") return "failed"
  return "done"
}

function stringify(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function statusDot(state: AgentState["status"]["state"]) {
  if (state === "ready") return "bg-primary"
  if (state === "connecting") return "animate-pulse bg-muted-foreground"
  if (state === "error") return "border border-destructive bg-background"
  return "bg-border"
}

function cleanError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : "Something went wrong."
  const marker = message.lastIndexOf("Error: ")
  return marker >= 0 ? message.slice(marker + 7) : message
}
