import { useEffect, useState } from "react"
import type { DesktopState, SyncStatus } from "../../shared/bridge"
import type { User, Workspace } from "@opencharta/shared"
import { Api } from "./lib/api"
import { AuthScreen } from "./screens/AuthScreen"
import { EditorScreen } from "./screens/EditorScreen"
import { WorkspaceScreen } from "./screens/WorkspaceScreen"

export function App() {
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<DesktopState | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [sync, setSync] = useState<SyncStatus>({ state: "idle", message: "Not synced to a folder", root: null })

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
    <main className="drag h-full bg-white text-black">
      <div className="no-drag h-full pl-24">{children}</div>
    </main>
  )
}
