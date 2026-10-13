import { watch } from "node:fs"
import { join } from "node:path"
import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron"
import type { DesktopState, SyncStatus } from "../shared/bridge"
import { loadState, saveState } from "./state"
import { syncFolder } from "./sync"

if (!app.isPackaged && process.env.OPENCHARTA_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.OPENCHARTA_DEBUG_PORT)
}

let window: BrowserWindow | null = null
let state: DesktopState
let watcher: ReturnType<typeof watch> | null = null
let syncing = false
let dirtyDuringSync = false
let poll: NodeJS.Timeout | null = null

const stateFile = () => join(app.getPath("userData"), "session.json")

function emit(status: SyncStatus) {
  window?.webContents.send("sync:status", status)
}

async function syncNow(): Promise<SyncStatus> {
  if (!state.token || !state.workspaceId || !state.syncRoot) {
    const status: SyncStatus = { state: "idle", message: "Not synced to a folder", root: state.syncRoot }
    emit(status)
    return status
  }
  if (syncing) {
    dirtyDuringSync = true
    return { state: "syncing", message: "Syncing", root: state.syncRoot }
  }
  syncing = true
  emit({ state: "syncing", message: "Syncing", root: state.syncRoot })
  try {
    const result = await syncFolder({
      root: state.syncRoot,
      serverUrl: state.serverUrl,
      token: state.token,
      workspaceId: state.workspaceId,
    })
    const status: SyncStatus = {
      state: "synced",
      message: result.message,
      root: state.syncRoot,
    }
    emit(status)
    return status
  } catch (error) {
    const status: SyncStatus = {
      state: "error",
      message: error instanceof Error ? error.message : "Sync failed.",
      root: state.syncRoot,
    }
    emit(status)
    return status
  } finally {
    syncing = false
    if (dirtyDuringSync) {
      dirtyDuringSync = false
      setTimeout(() => void syncNow(), 400)
    }
  }
}

function watchFolder(root: string | null) {
  watcher?.close()
  watcher = null
  if (!root) return
  try {
    watcher = watch(root, { recursive: true }, () => {
      if (syncing) dirtyDuringSync = true
      else setTimeout(() => void syncNow(), 400)
    })
  } catch {
    // The folder may have been removed. The next sync reports it.
  }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    title: "OpenCharta",
    backgroundColor: "#ffffff",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (!app.isPackaged) {
    window.webContents.on("console-message", (...args: unknown[]) => {
      const detail = args.find((arg) => typeof arg === "object" && arg !== null) as
        | { message?: string; lineNumber?: number; sourceId?: string }
        | undefined
      const message =
        detail?.message ?? args.find((arg) => typeof arg === "string" && arg.length > 0) ?? ""
      console.log(`[renderer] ${String(message)}`)
    })
    window.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[renderer] process gone: ${details.reason} (${details.exitCode})`)
    })
    window.webContents.on("did-fail-load", (_event, code, description, url) => {
      console.error(`[renderer] failed to load ${url}: ${description} (${code})`)
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, "../renderer/index.html"))
}

app.setName("OpenCharta")
app.whenReady().then(() => {
  state = loadState(stateFile())
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "fileMenu" },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  )
  ipcMain.handle("state:get", () => state)
  ipcMain.handle("session:set", (_event, patch: Partial<DesktopState>) => {
    state = { ...state, ...patch }
    saveState(stateFile(), state)
    watchFolder(state.syncRoot)
    void syncNow()
    return state
  })
  ipcMain.handle("folder:pick", async () => {
    const result = await dialog.showOpenDialog(window!, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose a folder to sync",
    })
    if (result.canceled || !result.filePaths[0]) return null
    state = { ...state, syncRoot: result.filePaths[0] }
    saveState(stateFile(), state)
    watchFolder(state.syncRoot)
    void syncNow()
    return state.syncRoot
  })
  ipcMain.handle("folder:clear", () => {
    state = { ...state, syncRoot: null }
    saveState(stateFile(), state)
    watchFolder(null)
    return state
  })
  ipcMain.handle("sync:now", () => syncNow())
  ipcMain.handle("window:title", (_event, title: string) => {
    window?.setTitle(title || "OpenCharta")
  })

  createWindow()
  watchFolder(state.syncRoot)
  poll = setInterval(() => void syncNow(), 5000)
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (poll) clearInterval(poll)
  if (process.platform !== "darwin") app.quit()
})
