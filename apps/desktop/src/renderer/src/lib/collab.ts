import { wsUrl, type CollabPeer, type CollabServerMessage } from "@opencharta/shared"
import * as Y from "yjs"

export class LiveDoc {
  readonly doc = new Y.Doc()
  readonly text: Y.Text
  private socket: WebSocket | null = null
  private ready = false
  private disposed = false

  constructor(
    serverUrl: string,
    workspaceId: string,
    nodeId: string,
    token: string,
    private readonly handlers: {
      onReady: () => void
      onPeers: (peers: CollabPeer[]) => void
      onRevision: (revision: number) => void
      onError: (message: string) => void
    },
  ) {
    this.text = this.doc.getText("content")
    this.doc.on("update", (update, origin) => {
      if (!this.ready || origin === "remote" || this.socket?.readyState !== WebSocket.OPEN) return
      this.socket.send(JSON.stringify({ type: "update", update: toBase64(update) }))
    })
    this.socket = new WebSocket(wsUrl(serverUrl, workspaceId, nodeId, token))
    this.socket.onmessage = (event) => this.receive(String(event.data))
    this.socket.onerror = () => {
      if (!this.disposed) this.handlers.onError("Live editing disconnected.")
    }
  }

  get isReady() {
    return this.ready
  }

  checkpoint() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "checkpoint" }))
    }
  }

  destroy() {
    this.disposed = true
    this.socket?.close()
    this.doc.destroy()
  }

  private receive(raw: string) {
    if (this.disposed) return
    const message = JSON.parse(raw) as CollabServerMessage
    if (message.type === "sync") {
      Y.applyUpdate(this.doc, fromBase64(message.update), "remote")
      this.ready = true
      this.handlers.onPeers(message.peers)
      this.handlers.onReady()
    } else if (message.type === "update") {
      Y.applyUpdate(this.doc, fromBase64(message.update), "remote")
    } else if (message.type === "presence") {
      this.handlers.onPeers(message.peers)
    } else if (message.type === "checkpoint") {
      this.handlers.onRevision(message.revision)
    } else if (message.type === "error") {
      this.handlers.onError(message.message)
    }
  }
}

function toBase64(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
