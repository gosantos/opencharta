import { contextBridge, ipcRenderer } from "electron"
import type { DesktopBridge, DesktopState, SyncStatus } from "../shared/bridge"

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
}

contextBridge.exposeInMainWorld("opencharta", bridge)

export type { DesktopState }
