import { useEffect, useState } from "react"
import { linkToken, type Workspace } from "@opencharta/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Api, ApiError } from "../lib/api"

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
    <div className="flex h-full max-w-lg flex-col justify-center gap-8 pr-12">
      <div className="flex items-end justify-between">
        <h1 className="text-3xl font-medium tracking-tight">Workspaces</h1>
        <button type="button" className="text-sm text-muted-foreground" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </div>
      <ul className="divide-y divide-border border-y border-border">
        {workspaces.length === 0 ? (
          <li className="py-4 text-sm text-muted-foreground">No workspaces yet.</li>
        ) : (
          workspaces.map((workspace) => (
            <li key={workspace.id}>
              <button
                type="button"
                className="flex w-full items-baseline justify-between py-3 text-left hover:bg-muted"
                onClick={() => void onOpen(workspace)}
              >
                <span>{workspace.name}</span>
                <span className="text-sm text-muted-foreground">
                  {workspace.shared ? `shared with you · ${workspace.role}` : workspace.role}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          const api = new Api(serverUrl, token)
          const created = await api.createWorkspace(name)
          setName("")
          await onOpen(created.workspace)
        }}
      >
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="New workspace" required />
        <Button type="submit">Create</Button>
      </form>
      <form
        className="flex gap-2"
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
        <Input value={link} onChange={(event) => setLink(event.target.value)} placeholder="Paste a share link" required />
        <Button type="submit" variant="outline">
          Open a link
        </Button>
      </form>
      {error ? <p className="text-sm">{error}</p> : null}
    </div>
  )
}
