import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { DesktopState } from "../shared/bridge"

export const defaultState = (): DesktopState => ({
  serverUrl: "http://127.0.0.1:8787",
  token: null,
  workspaceId: null,
  syncRoot: null,
})

export function loadState(path: string): DesktopState {
  try {
    return { ...defaultState(), ...JSON.parse(readFileSync(path, "utf8")) }
  } catch {
    return defaultState()
  }
}

export function saveState(path: string, state: DesktopState) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2))
}
