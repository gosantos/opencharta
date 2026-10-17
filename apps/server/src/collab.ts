import type { CollabClientMessage, CollabPeer, CollabServerMessage, Role } from "@opencharta/shared"
import { roleAtLeast } from "@opencharta/shared"
import * as Y from "yjs"
import { sha256 } from "./lib/crypto"
import { readMarkdownState } from "./lib/yjs"
import type { WorkspaceStore } from "./store"

type Send = (message: CollabServerMessage) => void

type Conn = {
  id: string
  nodeId: string
  userId: string
  name: string
  role: Role
  send: Send
}

type Room = {
  nodeId: string
  doc: Y.Doc
  conns: Map<string, Conn>
  persistTimer?: ReturnType<typeof setTimeout>
  checkpointTimer?: ReturnType<typeof setTimeout>
  lastAuthorId: string
}

export class CollabHub {
  private readonly rooms = new Map<string, Room>()
  private readonly conns = new Map<string, Conn>()

  constructor(
    private readonly store: WorkspaceStore,
    private readonly options: { persistMs?: number; idleMs?: number } = {},
  ) {}

  join(input: { nodeId: string; userId: string; name: string; role: Role; yjsState: Buffer | null; content: string; send: Send }) {
    const conn: Conn = {
      id: crypto.randomUUID(),
      nodeId: input.nodeId,
      userId: input.userId,
      name: input.name,
      role: input.role,
      send: input.send,
    }
    const room = this.room(input.nodeId, input.yjsState, input.content, input.userId)
    room.conns.set(conn.id, conn)
    this.conns.set(conn.id, conn)
    conn.send({
      type: "sync",
      update: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64"),
      revision: 0,
      peers: this.peers(room),
    })
    this.broadcast(room, { type: "presence", peers: this.peers(room) }, conn.id)
    return conn.id
  }

  message(connId: string, raw: string) {
    const conn = this.conns.get(connId)
    if (!conn) return
    let parsed: CollabClientMessage
    try {
      parsed = JSON.parse(raw) as CollabClientMessage
    } catch {
      conn.send({ type: "error", message: "Unreadable edit." })
      return
    }
    const room = this.rooms.get(conn.nodeId)
    if (!room) return
    if (parsed.type === "checkpoint") {
      const revision = this.checkpoint(room, conn.userId)
      conn.send({ type: "checkpoint", revision })
      return
    }
    if (parsed.type !== "update") return
    if (!roleAtLeast(conn.role, "editor")) {
      conn.send({ type: "error", message: "You can read this file, not edit it." })
      return
    }
    const update = Buffer.from(parsed.update, "base64")
    Y.applyUpdate(room.doc, update, conn.id)
    room.lastAuthorId = conn.userId
    this.schedule(room)
  }

  leave(connId: string) {
    const conn = this.conns.get(connId)
    if (!conn) return
    this.conns.delete(connId)
    const room = this.rooms.get(conn.nodeId)
    if (!room) return
    room.conns.delete(conn.id)
    if (room.conns.size === 0) {
      this.checkpoint(room, conn.userId)
      this.clear(room)
      room.doc.destroy()
      this.rooms.delete(room.nodeId)
      return
    }
    this.broadcast(room, { type: "presence", peers: this.peers(room) })
  }

  /** Tells everyone with the file open that its comments changed. */
  notifyComments(nodeId: string) {
    const room = this.rooms.get(nodeId)
    if (room) this.broadcast(room, { type: "comments" })
  }

  /** Saves every open document as a version and forgets all connections. Used on shutdown. */
  closeAll() {
    for (const room of this.rooms.values()) {
      this.checkpoint(room, room.lastAuthorId)
      room.doc.destroy()
    }
    this.rooms.clear()
    this.conns.clear()
  }

  isActive(nodeId: string) {
    return (this.rooms.get(nodeId)?.conns.size ?? 0) > 0
  }

  private room(nodeId: string, yjsState: Buffer | null, content: string, authorId: string) {
    const existing = this.rooms.get(nodeId)
    if (existing) return existing
    const doc = new Y.Doc()
    if (yjsState?.length) Y.applyUpdate(doc, yjsState)
    else if (content) doc.getText("content").insert(0, content)
    doc.on("update", (update, origin) => {
      const room = this.rooms.get(nodeId)
      if (!room) return
      const encoded = Buffer.from(update).toString("base64")
      for (const conn of room.conns.values()) {
        if (conn.id === origin) continue
        conn.send({ type: "update", update: encoded })
      }
    })
    const room: Room = { nodeId, doc, conns: new Map(), lastAuthorId: authorId }
    this.rooms.set(nodeId, room)
    return room
  }

  private schedule(room: Room) {
    const persistMs = this.options.persistMs ?? 1000
    const idleMs = this.options.idleMs ?? 60_000
    if (room.persistTimer) clearTimeout(room.persistTimer)
    if (room.checkpointTimer) clearTimeout(room.checkpointTimer)
    const persist = () => this.persist(room)
    const checkpoint = () => this.checkpoint(room, room.lastAuthorId)
    if (persistMs === 0) persist()
    else room.persistTimer = setTimeout(persist, persistMs)
    if (idleMs > 0) room.checkpointTimer = setTimeout(checkpoint, idleMs)
  }

  private persist(room: Room) {
    const content = room.doc.getText("content").toString()
    this.store.saveLive(room.nodeId, content, Buffer.from(Y.encodeStateAsUpdate(room.doc)))
  }

  private checkpoint(room: Room, authorId: string) {
    this.clear(room)
    const content = room.doc.getText("content").toString()
    const state = Buffer.from(Y.encodeStateAsUpdate(room.doc))
    return this.store.checkpointLive(room.nodeId, authorId, content, state)
  }

  private clear(room: Room) {
    if (room.persistTimer) clearTimeout(room.persistTimer)
    if (room.checkpointTimer) clearTimeout(room.checkpointTimer)
    room.persistTimer = undefined
    room.checkpointTimer = undefined
  }

  private peers(room: Room): CollabPeer[] {
    const seen = new Set<string>()
    const peers: CollabPeer[] = []
    for (const conn of room.conns.values()) {
      if (seen.has(conn.userId)) continue
      seen.add(conn.userId)
      peers.push({ userId: conn.userId, name: conn.name })
    }
    return peers
  }

  private broadcast(room: Room, message: CollabServerMessage, except?: string) {
    for (const conn of room.conns.values()) {
      if (conn.id === except) continue
      conn.send(message)
    }
  }
}

export function liveHash(state: Buffer | null, fallback: string) {
  return sha256(readMarkdownState(state, fallback))
}
