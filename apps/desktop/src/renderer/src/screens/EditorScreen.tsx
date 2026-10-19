import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import DOMPurify from "dompurify"
import { marked } from "marked"
import { roleAtLeast, type CollabPeer, type Member, type NodeShare, type RevisionSummary, type ShareLink, type Role, type ShareRole, type User, type Workspace, type WorkspaceNode } from "@opencharta/shared"
import {
  Asterisk,
  ChevronsUpDown,
  Copy,
  Ellipsis,
  Eye,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Globe,
  History,
  Link as LinkIcon,
  LogOut,
  MessageSquare,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar, AvatarStack } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { AgentContextFile, SyncStatus } from "../../../shared/bridge"
import { CommentsPanel } from "../components/CommentsPanel"
import { AgentPanel } from "../components/AgentPanel"
import { MarkdownEditor } from "../components/MarkdownEditor"
import { IconButton } from "../components/IconButton"
import { Logo } from "../components/Logo"
import { QuickOpen, type QuickAction } from "../components/QuickOpen"
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
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [selection, setSelection] = useState("")
  const [commentsVersion, setCommentsVersion] = useState(0)
  const [mode, setMode] = useState<"edit" | "view">("edit")
  const [agentOpen, setAgentOpen] = useState(true)
  const [quickOpen, setQuickOpen] = useState(false)
  const [peers, setPeers] = useState<CollabPeer[]>([])
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

  // ⌘K opens quick open from anywhere, including the editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setQuickOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  const others = [...new Map(peers.filter((peer) => peer.userId !== user.id).map((peer) => [peer.userId, peer])).values()]
  const crumbs = selected ? selected.path.split("/").slice(0, -1) : []
  const fileCount = nodes.filter((node) => node.kind === "file").length
  const actionIcon = "size-4 text-subtle-foreground"
  const quickActions: QuickAction[] = [
    ...(canCreate
      ? [
          { id: "new-file", label: "New file", icon: <FilePlus className={actionIcon} />, run: () => setCreating("file") },
          { id: "new-folder", label: "New folder", icon: <FolderPlus className={actionIcon} />, run: () => setCreating("folder") },
        ]
      : []),
    ...(selected && canEdit
      ? [{ id: "share", label: `Share ${selected.name}…`, icon: <UserPlus className={actionIcon} />, run: () => setSharing(selected) }]
      : []),
    ...(selected
      ? [
          {
            id: "comments",
            label: commentsOpen ? "Hide comments" : "Show comments",
            icon: <MessageSquare className={actionIcon} />,
            run: () => setCommentsOpen((open) => !open),
          },
          { id: "history", label: "Show history", icon: <History className={actionIcon} />, run: () => setHistoryOpen(true) },
        ]
      : []),
    {
      id: "agent",
      label: agentOpen ? "Hide the agent panel" : "Show the agent panel",
      icon: <Asterisk className="size-4 text-agent-ink" />,
      run: () => setAgentOpen((open) => !open),
    },
    { id: "sync", label: "Sync now", icon: <RefreshCw className={actionIcon} />, run: onSyncNow },
    {
      id: "folder",
      label: sync.root ? "Change sync folder…" : "Choose sync folder…",
      icon: <FolderOpen className={actionIcon} />,
      run: onPickFolder,
    },
    ...(workspace.shared
      ? []
      : [{ id: "people", label: "People in this workspace", icon: <Users className={actionIcon} />, run: () => setMembersOpen(true) }]),
    { id: "switch", label: "Switch workspace", icon: <ChevronsUpDown className={actionIcon} />, run: () => void onBack() },
  ]

  return (
    <div className="relative flex h-full bg-background text-foreground">
      <aside className="flex w-[236px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="drag h-12 shrink-0" />
        <div className="flex flex-col gap-2 px-2.5">
          <button
            type="button"
            title="Switch workspace"
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-sidebar-accent"
            onClick={() => void onBack()}
          >
            <Logo size={28} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-semibold">{workspace.name}</span>
              <span className="truncate text-[11.5px] text-subtle-foreground">{roleLabel(workspace)}</span>
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-subtle-foreground" />
          </button>
          <button
            type="button"
            className="flex h-8 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-[13px] text-subtle-foreground transition-colors hover:border-ring/40 hover:text-muted-foreground"
            onClick={() => setQuickOpen(true)}
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-left">Search or jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
        </div>
        <div className="mt-4 flex items-center justify-between px-[18px] pb-1 text-[11px] font-semibold tracking-[0.04em] text-subtle-foreground uppercase">
          <span>Files</span>
          <span className="font-medium tracking-normal normal-case">{fileCount}</span>
        </div>
        <nav aria-label="Files" className="min-h-0 flex-1 overflow-auto px-2.5 pb-3">
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
          {nodes.length === 0 ? <p className="px-2 py-1 text-xs text-subtle-foreground">No files yet.</p> : null}
        </nav>
        {canCreate ? (
          <div className="flex gap-1 px-2.5 pb-2">
            <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={() => setCreating("file")}>
              <FilePlus />
              New file
            </Button>
            <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={() => setCreating("folder")}>
              <FolderPlus />
              New folder
            </Button>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 border-t border-sidebar-border p-2.5">
          <div className="rounded-lg border border-input bg-background px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", syncDot(sync.state))} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={sync.message}>
                {syncTitle(sync)}
              </span>
              <IconButton label="Sync now" className="-mr-1 size-6" onClick={onSyncNow}>
                <RefreshCw className="size-3.5" />
              </IconButton>
            </div>
            {sync.root ? (
              <p className="mt-0.5 truncate text-[11.5px] text-subtle-foreground" title={sync.root}>
                {shortPath(sync.root)}
              </p>
            ) : null}
            <button type="button" className="mt-1 text-xs font-medium text-brand-ink hover:underline" onClick={onPickFolder}>
              {sync.root ? "Change folder" : "Choose folder"}
            </button>
          </div>
          <div className="flex items-center gap-2 pl-1">
            <Avatar name={user.name} colorKey={user.id} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{user.name}</span>
            {workspace.shared ? null : (
              <IconButton label="People" className="size-7" onClick={() => setMembersOpen(true)}>
                <Users className="size-4" />
              </IconButton>
            )}
            <IconButton label="Sign out" className="size-7" onClick={() => void onSignOut()}>
              <LogOut className="size-4" />
            </IconButton>
          </div>
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="drag flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line-soft px-4">
          <div className="no-drag flex min-w-0 items-center gap-1.5 text-[13px]">
            {selected ? (
              <>
                {crumbs.map((crumb, index) => (
                  <span key={`${crumb}-${index}`} className="flex shrink-0 items-center gap-1.5 text-subtle-foreground">
                    {crumb}
                    <span aria-hidden="true" className="text-subtle-foreground/60">
                      /
                    </span>
                  </span>
                ))}
                <span className="truncate font-semibold">{selected.name}</span>
                {canEdit ? null : (
                  <Badge variant="neutral" className="ml-1">
                    <Eye />
                    View only
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-subtle-foreground">No file open</span>
            )}
          </div>
          <div className="no-drag flex shrink-0 items-center gap-1">
            {others.length ? (
              <span className="mr-2">
                <AvatarStack
                  people={others.map((peer) => ({ id: peer.userId, name: peer.name }))}
                  label={presence(others.map((peer) => peer.name))}
                />
              </span>
            ) : null}
            {selected && canEdit ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="mr-1" onClick={() => setMode(mode === "edit" ? "view" : "edit")}>
                    {mode === "edit" ? <Pencil /> : <Eye />}
                    {mode === "edit" ? "Editing" : "Viewing"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{mode === "edit" ? "Switch to reading view" : "Switch to editing"}</TooltipContent>
              </Tooltip>
            ) : null}
            {selected ? (
              <IconButton
                label={commentsOpen ? "Hide comments" : "Comments"}
                pressed={commentsOpen}
                onClick={() => setCommentsOpen((open) => !open)}
              >
                <MessageSquare className="size-4" />
              </IconButton>
            ) : null}
            {selected ? (
              <IconButton label="History" onClick={() => setHistoryOpen(true)}>
                <History className="size-4" />
              </IconButton>
            ) : null}
            <IconButton
              label={agentOpen ? "Hide agent" : "Agent"}
              pressed={agentOpen}
              className={cn("text-agent-ink", agentOpen && "bg-agent-soft text-agent-ink")}
              onClick={() => setAgentOpen((open) => !open)}
            >
              <Asterisk className="size-4" />
            </IconButton>
            {selected && canEdit ? (
              <Button size="sm" className="ml-1" onClick={() => setSharing(selected)}>
                <UserPlus />
                Share
              </Button>
            ) : null}
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto px-12 py-10">
            {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
            {selected ? (
              <div className="mx-auto h-full w-full max-w-[720px]">
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
                  onSelection={setSelection}
                  onComments={() => setCommentsVersion((version) => version + 1)}
                  onPeers={setPeers}
                />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="font-serif text-xl text-muted-foreground">Select a file, or create one.</p>
                <p className="flex items-center gap-1.5 text-xs text-subtle-foreground">
                  Press <Kbd>⌘K</Kbd> to jump to any file.
                </p>
              </div>
            )}
          </div>
          {selected && commentsOpen ? (
            <CommentsPanel
              key={selected.id}
              api={api}
              workspaceId={workspace.id}
              nodeId={selected.id}
              userId={user.id}
              role={selected.role}
              selection={selection}
              version={commentsVersion}
            />
          ) : null}
        </div>
        <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-line-soft bg-muted/50 px-4 text-[11.5px] text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", syncDot(sync.state))} />
            <span className="truncate">{sync.message}</span>
          </span>
          {selected ? (
            <span className="truncate">{sync.root ? `${shortPath(sync.root)}/${selected.path}` : selected.path}</span>
          ) : null}
        </footer>
      </section>
      {agentOpen ? (
        <div className="absolute top-12 right-0 bottom-0 z-20 shadow-[-12px_0_32px_-24px_rgba(0,0,0,0.35)]">
          <AgentPanel
            syncRoot={sync.root}
            activeDoc={selected ? { path: selected.path, name: selected.name } : null}
            getActiveContext={getActiveContext}
            onClose={() => setAgentOpen(false)}
            onFilesChanged={() => void refresh()}
          />
        </div>
      ) : null}
      <QuickOpen open={quickOpen} onOpenChange={setQuickOpen} nodes={nodes} actions={quickActions} onOpenFile={setSelectedId} />
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
    <ul className="flex flex-col gap-px">
      {children.map((node) => {
        const active = selectedId === node.id
        const markdown = node.kind === "file" && node.name.endsWith(".md")
        return (
          <li key={node.id}>
            <div
              className={cn(
                "group flex h-7 items-center gap-1 rounded-md pr-1",
                active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
              )}
              style={{ paddingLeft: 4 + depth * 14 }}
            >
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                className={cn("flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-1.5 text-left text-[13px]", active && "font-medium")}
                onClick={() => onSelect(node.id)}
              >
                {node.kind === "folder" ? (
                  <Folder className="size-[15px] shrink-0 text-subtle-foreground" />
                ) : (
                  <FileText className="size-[15px] shrink-0 text-subtle-foreground" />
                )}
                <span className="truncate">
                  {markdown ? node.name.replace(/\.md$/, "") : node.name}
                  {markdown ? <span className="font-normal text-subtle-foreground">.md</span> : null}
                </span>
              </button>
              {canEditNode(node) ? (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Actions for ${node.name}`}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground opacity-0 group-hover:opacity-100 hover:bg-background hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
                    >
                      <Ellipsis className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-40">
                    <DropdownMenuItem onSelect={() => onShare(node)}>
                      <UserPlus />
                      Share…
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onRename(node)}>
                      <Pencil />
                      Rename…
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(node)}>
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
        )
      })}
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
  onSelection,
  onComments,
  onPeers,
}: {
  serverUrl: string
  token: string
  workspaceId: string
  node: WorkspaceNode
  userId: string
  viewing: boolean
  onLiveDoc?: (doc: LiveDoc | null) => void
  onSelection?: (selected: string) => void
  onComments?: () => void
  /** Who else has this file open, for the toolbar. */
  onPeers?: (peers: CollabPeer[]) => void
}) {
  const commentsRef = useRef(onComments)
  commentsRef.current = onComments
  const peersRef = useRef(onPeers)
  peersRef.current = onPeers
  const [live, setLive] = useState<LiveDoc | null>(null)
  const [ready, setReady] = useState(false)
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
      onPeers: (next) => peersRef.current?.(next),
      onRevision: () => undefined,
      onError: setError,
      onComments: () => commentsRef.current?.(),
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
      peersRef.current?.([])
    }
  }, [serverUrl, workspaceId, node.id, token])

  const html = DOMPurify.sanitize(marked.parse(preview, { async: false }) as string)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? <p className="mb-4 text-sm">{error}</p> : null}
      {viewing ? (
        <article className="markdown" dangerouslySetInnerHTML={{ __html: html || "<p></p>" }} />
      ) : ready && live ? (
        <MarkdownEditor text={live.text} onSave={() => live.checkpoint()} onSelection={onSelection} />
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
  const [links, setLinks] = useState<ShareLink[]>([])
  const [fresh, setFresh] = useState<ShareLink | null>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<ShareRole>("editor")
  const [error, setError] = useState("")
  const nodeId = node?.id ?? null

  useEffect(() => {
    setShares([])
    setLinks([])
    setFresh(null)
    setError("")
    if (!nodeId) return
    void api
      .links(workspaceId, nodeId)
      .then((result) => setLinks(result.links))
      .catch(() => undefined)
    void api
      .shares(workspaceId, nodeId)
      .then((result) => setShares(result.shares))
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "Could not load who has access."))
  }, [nodeId, api, workspaceId])

  const canGrantEditor = !!node?.role && roleAtLeast(node.role, "editor")

  return (
    <Dialog open={node !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Share “{node?.kind === "folder" ? node.name : node?.name.replace(/\.md$/, "")}”</DialogTitle>
        </DialogHeader>
        <p className="-mt-1 text-sm text-muted-foreground">
          {node?.kind === "folder"
            ? "People you add can open everything in this folder, even if they are not in the workspace."
            : "People you add can open this file, even if they are not in the workspace."}
        </p>
        {shares.length ? (
          <ul className="flex flex-col">
            {shares.map((share) => (
              <li key={share.userId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={share.name} colorKey={share.userId} size="lg" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{share.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{share.email}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <Badge variant="outline">{share.role === "editor" ? "Editor" : "Viewer"}</Badge>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
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
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={role}
              onChange={(event) => setRole(event.target.value as ShareRole)}
            >
              {canGrantEditor ? <option value="editor">Editor</option> : null}
              <option value="viewer">Viewer</option>
            </select>
            <Button type="submit">Share</Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </form>
        <div className="grid gap-3 rounded-lg bg-muted p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-input bg-background text-brand-ink"
            >
              <Globe className="size-4" />
            </span>
            <div className="min-w-0">
              <Label>Share by link</Label>
              <p className="mt-1 text-xs text-muted-foreground">Anyone with an account who opens the link gets access.</p>
            </div>
          </div>
          {fresh?.url ? (
            <div className="flex gap-2">
              <Input readOnly value={fresh.url} onFocus={(event) => event.target.select()} />
              <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(fresh.url ?? "")}>
                <Copy />
                Copy
              </Button>
            </div>
          ) : null}
          {links.length ? (
            <ul className="flex flex-col divide-y divide-line-soft rounded-md border border-line-soft bg-background">
              {links.map((link) => (
                <li key={link.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <LinkIcon className="size-3.5 shrink-0 text-subtle-foreground" />
                    {link.role === "editor" ? "Can edit" : "Can view"}
                    <span className="truncate text-xs text-muted-foreground">by {link.createdByName}</span>
                  </span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground"
                    onClick={async () => {
                      if (!nodeId) return
                      await api.revokeLink(workspaceId, nodeId, link.id)
                      setLinks((current) => current.filter((item) => item.id !== link.id))
                      if (fresh?.id === link.id) setFresh(null)
                    }}
                  >
                    Turn off
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            {(["viewer", "editor"] as const).map((linkRole) =>
              linkRole === "editor" && !canGrantEditor ? null : (
                <Button
                  key={linkRole}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!nodeId) return
                    try {
                      const { link } = await api.createLink(workspaceId, nodeId, linkRole)
                      setFresh(link)
                      setLinks((current) => [link, ...current])
                    } catch (caught) {
                      setError(caught instanceof ApiError ? caught.message : "Could not make a link.")
                    }
                  }}
                >
                  <LinkIcon />
                  {linkRole === "editor" ? "New edit link" : "New view link"}
                </Button>
              ),
            )}
          </div>
        </div>
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
      <DialogContent className="sm:max-w-[420px]">
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
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>The last 10 versions are kept. Restoring adds a new version, so nothing is lost.</DialogDescription>
        </DialogHeader>
        <div className="grid h-[420px] grid-cols-[230px_1fr] gap-4">
          <ul className="flex flex-col gap-0.5 overflow-auto border-r border-line-soft pr-3">
            {revisions.map((revision) => (
              <li key={revision.revision}>
                <button
                  type="button"
                  aria-current={selected === revision.revision ? "true" : undefined}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm",
                    selected === revision.revision
                      ? "bg-brand-tint font-medium ring-1 ring-primary/25"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  onClick={() => {
                    setSelected(revision.revision)
                    void api.revision(workspaceId, nodeId, revision.revision).then((body) => setPreview(body.content))
                  }}
                >
                  <Avatar name={revision.authorName} colorKey={revision.authorId} size="sm" className="mt-0.5" />
                  <span className="min-w-0">
                    {new Date(revision.createdAt).toLocaleString()}
                    <span className="block text-xs font-normal text-muted-foreground">{revision.authorName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <pre className="overflow-auto rounded-lg border border-line-soft bg-muted/40 p-4 font-serif text-sm leading-relaxed whitespace-pre-wrap">
            {preview}
          </pre>
        </div>
        {canEdit && selected ? (
          <DialogFooter>
            <Button
              onClick={async () => {
                await api.restore(workspaceId, nodeId, selected)
                onOpenChange(false)
              }}
            >
              <RotateCcw />
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
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft text-xs">
          {ROLE_HELP.map((item) => (
            <div key={item.role} className="bg-background px-3 py-2">
              <span className="font-medium text-foreground">{item.label}</span>
              <span className="block text-muted-foreground">{item.help}</span>
            </div>
          ))}
        </div>
        <ul className="flex max-h-72 flex-col overflow-auto">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={member.name} colorKey={member.userId} size="lg" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{member.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{member.email}</span>
                </span>
              </span>
              <Badge variant={member.role === "owner" || member.role === "admin" ? "brand" : "outline"}>{roleName(member.role)}</Badge>
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
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                value={nextRole}
                onChange={(event) => setNextRole(event.target.value as Exclude<Role, "owner">)}
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
              <Button type="submit">Add</Button>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function roleLabel(workspace: Workspace) {
  const role = workspace.role.charAt(0).toUpperCase() + workspace.role.slice(1)
  return workspace.shared ? `Shared with you · ${role}` : role
}

function syncTitle(sync: SyncStatus) {
  if (sync.state === "synced") return "Synced"
  if (sync.state === "syncing") return "Syncing…"
  if (sync.state === "error") return "Sync problem"
  return sync.root ? "Waiting to sync" : "Not synced to a folder"
}

function syncDot(state: SyncStatus["state"]) {
  if (state === "synced") return "bg-primary"
  if (state === "syncing") return "animate-pulse bg-insert-line"
  if (state === "error") return "bg-destructive"
  return "bg-input"
}

/** Shows a folder under the home folder as ~/… */
function shortPath(path: string) {
  return path.replace(/^\/Users\/[^/]+/, "~")
}

const ROLE_HELP: Array<{ role: Role; label: string; help: string }> = [
  { role: "owner", label: "Owner", help: "Everything, including deleting the workspace" },
  { role: "admin", label: "Admin", help: "Adds people and changes roles, plus all editor rights" },
  { role: "editor", label: "Editor", help: "Creates, edits, renames and shares files" },
  { role: "viewer", label: "Viewer", help: "Reads files and sees changes live" },
]

function roleName(role: Role) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}
