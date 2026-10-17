import { roleAtLeast, type Comment, type Role } from "@opencharta/shared"
import { useEffect, useState } from "react"
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
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-border bg-white">
      <div className="flex items-baseline justify-between px-4 py-3">
        <h2 className="text-sm font-medium">Comments</h2>
        {resolvedCount ? (
          <button type="button" className="text-xs text-muted-foreground" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? "Hide resolved" : `Show resolved (${resolvedCount})`}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 pb-4">
        {visible.length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : null}
        {visible.map((thread) => (
          <Thread
            key={thread.id}
            thread={thread}
            replies={comments.filter((comment) => comment.parentId === thread.id)}
            userId={userId}
            canModerate={canModerate}
            onReply={(body) => run(() => api.addComment(workspaceId, nodeId, { body, parentId: thread.id }))}
            onResolve={(resolved) => run(() => api.updateComment(workspaceId, nodeId, thread.id, { resolved }))}
            onDelete={(id) => run(() => api.deleteComment(workspaceId, nodeId, id))}
          />
        ))}
      </div>
      <form
        className="grid gap-2 border-t border-border p-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.trim()) return
          void run(async () => {
            await api.addComment(workspaceId, nodeId, { body: draft, quote: quote || undefined })
            setDraft("")
            setQuote("")
          })
        }}
      >
        {quote ? (
          <div className="flex items-start gap-2">
            <blockquote className="min-w-0 flex-1 truncate border-l-2 border-black pl-2 text-xs text-muted-foreground">
              {quote}
            </blockquote>
            <button type="button" className="text-xs text-muted-foreground" onClick={() => setQuote("")}>
              Clear
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Select text in the document to comment on it.</p>
        )}
        <textarea
          className="min-h-16 rounded-md border border-input p-2 text-sm"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a comment"
        />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          Comment
        </Button>
        {error ? <p className="text-sm">{error}</p> : null}
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
  onResolve,
  onDelete,
}: {
  thread: Comment
  replies: Comment[]
  userId: string
  canModerate: boolean
  onReply: (body: string) => Promise<void>
  onResolve: (resolved: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [reply, setReply] = useState("")
  const canResolve = canModerate || thread.authorId === userId
  return (
    <section className={`rounded-md border border-border p-3 text-sm ${thread.resolved ? "opacity-60" : ""}`}>
      {thread.quote ? (
        <blockquote className="mb-2 border-l-2 border-black pl-2 text-xs text-muted-foreground">{thread.quote}</blockquote>
      ) : null}
      {[thread, ...replies].map((comment) => (
        <div key={comment.id} className="mb-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{comment.authorName}</span>
            {canModerate || comment.authorId === userId ? (
              <button type="button" className="text-xs text-muted-foreground" onClick={() => void onDelete(comment.id)}>
                Delete
              </button>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap">{comment.body}</p>
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
          className="h-8 min-w-0 flex-1 rounded-md border border-input px-2 text-sm"
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="Reply"
        />
        {canResolve ? (
          <button type="button" className="text-xs text-muted-foreground" onClick={() => void onResolve(!thread.resolved)}>
            {thread.resolved ? "Reopen" : "Resolve"}
          </button>
        ) : null}
      </form>
    </section>
  )
}
