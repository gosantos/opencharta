import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { markdown } from "@codemirror/lang-markdown"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { useEffect, useRef } from "react"
import type * as Y from "yjs"

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#ffffff", color: "#111111" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#e8e8e8" },
  "&.cm-focused": { outline: "none" },
})

export function MarkdownEditor({
  text,
  onSave,
  onSelection,
}: {
  text: Y.Text
  onSave: () => void
  /** The selected text, or "" when nothing is selected. */
  onSelection?: (selected: string) => void
}) {
  const selectionRef = useRef(onSelection)
  selectionRef.current = onSelection
  const host = useRef<HTMLDivElement>(null)
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    let applying = false
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            {
              key: "Mod-s",
              run: () => {
                saveRef.current()
                return true
              },
            },
          ]),
          markdown(),
          EditorView.lineWrapping,
          theme,
          EditorView.updateListener.of((update) => {
            if (update.selectionSet) {
              const range = update.state.selection.main
              selectionRef.current?.(update.state.sliceDoc(range.from, range.to))
            }
            if (!update.docChanged || applying) return
            const edits: Array<{ from: number; to: number; insert: string }> = []
            update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              edits.push({ from: fromA, to: toA, insert: inserted.toString() })
            })
            text.doc?.transact(() => {
              for (let i = edits.length - 1; i >= 0; i -= 1) {
                const edit = edits[i]
                if (!edit) continue
                if (edit.to > edit.from) text.delete(edit.from, edit.to - edit.from)
                if (edit.insert) text.insert(edit.from, edit.insert)
              }
            }, "codemirror")
          }),
        ],
      }),
    })

    const observer = (event: Y.YTextEvent) => {
      if (event.transaction.origin === "codemirror") return
      let index = 0
      const changes: Array<{ from: number; to: number; insert: string }> = []
      for (const delta of event.delta) {
        if (delta.retain) index += delta.retain
        else if (typeof delta.insert === "string") {
          changes.push({ from: index, to: index, insert: delta.insert })
          index += delta.insert.length
        } else if (delta.delete) {
          changes.push({ from: index, to: index + delta.delete, insert: "" })
        }
      }
      applying = true
      view.dispatch({ changes })
      applying = false
    }
    text.observe(observer)
    return () => {
      text.unobserve(observer)
      view.destroy()
    }
  }, [text])

  return <div ref={host} className="h-full min-h-0" />
}
