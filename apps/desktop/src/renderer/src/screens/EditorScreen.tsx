import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import DOMPurify from "dompurify"
import { marked } from "marked"
import { roleAtLeast, type CollabPeer, type Member, type NodeShare, type RevisionSummary, type Role, type ShareRole, type User, type Workspace, type WorkspaceNode } from "@opencharta/shared"
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
import type { AgentContextFile, SyncStatus } from "../../../shared/bridge"
import { AgentPanel } from "../components/AgentPanel"
import { MarkdownEditor } from "../components/MarkdownEditor"
import { Api, ApiError } from "../lib/api"
import { LiveDoc } from "../lib/collab"

export function EditorScreen({
  serverUrl,
  token,
  user,
  workspace,
  sync,
  onSyncNow,
  onPickFolder,
  onBack,
  onSignOut,
}: {
  serverUrl: string
  token: string
  user: User
  workspace: Workspace
  sync: SyncStatus
  onSyncNow: () => void
  onPickFolder: () => void
  onBack: () => Promise<void>
  onSignOut: () => Promise<void>
}) {
  const api = useMemo(() => new Api(serverUrl, token), [serverUrl, token])
  const [nodes, setNodes] = useState<WorkspaceNode[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState<"file" | "folder" | null>(null)
  const [renaming, setRenaming] = useState<WorkspaceNode | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [sharing, setSharing] = useState<WorkspaceNode | null>(null)
  const [mode, setMode] = useState<"edit" | "view">("edit")
  const [agentOpen, setAgentOpen] = useState(true)
  const liveRef = useRef<LiveDoc | null>(null)
  const selected = nodes.find((node) => node.id === selectedId && node.kind === "file") ?? null
  const canEdit = canEditNode(selected)
  // New files go next to the selection, so creating is allowed when that folder is editable.
  const picked = nodes.find((node) => node.id === selectedId)
  const createParentId = picked?.kind === "folder" ? picked.id : (picked?.parentId ?? null)
  const createParent = nodes.find((node) => node.id === createParentId) ?? null
  const canCreate = createParent
    ? canEditNode(createParent)
    : !workspace.shared && roleAtLeast(workspace.role, "editor")
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  // What the agent should see: the open document and its live contents.
  const getActiveContext = useCallback((): AgentContextFile | null => {
    const node = selectedRef.current
    const doc = liveRef.current
    if (!node || !doc) return null
    return { path: node.path, name: node.name, content: doc.isReady ? doc.text.toString() : "" }
  }, [])

  async function refresh() {
    try {
      setNodes((await api.nodes(workspace.id)).nodes)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Can't reach the server.")
    }
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 4000)
    return () => clearInterval(timer)
  }, [workspace.id])

  useEffect(() => {
    void window.opencharta.setTitle(selected ? `${selected.name} — OpenCharta` : workspace.name)
  }, [selected, workspace.name])

  // Tell the main process which document is open so the agent's edits to it can
  // be applied live instead of colliding with the open editor.
  useEffect(() => {
    void window.opencharta.docSetOpen(selected ? { nodeId: selected.id, path: selected.path } : null)
  }, [selected?.id, selected?.path])

  useEffect(() => {
    return window.opencharta.onDocExternal((change) => {
      if (change.nodeId !== selectedId) return
      const doc = liveRef.current
      if (doc) applyExternalEdit(doc, change.content)
    })
  }, [selectedId])

  return (
    <div className="relative flex h-full bg-white text-black">
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-border">
        <div className="drag flex h-14 items-end px-4 pb-3 pl-20">
          <button type="button" className="no-drag text-left" onClick={() => void onBack()}>
            <span className="block text-sm font-medium">OpenCharta</span>
            <span className="block text-xs text-muted-foreground">{workspace.name}</span>
          </button>
        </div>
        <nav className="min-h-0 flex-1 overflow-auto px-2 pb-3">
          <Tree
            nodes={nodes}
            parentId={null}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRename={setRenaming}
            onDelete={async (node) => {
              await api.deleteNode(workspace.id, node.id)
              if (selectedId === node.id) setSelectedId(null)
              await refresh()
            }}
            onShare={setSharing}
          />
        </nav>
        {canCreate ? (
          <div className="flex gap-2 border-t border-border p-3">
            <Button variant="outline" size="sm" onClick={() => setCreating("file")}>
              New file
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCreating("folder")}>
              New folder
            </Button>
          </div>
        ) : null}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="drag flex h-14 items-center justify-between gap-4 border-b border-border px-6">
          <div className="no-drag min-w-0">
            <p className="truncate text-sm">{selected?.path ?? "No file open"}</p>
            <p className="text-xs text-muted-foreground">{sync.message}</p>
          </div>
          <div className="no-drag flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onPickFolder}>
              {sync.root ? "Change folder" : "Choose folder"}
            </Button>
            <Button variant="ghost" size="sm" onClick={onSyncNow}>
              Sync
            </Button>
            {workspace.shared ? null : (
              <Button variant="ghost" size="sm" onClick={() => setMembersOpen(true)}>
                People
              </Button>
            )}
            {selected && canEdit ? (
              <Button variant="ghost" size="sm" onClick={() => setSharing(selected)}>
                Share
              </Button>
            ) : null}
            {selected && canEdit ? (
              <Button variant="ghost" size="sm" onClick={() => setMode(mode === "edit" ? "view" : "edit")}>
                {mode === "edit" ? "View" : "Edit"}
              </Button>
            ) : null}
            {selected ? (
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                History
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setAgentOpen((open) => !open)}>
              {agentOpen ? "Hide agent" : "Agent"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void onSignOut()}>
              Sign out
            </Button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto px-10 py-8">
          {error ? <p className="mb-4 text-sm">{error}</p> : null}
          {selected ? (
            <Document
              key={selected.id}
              serverUrl={serverUrl}
              token={token}
              workspaceId={workspace.id}
              node={selected}
              userId={user.id}
              viewing={mode === "view" || !canEdit}
              onLiveDoc={(doc) => {
                liveRef.current = doc
              }}
            />
          ) : (
            <p className="font-serif text-xl text-muted-foreground">Select a file, or create one.</p>
          )}
        </div>
      </section>
      {agentOpen ? (
        <div className="absolute top-14 right-0 bottom-0 z-20 shadow-[-12px_0_32px_-24px_rgba(0,0,0,0.45)]">
          <AgentPanel
            syncRoot={sync.root}
            activeDoc={selected ? { path: selected.path, name: selected.name } : null}
            getActiveContext={getActiveContext}
            onClose={() => setAgentOpen(false)}
            onFilesChanged={() => void refresh()}
          />
        </div>
      ) : null}
      <NameDialog
        open={creating !== null}
        title={creating === "folder" ? "New folder" : "New file"}
        onOpenChange={(open) => {
          if (!open) setCreating(null)
        }}
        onSubmit={async (name) => {
          const created = await api.createNode(workspace.id, {
            parentId: createParentId,
            kind: creating === "folder" ? "folder" : "file",
            name,
          })
          setCreating(null)
          await refresh()
          if (created.node.kind === "file") setSelectedId(created.node.id)
        }}
      />
      <NameDialog
        open={renaming !== null}
        title="Rename"
        initial={renaming?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setRenaming(null)
        }}
        onSubmit={async (name) => {
          if (!renaming) return
          await api.updateNode(workspace.id, renaming.id, { name })
          setRenaming(null)
          await refresh()
        }}
      />
      {selected ? (
        <HistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          api={api}
          workspaceId={workspace.id}
          nodeId={selected.id}
          canEdit={canEdit}
        />
      ) : null}
      <ShareDialog
        node={sharing}
        onOpenChange={(open) => {
          if (!open) setSharing(null)
        }}
        api={api}
        workspaceId={workspace.id}
        userId={user.id}
      />
      <MembersDialog
        open={membersOpen}
        onOpenChange={setMembersOpen}
        api={api}
        workspaceId={workspace.id}
        role={workspace.role}
      />
    </div>
  )
}

