import { createHash } from "node:crypto"
import { readFileSync, rmSync, watch, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron"
import type { AgentPermissionDecision, AgentSettings, AgentState, DocExternalChange } from "@opencharta/shared"
import type { AgentContextFile, DesktopState, SyncStatus } from "../shared/bridge"
import { AgentManager, type AgentSessionRef } from "./agent"
import { loadState, saveState } from "./state"
import { syncFolder } from "./sync"

// Lets tests run the app with a clean, throwaway profile.
if (process.env.OPENCHARTA_USER_DATA) app.setPath("userData", process.env.OPENCHARTA_USER_DATA)

if (!app.isPackaged && process.env.OPENCHARTA_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.OPENCHARTA_DEBUG_PORT)
}

let window: BrowserWindow | null = null
let state: DesktopState
let agent: AgentManager | null = null
let watcher: ReturnType<typeof watch> | null = null
let syncing = false
let dirtyDuringSync = false
let poll: NodeJS.Timeout | null = null
let openDoc: { nodeId: string; path: string } | null = null
let liveBaseline = ""
let liveSent = ""

const stateFile = () => join(app.getPath("userData"), "session.json")

const agentSessionFile = () => join(app.getPath("userData"), "agent-session.json")

const agentSessionStore = {
  load: (): AgentSessionRef | null => {
    try {
      const parsed = JSON.parse(readFileSync(agentSessionFile(), "utf8")) as AgentSessionRef
      if (parsed && typeof parsed.id === "string" && typeof parsed.directory === "string") return parsed
      return null
    } catch {
      return null
    }
  },
  save: (ref: AgentSessionRef | null) => {
    try {
      if (!ref) rmSync(agentSessionFile(), { force: true })
      else writeFileSync(agentSessionFile(), JSON.stringify(ref))
    } catch {
      // Remembering the conversation is best effort.
    }
  },
}

function send(channel: string, payload: unknown) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  try {
    window.webContents.send(channel, payload)
  } catch {
    // The window can be mid-teardown; dropping the update is fine.
  }
}

function emit(status: SyncStatus) {
  send("sync:status", status)
}

function emitAgent(next: AgentState) {
  send("agent:state", next)
}

function hash(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

/**
 * When the agent (or anyone else) rewrites the file that is open in the editor,
 * hand the new bytes to the editor so it can apply them as a live edit. Only
 * files that changed after the document was opened are announced, so a stale
 * copy on disk can never overwrite what the server has.
 */
function announceLive() {
  const doc = openDoc
  if (!doc || !state.syncRoot) return
  let content: string
  try {
    content = readFileSync(join(state.syncRoot, doc.path), "utf8")
  } catch {
    return
  }
  const digest = hash(content)
  if (digest === liveBaseline || digest === liveSent) return
  liveSent = digest
  const change: DocExternalChange = { nodeId: doc.nodeId, path: doc.path, content }
  send("doc:external", change)
}

/**
 * The agent works on real files and its tools read the folder. Before it runs,
 * make the open document's file match the editor buffer, so "this file" means
 * what the user sees rather than the last synced copy. The open node is kept
 * out of the folder sync, so this write is not treated as a change to push.
 */
function flushActiveDocument(active: AgentContextFile | null) {
  if (!active || !state.syncRoot) return
  try {
    writeFileSync(join(state.syncRoot, active.path), active.content)
    const digest = hash(active.content)
    liveBaseline = digest
    liveSent = digest
  } catch {
    // If the file cannot be written, the attached content still carries it.
  }
}

async function syncNow(): Promise<SyncStatus> {
  if (!state.token || !state.workspaceId || !state.syncRoot) {
    const status: SyncStatus = {
      state: "idle",
      message: "Not synced to a folder",
      root: state.syncRoot,
      changed: false,
    }
    emit(status)
    return status
  }
  if (syncing) {
    dirtyDuringSync = true
    return { state: "syncing", message: "Syncing", root: state.syncRoot, changed: false }
  }
  syncing = true
  emit({ state: "syncing", message: "Syncing", root: state.syncRoot, changed: false })
  try {
    announceLive()
    const result = await syncFolder({
      root: state.syncRoot,
      serverUrl: state.serverUrl,
      token: state.token,
      workspaceId: state.workspaceId,
      live: openDoc,
    })
    const status: SyncStatus = {
      state: "synced",
      message: result.message,
      root: state.syncRoot,
      changed: result.changed,
    }
    emit(status)
    return status
  } catch (error) {
    const status: SyncStatus = {
      state: "error",
      message: error instanceof Error ? error.message : "Sync failed.",
      root: state.syncRoot,
      changed: false,
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
      announceLive()
      if (syncing) dirtyDuringSync = true
      else setTimeout(() => void syncNow(), 400)
    })
  } catch {
    // The folder may have been removed. The next sync reports it.
  }
}

function applyAgentState() {
  agent!.setDirectory(state.syncRoot)
  if (state.syncRoot && agent!.state().status.state === "idle") void agent!.connect()
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
  agent = new AgentManager(state.agent, emitAgent, agentSessionStore)
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
    applyAgentState()
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
    applyAgentState()
    void syncNow()
    return state.syncRoot
  })
  ipcMain.handle("folder:clear", () => {
    state = { ...state, syncRoot: null }
    saveState(stateFile(), state)
    watchFolder(null)
    applyAgentState()
    return state
  })
  ipcMain.handle("sync:now", () => syncNow())
  ipcMain.handle("window:title", (_event, title: string) => {
    if (window && !window.isDestroyed()) window.setTitle(title || "OpenCharta")
  })

  ipcMain.handle("doc:open", (_event, node: { nodeId: string; path: string } | null) => {
    openDoc = node
    liveSent = ""
    liveBaseline = ""
    if (node && state.syncRoot) {
      try {
        liveBaseline = hash(readFileSync(join(state.syncRoot, node.path), "utf8"))
      } catch {
        liveBaseline = ""
      }
    }
    announceLive()
  })

  ipcMain.handle("agent:state", () => agent!.state())
  ipcMain.handle("agent:connect", () => agent!.connect())
  ipcMain.handle("agent:disconnect", () => agent!.disconnect())
  ipcMain.handle("agent:settings", (_event, patch: Partial<AgentSettings>) => {
    state = { ...state, agent: { ...state.agent, ...patch } }
    saveState(stateFile(), state)
    return agent!.setSettings(patch)
  })
  ipcMain.handle("agent:send", async (_event, text: string, active: AgentContextFile | null) => {
    flushActiveDocument(active)
    return agent!.send(text, active ?? undefined)
  })
  ipcMain.handle("agent:interrupt", () => agent!.interrupt())
  ipcMain.handle("agent:new", () => agent!.newSession())
  ipcMain.handle("agent:permission", (_event, id: string, decision: AgentPermissionDecision) =>
    agent!.replyPermission(id, decision),
  )

  createWindow()
  watchFolder(state.syncRoot)
  applyAgentState()
  poll = setInterval(() => void syncNow(), 5000)
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (poll) clearInterval(poll)
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  void agent?.shutdown()
})
