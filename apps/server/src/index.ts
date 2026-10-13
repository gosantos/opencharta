import { serve } from "@hono/node-server"
import { WebSocketServer } from "ws"
import { createApp } from "./app"
import { openDatabase } from "./db/client"
import { WorkspaceStore } from "./store"

const dataFile = process.env.OPENCHARTA_DATA ?? "./data/opencharta.sqlite"
const port = Number(process.env.PORT ?? 8787)
const hostname = process.env.HOST ?? "0.0.0.0"

const { db } = openDatabase(dataFile)
const store = new WorkspaceStore(db)
store.checkpointDirtyDocuments()
const { app } = createApp(db)
const wss = new WebSocketServer({ noServer: true })

serve({
  fetch: app.fetch,
  port,
  hostname,
  websocket: { server: wss },
})

console.log(`OpenCharta listening on http://${hostname}:${port}`)
