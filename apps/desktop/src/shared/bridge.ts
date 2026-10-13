import type {
  AgentPermissionDecision,
  AgentSettings,
  AgentState,
  DocExternalChange,
} from "@opencharta/shared"

export type DesktopState = {
  serverUrl: string
  token: string | null
  workspaceId: string | null
  syncRoot: string | null
  agent: AgentSettings
}

export type SyncStatus = {
  state: "idle" | "syncing" | "synced" | "error"
  message: string
  root: string | null
  changed: boolean
}

/** The document a message is sent about, so the agent sees what the user is looking at. */
export type AgentContextFile = {
  path: string
  name: string
  content: string
}

export type DesktopBridge = {
  getState: () => Promise<DesktopState>
  setSession: (patch: Partial<DesktopState>) => Promise<DesktopState>
  pickFolder: () => Promise<string | null>
  clearFolder: () => Promise<DesktopState>
  syncNow: () => Promise<SyncStatus>
  setTitle: (title: string) => Promise<void>
  onSync: (callback: (status: SyncStatus) => void) => () => void
  agentState: () => Promise<AgentState>
  agentConnect: () => Promise<AgentState>
  agentDisconnect: () => Promise<AgentState>
  agentSetSettings: (patch: Partial<AgentSettings>) => Promise<AgentState>
  agentSend: (text: string, active?: AgentContextFile | null) => Promise<AgentState>
  agentInterrupt: () => Promise<AgentState>
  agentNewSession: () => Promise<AgentState>
  agentReplyPermission: (id: string, decision: AgentPermissionDecision) => Promise<AgentState>
  onAgentState: (callback: (state: AgentState) => void) => () => void
  docSetOpen: (node: { nodeId: string; path: string } | null) => Promise<void>
  onDocExternal: (callback: (change: DocExternalChange) => void) => () => void
}
