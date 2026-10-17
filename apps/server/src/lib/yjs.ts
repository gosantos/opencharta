import * as Y from "yjs"

export function freshMarkdownState(content: string) {
  const doc = new Y.Doc()
  if (content) doc.getText("content").insert(0, content)
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}

/** Replaces the first occurrence of `quote`. Returns false when the quote is no longer in the text. */
export function replaceQuote(text: Y.Text, quote: string, replacement: string) {
  const index = quote ? text.toString().indexOf(quote) : -1
  if (index < 0) return false
  text.doc?.transact(() => {
    text.delete(index, quote.length)
    if (replacement) text.insert(index, replacement)
  })
  return true
}

export function readMarkdownState(state: Buffer | null | undefined, fallback = "") {
  if (!state?.length) return fallback
  const doc = new Y.Doc()
  Y.applyUpdate(doc, state)
  return doc.getText("content").toString()
}
