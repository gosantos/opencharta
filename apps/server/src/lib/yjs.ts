import * as Y from "yjs"

export function freshMarkdownState(content: string) {
  const doc = new Y.Doc()
  if (content) doc.getText("content").insert(0, content)
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}

export function readMarkdownState(state: Buffer | null | undefined, fallback = "") {
  if (!state?.length) return fallback
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  return doc.getText("content").toString()
}
