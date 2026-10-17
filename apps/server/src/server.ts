import { serve } from "@hono/node-server"
import type { AddressInfo } from "node:net"
import { WebSocketServer } from "ws"
import { createApp } from "./app"
import { CollabHub } from "./collab"
import { openDatabase } from "./db/client"
import { WorkspaceStore } from "./store"

export type ServerOptions = {
  dataFile: string
  port: number
  hostname: string
  collab?: { persistMs?: number; idleMs?: number }
}

/** Opens the database, recovers unsaved live edits, and starts listening. */
export async function startServer(options: ServerOptions) {
  const { sqlite, db } = openDatabase(options.dataFile)
  const store = new WorkspaceStore(db)
  store.checkpointDirtyDocuments()
  const collab = new CollabHub(store, options.collab)
  const { app } = createApp(db, collab)
  const wss = new WebSocketServer({ noServer: true })

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const started = serve(
      { fetch: app.fetch, port: options.port, hostname: options.hostname, websocket: { server: wss } },
      () => resolve(started),
    )
  })
  const address = server.address() as AddressInfo
  const url = `http://${options.hostname === "0.0.0.0" ? "127.0.0.1" : options.hostname}:${address.port}`

  return {
    url,
    port: address.port,
    async close() {
      collab.closeAll()
      for (const client of wss.clients) client.terminate()
      wss.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      sqlite.close()
    },
  }
}
