export type DesktopState = {
  serverUrl: string
  token: string | null
  workspaceId: string | null
  syncRoot: string | null
}

export type SyncStatus = {
  state: "idle" | "syncing" | "synced" | "error"
  message: string
  root: string | null
}

export type DesktopBridge = {
  getState: () => Promise<DesktopState>
  setSession: (patch: Partial<DesktopState>) => Promise<DesktopState>
  pickFolder: () => Promise<string | null>
  clearFolder: () => Promise<DesktopState>
  syncNow: () => Promise<SyncStatus>
  setTitle: (title: string) => Promise<void>
  onSync: (callback: (status: SyncStatus) => void) => () => void
}
