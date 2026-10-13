import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { DEFAULT_AGENT_SETTINGS } from "@opencharta/shared"
import type { DesktopState } from "../shared/bridge"

export const defaultState = (): DesktopState => ({
  serverUrl: "http://127.0.0.1:8787",
  token: null,
  workspaceId: null,
  syncRoot: null,
  agent: { ...DEFAULT_AGENT_SETTINGS },
})

export function loadState(path: string): DesktopState {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DesktopState>
    return {
      ...defaultState(),
      ...parsed,
      agent: { ...DEFAULT_AGENT_SETTINGS, ...parsed.agent },
    }
  } catch {
    return defaultState()
  }
}

export function saveState(path: string, state: DesktopState) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2))
}
