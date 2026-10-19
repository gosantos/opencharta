import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { FileText } from "lucide-react"
import type { WorkspaceNode } from "@opencharta/shared"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"

export type QuickAction = {
  id: string
  label: string
  icon: ReactNode
  run: () => void
}

type Item = {
  key: string
  group: "Files" | "Actions"
  label: string
  hint?: string
  icon: ReactNode
  run: () => void
}

/** ⌘K: jump to any file, or run an action, by typing. */
export function QuickOpen({
  open,
  onOpenChange,
  nodes,
  actions,
  onOpenFile,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  nodes: WorkspaceNode[]
  actions: QuickAction[]
  onOpenFile: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  // When a result is chosen, focus goes to whatever that result opens, not back to the trigger.
  const chosen = useRef(false)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setActive(0)
  }, [open])

  const items = useMemo<Item[]>(() => {
    const needle = query.trim().toLowerCase()
    const words = needle.split(/\s+/).filter(Boolean)
    const files = nodes
      .filter((node) => node.kind === "file")
      .filter((node) => words.every((word) => node.path.toLowerCase().includes(word)))
      .sort((a, b) => score(b, needle) - score(a, needle) || a.path.localeCompare(b.path))
      .slice(0, 8)
      .map<Item>((node) => ({
        key: `file:${node.id}`,
        group: "Files",
        label: node.name,
        hint: node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : undefined,
        icon: <FileText className="size-4 text-subtle-foreground" />,
        run: () => onOpenFile(node.id),
      }))
    const matching = actions
      .filter((action) => words.every((word) => action.label.toLowerCase().includes(word)))
      .map<Item>((action) => ({ key: `action:${action.id}`, group: "Actions", label: action.label, icon: action.icon, run: action.run }))
    return [...files, ...matching]
  }, [query, nodes, actions, onOpenFile])

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(items.length - 1, 0)))
  }, [items.length])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active])

  function choose(item: Item | undefined) {
    if (!item) return
    chosen.current = true
    onOpenChange(false)
    item.run()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (!chosen.current) return
          chosen.current = false
          event.preventDefault()
        }}
        className="top-24 translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[600px]"
      >
        <DialogTitle className="sr-only">Quick open</DialogTitle>
        <div className="flex items-center gap-2 border-b border-line-soft px-4">
          <input
            autoFocus
            aria-label="Search files and actions"
            placeholder="Jump to a file, or type an action…"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle-foreground"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setActive((current) => Math.min(current + 1, items.length - 1))
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                setActive((current) => Math.max(current - 1, 0))
              } else if (event.key === "Enter") {
                event.preventDefault()
                choose(items[active])
              }
            }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div ref={list} role="listbox" aria-label="Results" className="max-h-[360px] overflow-auto p-1.5">
          {items.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</p> : null}
          {items.map((item, index) => (
            <div key={item.key}>
              {index === 0 || items[index - 1]?.group !== item.group ? (
                <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[0.04em] text-subtle-foreground uppercase">
                  {item.group}
                </div>
              ) : null}
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                data-index={index}
                className={cn(
                  "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px]",
                  index === active ? "bg-brand-tint text-foreground" : "hover:bg-muted",
                )}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(item)}
              >
                {item.icon}
                <span className="min-w-0 flex-1 truncate">
                  <Highlight text={item.label} query={query} />
                  {item.hint ? <span className="ml-2 text-subtle-foreground">{item.hint}</span> : null}
                </span>
                {index === active ? <Kbd className="border-transparent bg-transparent">↵</Kbd> : null}
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-line-soft bg-muted/60 px-4 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Files whose name starts with the query come first, then names that contain it. */
function score(node: WorkspaceNode, needle: string) {
  if (!needle) return 0
  const name = node.name.toLowerCase()
  if (name.startsWith(needle)) return 2
  if (name.includes(needle)) return 1
  return 0
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase()
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold">{text.slice(at, at + needle.length)}</span>
      {text.slice(at + needle.length)}
    </>
  )
}
