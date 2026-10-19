import { useEffect, useState } from "react"
import { linkToken, type Workspace } from "@opencharta/shared"
import { ChevronRight, LogOut } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Api, ApiError } from "../lib/api"
import { Logo } from "../components/Logo"

export function WorkspaceScreen({
  serverUrl,
  token,
  onOpen,
  onSignOut,
}: {
  serverUrl: string
  token: string
  onOpen: (workspace: Workspace) => Promise<void>
  onSignOut: () => Promise<void>
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [name, setName] = useState("")
  const [link, setLink] = useState("")
  const [error, setError] = useState("")

  async function load() {
    try {
      const api = new Api(serverUrl, token)
      setWorkspaces((await api.workspaces()).workspaces)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Can't reach the server.")
    }
  }

  useEffect(() => {
    void load()
  }, [serverUrl, token])

  return (
    <div className="flex h-full justify-center overflow-auto px-10 pt-24 pb-10">
      <div className="flex w-full max-w-lg flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={32} />
            <h1 className="text-[26px] font-semibold tracking-tight">Workspaces</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void onSignOut()}>
            <LogOut />
            Sign out
          </Button>
        </div>
        <ul className="flex flex-col overflow-hidden rounded-xl border border-border">
          {workspaces.length === 0 ? (
            <li className="px-4 py-5 text-sm text-muted-foreground">
              No workspaces yet. Start one below, or open a link someone shared with you.
            </li>
          ) : (
            workspaces.map((workspace) => (
              <li key={workspace.id} className="border-b border-line-soft last:border-b-0">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted"
                  onClick={() => void onOpen(workspace)}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-sm font-semibold text-brand-ink"
                  >
                    {workspace.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{workspace.name}</span>
                  <Badge variant={workspace.shared ? "outline" : "brand"}>
                    {workspace.shared ? `Shared with you · ${roleName(workspace.role)}` : roleName(workspace.role)}
                  </Badge>
                  <ChevronRight className="size-4 shrink-0 text-subtle-foreground" />
                </button>
              </li>
            ))
          )}
        </ul>
        <form
          className="grid gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            const api = new Api(serverUrl, token)
            const created = await api.createWorkspace(name)
            setName("")
            await onOpen(created.workspace)
          }}
        >
          <Label htmlFor="new-workspace" className="text-xs text-muted-foreground">
            Start a new workspace
          </Label>
          <div className="flex gap-2">
            <Input id="new-workspace" value={name} onChange={(event) => setName(event.target.value)} placeholder="New workspace" required />
            <Button type="submit">Create</Button>
          </div>
        </form>
        <form
          className="grid gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            setError("")
            const secret = linkToken(link)
            if (!secret) {
              setError("That doesn't look like an OpenCharta link.")
              return
            }
            try {
              const opened = await new Api(serverUrl, token).acceptLink(secret)
              setLink("")
              await onOpen(opened.workspace)
            } catch (caught) {
              setError(caught instanceof ApiError ? caught.message : "Can't reach the server.")
            }
          }}
        >
          <Label htmlFor="share-link" className="text-xs text-muted-foreground">
            Someone shared a link with you?
          </Label>
          <div className="flex gap-2">
            <Input id="share-link" value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste a share link" required />
            <Button type="submit" variant="outline">
              Open a link
            </Button>
          </div>
        </form>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}

function roleName(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}
