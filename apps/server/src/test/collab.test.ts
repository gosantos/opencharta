import assert from "node:assert/strict"
import test from "node:test"
import * as Y from "yjs"
import type { CollabServerMessage } from "@opencharta/shared"
import { createApp } from "../app"
import { CollabHub } from "../collab"
import { openDatabase } from "../db/client"

test("two editors converge, and closing the file stores a version", async () => {
  const { sqlite, db } = openDatabase(":memory:")
  const { app, store } = createApp(db)
  const hub = new CollabHub(store, { persistMs: 0, idleMs: 0 })
  try {
    const registered = await app.request("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "ana@example.com", name: "Ana", password: "password123" }),
    })
    const { token, user } = (await registered.json()) as { token: string; user: { id: string } }
    const workspace = await app.request("/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: "Notes" }),
    })
    const { workspace: ws } = (await workspace.json()) as { workspace: { id: string } }
    const created = await app.request(`/workspaces/${ws.id}/nodes`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ parentId: null, kind: "file", name: "live.md", content: "" }),
    })
    const { node } = (await created.json()) as { node: { id: string } }
    const opened = store.collabNode(user.id, ws.id, node.id)

    const firstInbox: CollabServerMessage[] = []
    const secondInbox: CollabServerMessage[] = []
    const first = hub.join({
      nodeId: node.id,
      userId: user.id,
      name: "Ana",
      role: "owner",
      yjsState: opened.node.yjsState,
      content: opened.node.content,
      send: (message) => firstInbox.push(message),
    })
    const second = hub.join({
      nodeId: node.id,
      userId: user.id,
      name: "Ana",
      role: "owner",
      yjsState: opened.node.yjsState,
      content: opened.node.content,
      send: (message) => secondInbox.push(message),
    })

    const sync = firstInbox.find((message) => message.type === "sync")
    assert.ok(sync && sync.type === "sync")
    const local = new Y.Doc()
    Y.applyUpdate(local, Buffer.from(sync.update, "base64"))
    let update: Uint8Array | null = null
    local.on("update", (next, origin) => {
      if (origin === "local") update = next
    })
    local.transact(() => local.getText("content").insert(0, "Hello"), "local")
    assert.ok(update)
    hub.message(first, JSON.stringify({ type: "update", update: Buffer.from(update).toString("base64") }))

    const forwarded = secondInbox.find((message) => message.type === "update")
    assert.ok(forwarded && forwarded.type === "update")
    const other = new Y.Doc()
    const secondSync = secondInbox.find((message) => message.type === "sync")
    assert.ok(secondSync && secondSync.type === "sync")
    Y.applyUpdate(other, Buffer.from(secondSync.update, "base64"))
    Y.applyUpdate(other, Buffer.from(forwarded.update, "base64"))
    assert.equal(other.getText("content").toString(), "Hello")

    hub.leave(first)
    assert.equal(store.getContent(user.id, ws.id, node.id).content, "")
    hub.leave(second)
    const saved = store.getContent(user.id, ws.id, node.id)
    assert.equal(saved.content, "Hello")
    assert.equal(saved.revision, 2)
  } finally {
    sqlite.close()
  }
})
