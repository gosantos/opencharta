import { roleAtLeast, type Comment, type Role } from "@opencharta/shared"
import { useEffect, useState } from "react"
import { Check, RotateCcw } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Api, ApiError } from "../lib/api"

/** Comment threads for one file. `version` bumps when the live connection says comments changed. */
export function CommentsPanel({
  api,
  workspaceId,
  nodeId,
  userId,
  role,
  selection,
  version,
}: {
  api: Api
  workspaceId: string
  nodeId: string
  userId: string
  role: Role | null
  selection: string
  version: number
}) {
  const [comments, setComments] = useState<Comment[]>([])
  const [draft, setDraft] = useState("")
  const [quote, setQuote] = useState("")
  const [suggesting, setSuggesting] = useState(false)
  const [replacement, setReplacement] = useState("")
  const [showResolved, setShowResolved] = useState(false)
  const [error, setError] = useState("")
  const canModerate = !!role && roleAtLeast(role, "editor")

  async function load() {
    try {
      setComments((await api.comments(workspaceId, nodeId)).comments)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load comments.")
    }
  }

  useEffect(() => {
    void load()
  }, [api, workspaceId, nodeId, version])

  // Starting a comment while text is selected quotes that text.
  useEffect(() => {
    if (selection.trim()) setQuote(selection.trim().slice(0, 2000))
  }, [selection])

  async function run(action: () => Promise<unknown>) {
    setError("")
    try {
      await action()
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That didn't work.")
    }
  }

  const threads = comments.filter((comment) => !comment.parentId)
  const visible = threads.filter((thread) => showResolved || !thread.resolved)
  const resolvedCount = threads.length - threads.filter((thread) => !thread.resolved).length

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-line-soft bg-muted/40">
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-semibold">Comments</h2>
        {resolvedCount ? (
          <button type="button" className="text-xs text-muted-foreground" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto px-3 pb-4">
        {visible.length === 0 ? <p className="px-1 text-sm text-muted-foreground">No comments yet.</p> : null}
        {visible.map((thread) => (
          <Thread
            key={thread.id}
            thread={thread}
            replies={comments.filter((comment) => comment.parentId === thread.id)}
            userId={userId}
            canModerate={canModerate}
            onReply={(body) => run(() => api.addComment(workspaceId, nodeId, { body, parentId: thread.id }))}
            onAccept={() => run(() => api.acceptSuggestion(workspaceId, nodeId, thread.id))}
            onResolve={(resolved) => run(() => api.updateComment(workspaceId, nodeId, thread.id, { resolved }))}
            onDelete={(id) => run(() => api.deleteComment(workspaceId, nodeId, id))}
          />
        ))}
      </div>
      <form
        className="grid gap-2 border-t border-line-soft bg-background p-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim()) return
          void run(async () => {
            await api.addComment(workspaceId, nodeId, {
              body: draft,
              quote: quote || undefined,
              suggestion: suggesting && quote ? replacement : undefined,
            })
            setDraft("")
            setQuote("")
            setReplacement("")
            setSuggesting(false)
          })
        }}
      >
        {quote ? (
          <div className="flex items-start gap-2">
            <blockquote className="min-w-0 flex-1 truncate border-l-2 border-comment-line pl-2 text-xs text-foreground/80 italic">
              {quote}
            </blockquote>
            <button type="button" className="text-xs text-muted-foreground" onClick={() => setSuggesting(!suggesting)}>
              {suggesting ? "Just comment" : "Suggest edit"}
            </button>
            <button type="button" className="text-xs text-muted-foreground" onClick={() => setQuote("")}>
              Clear
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Select text in the document to comment on it.</p>
        )}
        {suggesting && quote ? (
          <textarea
            className="min-h-12 rounded-md border border-input bg-background p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder="Replace with"
          />
        ) : null}
        <textarea
          className="min-h-16 rounded-md border border-input bg-background p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a comment"
        />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          Comment
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </aside>
  )
}

function Thread({
  thread,
  replies,
  userId,
  canModerate,
  onReply,
  onAccept,
  onResolve,
  onDelete,
}: {
  thread: Comment
  replies: Comment[]
  userId: string
  canModerate: boolean
  onReply: (body: string) => Promise<void>
  onAccept: () => Promise<void>
  onResolve: (resolved: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [reply, setReply] = useState("")
  const canResolve = canModerate || thread.authorId === userId
  return (
    <section
      className={`rounded-lg border border-border bg-background p-3 text-sm shadow-[0_1px_2px_rgba(20,20,18,0.04)] ${thread.resolved ? "opacity-60" : ""}`}
    >
      {thread.quote ? (
        <blockquote className="mb-2 rounded-sm border-l-2 border-comment-line bg-comment/50 px-2 py-1 text-xs text-foreground/80 italic">{thread.quote}</blockquote>
      ) : null}
      {thread.suggestion !== null ? (
        <div className="mb-2 flex items-baseline justify-between gap-2 text-xs">
          <span className="min-w-0">
            Suggests:{" "}
            <span className="rounded-sm bg-insert px-1 py-px font-medium whitespace-pre-wrap text-insert-ink underline decoration-insert-line underline-offset-2">
              {thread.suggestion || "(delete)"}
            </span>
          </span>
          {thread.accepted ? (
            <span className="font-medium text-brand-ink">Accepted</span>
          ) : canModerate ? (
            <Button size="xs" onClick={() => void onAccept()}>
              Accept
            </Button>
          ) : null}
        </div>
      ) : null}
      {[thread, ...replies].map((comment) => (
        <div key={comment.id} className="mb-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={comment.authorName} colorKey={comment.authorId} size="sm" />
              <span className="truncate font-medium">{comment.authorName}</span>
            </span>
            {canModerate || comment.authorId === userId ? (
              <button type="button" className="text-xs text-muted-foreground" onClick={() => void onDelete(comment.id)}>
                Delete
              </button>
            ) : null}
          </div>
          <p className="mt-1 pl-7 whitespace-pre-wrap">{comment.body}</p>
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!reply.trim()) return
          void onReply(reply).then(() => setReply(""))
        }}
      >
        <input
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Reply"
        />
        {canResolve ? (
          <Button type="button" variant="outline" size="xs" onClick={() => void onResolve(!thread.resolved)}>
            {thread.resolved ? <RotateCcw /> : <Check />}
            {thread.resolved ? "Reopen" : "Resolve"}
          </Button>
        ) : null}
      </form>
    </section>
  )
}