function Tree({
  nodes,
  parentId,
  selectedId,
  onSelect,
  onRename,
  onDelete,
  onShare,
  depth = 0,
}: {
  nodes: WorkspaceNode[]
  parentId: string | null
  selectedId: string | null
  onSelect: (id: string) => void
  onRename: (node: WorkspaceNode) => void
  onDelete: (node: WorkspaceNode) => void
  onShare: (node: WorkspaceNode) => void
  depth?: number
}) {
  const children = nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1))
  return (
    <ul>
      {children.map((node) => (
        <li key={node.id}>
          <div
            className="group flex items-center gap-1 rounded-sm pr-1"
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            <button
              type="button"
              className={`min-w-0 flex-1 truncate rounded-sm px-2 py-1 text-left text-sm ${
                selectedId === node.id ? "bg-black text-white" : "hover:bg-muted"
              }`}
              onClick={() => onSelect(node.id)}
            >
              {node.kind === "folder" ? node.name : node.name.replace(/\.md$/, "")}
            </button>
            {canEditNode(node) ? (
              <span className="hidden gap-1 group-hover:flex">
                <button type="button" className="text-xs text-muted-foreground" onClick={() => onShare(node)}>
                  Share
                </button>
                <button type="button" className="text-xs text-muted-foreground" onClick={() => onRename(node)}>
                  Rename
                </button>
                <button type="button" className="text-xs text-muted-foreground" onClick={() => onDelete(node)}>
                  Delete
                </button>
              </span>
            ) : null}
          </div>
          {node.kind === "folder" ? (
            <Tree
              nodes={nodes}
              parentId={node.id}
              selectedId={selectedId}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              onShare={onShare}
              depth={depth + 1}
            />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function Document({
  serverUrl,
  token,
  workspaceId,
  node,
  userId,
  viewing,
  onLiveDoc,
}: {
  serverUrl: string
  token: string
  workspaceId: string
  node: WorkspaceNode
  userId: string
  viewing: boolean
  onLiveDoc?: (doc: LiveDoc | null) => void
}) {
  const [live, setLive] = useState<LiveDoc | null>(null)
  const [ready, setReady] = useState(false)
  const [peers, setPeers] = useState<CollabPeer[]>([])
  const [preview, setPreview] = useState("")
  const [error, setError] = useState("")
  const liveDocRef = useRef(onLiveDoc)
  liveDocRef.current = onLiveDoc

  useEffect(() => {
    const doc = new LiveDoc(serverUrl, workspaceId, node.id, token, {
      onReady: () => {
        setReady(true)
        setError("")
        setPreview(doc.text.toString())
      },
      onPeers: setPeers,
      onRevision: () => undefined,
      onError: setError,
    })
    doc.text.observe(() => setPreview(doc.text.toString()))
    setLive(doc)
    liveDocRef.current?.(doc)
    return () => {
      doc.checkpoint()
      doc.destroy()
      setLive(null)
      setReady(false)
      liveDocRef.current?.(null)
    }
  }, [serverUrl, workspaceId, node.id, token])

  const others = peers.filter((peer) => peer.userId !== userId).map((peer) => peer.name)
  const html = DOMPurify.sanitize(marked.parse(preview, { async: false }) as string)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {others.length ? <p className="mb-4 text-sm text-muted-foreground">{presence(others)}</p> : null}
      {error ? <p className="mb-4 text-sm">{error}</p> : null}
      {viewing ? (
        <article className="markdown" dangerouslySetInnerHTML={{ __html: html || "<p></p>" }} />
      ) : ready && live ? (
        <MarkdownEditor text={live.text} onSave={() => live.checkpoint()} />
      ) : (
        <p className="text-sm text-muted-foreground">Opening…</p>
      )}
      </div>
  )
}

function canEditNode(node: WorkspaceNode | null) {
  return !!node?.role && roleAtLeast(node.role, "editor")
}

function ShareDialog({
  node,
  onOpenChange,
  api,
  workspaceId,
  userId,
}: {
  node: WorkspaceNode | null
  onOpenChange: (open: boolean) => void
  api: Api
  workspaceId: string
  userId: string
}) {
  const [shares, setShares] = useState<NodeShare[]>([])
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<ShareRole>("editor")
  const [error, setError] = useState("")
  const nodeId = node?.id ?? null

  useEffect(() => {
    setShares([])
    setError("")
    if (!nodeId) return
    void api
      .shares(workspaceId, nodeId)
      .then((result) => setShares(result.shares))
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "Could not load who has access."))
  }, [nodeId, api, workspaceId])

  const canGrantEditor = !!node?.role && roleAtLeast(node.role, "editor")

  return (
    <Dialog open={node !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {node?.kind === "folder" ? node.name : node?.name.replace(/\.md$/, "")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {node?.kind === "folder"
            ? "People you add can open everything in this folder, even if they are not in the workspace."
            : "People you add can open this file, even if they are not in the workspace."}
        </p>
        {shares.length ? (
          <ul className="divide-y divide-border">
            {shares.map((share) => (
              <li key={share.userId} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {share.name}
                  <span className="ml-2 text-muted-foreground">{share.email}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span>{share.role}</span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground"
                    onClick={async () => {
                      if (!nodeId) return
                      try {
                        await api.unshare(workspaceId, nodeId, share.userId)
                        setShares((current) => current.filter((item) => item.userId !== share.userId))
                      } catch (caught) {
                        setError(caught instanceof ApiError ? caught.message : "Could not remove access.")
                      }
                    }}
                  >
                    {share.userId === userId ? "Leave" : "Remove"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!nodeId) return
            setError("")
            try {
              const result = await api.share(workspaceId, nodeId, email, role)
              setShares(result.shares)
              setEmail("")
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Could not share with that person.")
            }
          }}
        >
          <Label>Share with someone who has an account</Label>
          <div className="flex gap-2">
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <select
              className="h-9 rounded-md border border-input bg-white px-2 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value as ShareRole)}
            >
              {canGrantEditor ? <option value="editor">Editor</option> : null}
              <option value="viewer">Viewer</option>
            </select>
            <Button type="submit">Share</Button>
          </div>
          {error ? <p className="text-sm">{error}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  )
}

function presence(names: string[]) {
  if (names.length === 1) return `${names[0]} is here`
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are here`
}

/**
 * Apply a file the agent rewrote as a live editing change. Only the differing
 * middle section is replaced, so anyone typing elsewhere in the same document
 * keeps their work instead of being overwritten.
 */
function applyExternalEdit(doc: LiveDoc, content: string) {
  const text = doc.text
  const current = text.toString()
  if (current === content) return
  let start = 0
  const shortest = Math.min(current.length, content.length)
  while (start < shortest && current[start] === content[start]) start += 1
  let endCurrent = current.length
  let endNext = content.length
  while (endCurrent > start && endNext > start && current[endCurrent - 1] === content[endNext - 1]) {
    endCurrent -= 1
    endNext -= 1
  }
  doc.doc.transact(() => {
    if (endCurrent > start) text.delete(start, endCurrent - start)
    if (endNext > start) text.insert(start, content.slice(start, endNext))
  })
}

function NameDialog({
  open,
  title,
  initial = "",
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  title: string
  initial?: string
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState("")
  useEffect(() => {
    if (open) {
      setName(initial)
      setError("")
    }
  }, [open, initial])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            try {
              await onSubmit(name)
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Could not save that name.")
            }
          }}
        >
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus required />
          </div>
          {error ? <p className="text-sm">{error}</p> : null}
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function HistoryDialog({
  open,
  onOpenChange,
  api,
  workspaceId,
  nodeId,
  canEdit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  api: Api
  workspaceId: string
  nodeId: string
  canEdit: boolean
}) {
  const [revisions, setRevisions] = useState<RevisionSummary[]>([])
  const [preview, setPreview] = useState("")
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    void api.revisions(workspaceId, nodeId).then((result) => {
      setRevisions(result.revisions)
      const first = result.revisions[0]
      if (!first) return
      setSelected(first.revision)
      void api.revision(workspaceId, nodeId, first.revision).then((body) => setPreview(body.content))
    })
  }, [open, api, workspaceId, nodeId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-96 grid-cols-[180px_1fr] gap-4">
          <ul className="overflow-auto border-r border-border pr-3">
            {revisions.map((revision) => (
              <li key={revision.revision}>
                <button
                  type="button"
                  className={`block w-full py-2 text-left text-sm ${selected === revision.revision ? "font-medium" : "text-muted-foreground"}`}
                  onClick={() => {
                    setSelected(revision.revision)
                    void api.revision(workspaceId, nodeId, revision.revision).then((body) => setPreview(body.content))
                  }}
                >
                  {new Date(revision.createdAt).toLocaleString()}
                  <span className="block text-xs">{revision.authorName}</span>
                </button>
              </li>
            ))}
          </ul>
          <pre className="overflow-auto font-serif text-sm whitespace-pre-wrap">{preview}</pre>
        </div>
        {canEdit && selected ? (
          <DialogFooter>
            <Button
              onClick={async () => {
                await api.restore(workspaceId, nodeId, selected)
                onOpenChange(false)
              }}
            >
              Restore this version
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function MembersDialog({
  open,
  onOpenChange,
  api,
  workspaceId,
  role,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  api: Api
  workspaceId: string
  role: Role
}) {
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState("")
  const [nextRole, setNextRole] = useState<Exclude<Role, "owner">>("editor")
  const [error, setError] = useState("")
  const canAdmin = roleAtLeast(role, "admin")

  useEffect(() => {
    if (!open) return
    void api.members(workspaceId).then((result) => setMembers(result.members))
  }, [open, api, workspaceId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>People</DialogTitle>
        </DialogHeader>
        <ul className="divide-y divide-border">
          {members.map((member) => (
            <li key={member.userId} className="flex items-baseline justify-between py-2 text-sm">
              <span>
                {member.name}
                <span className="ml-2 text-muted-foreground">{member.email}</span>
              </span>
              <span>{member.role}</span>
            </li>
          ))}
        </ul>
        {canAdmin ? (
          <form
            className="grid gap-3"
            onSubmit={async (event) => {
              event.preventDefault()
              setError("")
              try {
                const result = await api.addMember(workspaceId, email, nextRole)
                setMembers(result.members)
                setEmail("")
              } catch (caught) {
                setError(caught instanceof ApiError ? caught.message : "Could not add that person.")
              }
            }}
          >
            <Label>Add someone who already has an account</Label>
            <div className="flex gap-2">
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              <select
                className="h-9 rounded-md border border-input bg-white px-2 text-sm"
                value={nextRole}
                onChange={(event) => setNextRole(event.target.value as Exclude<Role, "owner">)}
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
              <Button type="submit">Add</Button>
            </div>
            {error ? <p className="text-sm">{error}</p> : null}
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
