import { Component, useEffect, useState, type ReactNode } from "react"
import type { DesktopState, SyncStatus } from "../../shared/bridge"
import type { User, Workspace } from "@opencharta/shared"
import { Api } from "./lib/api"
import { AuthScreen } from "./screens/AuthScreen"
import { EditorScreen } from "./screens/EditorScreen"
import { WorkspaceScreen } from "./screens/WorkspaceScreen"

export function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}

function AppInner() {
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<DesktopState | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [sync, setSync] = useState<SyncStatus>({ state: "idle", message: "Not synced to a folder", root: null, changed: false })

  useEffect(() => {
    const stop = window.opencharta.onSync(setSync)
    void window.opencharta.getState().then(async (next) => {
      setState(next)
      if (next.token) {
        try {
          const api = new Api(next.serverUrl, next.token)
          const me = await api.me()
          setUser(me.user)
          if (next.workspaceId) {
            const listed = await api.workspaces()
            setWorkspace(listed.workspaces.find((item) => item.id === next.workspaceId) ?? null)
          }
        } catch {
          const cleared = await window.opencharta.setSession({ token: null, workspaceId: null })
          setState(cleared)
        }
      }
      setReady(true)
    })
    return stop
  }, [])

  if (!ready || !state) {
    return <Shell />
  }

  if (!state.token || !user) {
    return (
      <Shell>
        <AuthScreen
          serverUrl={state.serverUrl}
          onSignedIn={async (next) => {
            const saved = await window.opencharta.setSession({
              serverUrl: next.serverUrl,
              token: next.token,
              workspaceId: null,
            })
            setState(saved)
            setUser(next.user)
            setWorkspace(null)
          }}
        />
      </Shell>
    )
  }

  if (!workspace) {
    return (
      <Shell>
        <WorkspaceScreen
          serverUrl={state.serverUrl}
          token={state.token}
          onOpen={async (next) => {
            const saved = await window.opencharta.setSession({ workspaceId: next.id })
            setState(saved)
            setWorkspace(next)
          }}
          onSignOut={async () => {
            const saved = await window.opencharta.setSession({ token: null, workspaceId: null })
            setState(saved)
            setUser(null)
          }}
        />
      </Shell>
    )
  }

  return (
    <EditorScreen
      serverUrl={state.serverUrl}
      token={state.token}
      user={user}
      workspace={workspace}
      sync={sync}
      onSyncNow={() => void window.opencharta.syncNow()}
      onPickFolder={() => void window.opencharta.pickFolder()}
      onBack={async () => {
        const saved = await window.opencharta.setSession({ workspaceId: null })
        setState(saved)
        setWorkspace(null)
        void window.opencharta.setTitle("OpenCharta")
      }}
      onSignOut={async () => {
        const saved = await window.opencharta.setSession({ token: null, workspaceId: null })
        setState(saved)
        setUser(null)
        setWorkspace(null)
      }}
    />
  )
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <main className="relative h-full bg-background text-foreground">
      <div aria-hidden="true" className="drag absolute inset-x-0 top-0 z-10 h-12" />
      <div className="h-full">{children}</div>
    </main>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state: { message: string | null } = { message: null }

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : "Something went wrong." }
  }

  render() {
    if (this.state.message) {
      return (
        <main className="grid h-full place-items-center bg-background text-foreground">
          <div className="max-w-sm text-center">
            <p className="font-serif text-xl">This view hit a problem.</p>
            <p className="mt-2 text-sm text-muted-foreground">{this.state.message}</p>
            <button
              type="button"
              className="mt-4 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
              onClick={() => this.setState({ message: null })}
            >
              Try again
            </button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}
