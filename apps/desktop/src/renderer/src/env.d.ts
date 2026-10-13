/// <reference types="vite/client" />

import type { DesktopBridge } from "../../shared/bridge"

declare global {
  interface Window {
    opencharta: DesktopBridge
  }
}

export {}
