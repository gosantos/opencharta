import { contextBridge, ipcRenderer } from "electron"
import type { AgentPermissionDecision, AgentSettings, AgentState, DocExternalChange } from "@opencharta/shared"
import type { AgentContextFile, DesktopBridge, DesktopState, SyncStatus } from "../shared/bridge"

const bridge: DesktopBridge = {
  getState: () => ipcRenderer.invoke("state:get"),
  setSession: (patch) => ipcRenderer.invoke("session:set", patch),
  pickFolder: () => ipcRenderer.invoke("folder:pick"),
  clearFolder: () => ipcRenderer.invoke("folder:clear"),
  syncNow: () => ipcRenderer.invoke("sync:now"),
  setTitle: (title) => ipcRenderer.invoke("window:title", title),
  onSync: (callback) => {
    const listener = (_event: unknown, status: SyncStatus) => callback(status)
    ipcRenderer.on("sync:status", listener)
    return () => ipcRenderer.removeListener("sync:status", listener)
  },
  agentState: () => ipcRenderer.invoke("agent:state"),
  agentConnect: () => ipcRenderer.invoke("agent:connect"),
  agentDisconnect: () => ipcRenderer.invoke("agent:disconnect"),
  agentSetSettings: (patch: Partial<AgentSettings>) => ipcRenderer.invoke("agent:settings", patch),
  agentSend: (text: string, active?: AgentContextFile | null) =>
    ipcRenderer.invoke("agent:send", text, active ?? null),
  agentInterrupt: () => ipcRenderer.invoke("agent:interrupt"),
  agentNewSession: () => ipcRenderer.invoke("agent:new"),
  agentReplyPermission: (id: string, decision: AgentPermissionDecision) =>
    ipcRenderer.invoke("agent:permission", id, decision),
  onAgentState: (callback) => {
    const listener = (_event: unknown, state: AgentState) => callback(state)
    ipcRenderer.on("agent:state", listener)
    return () => ipcRenderer.removeListener("agent:state", listener)
  },
  docSetOpen: (node: { nodeId: string; path: string } | null) => ipcRenderer.invoke("doc:open", node),
  onDocExternal: (callback) => {
    const listener = (_event: unknown, change: DocExternalChange) => callback(change)
    ipcRenderer.on("doc:external", listener)
    return () => ipcRenderer.removeListener("doc:external", listener)
  },
}

contextBridge.exposeInMainWorld("opencharta", bridge)

export type { DesktopState }
