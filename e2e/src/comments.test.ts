import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { Comment } from "@opencharta/shared"
import { ApiError, Client, bootServer, waitFor } from "./harness"

let server: Awaited<ReturnType<typeof bootServer>>
let count = 0

before(async () => {
  server = await bootServer()
})

after(async () => {
  await server.close()
})

async function setup() {
  count += 1
  const ana = await Client.register(server.url, `ana${count}@example.com`, "Ana")
  const bo = await Client.register(server.url, `bo${count}@example.com`, "Bo")
  const cy = await Client.register(server.url, `cy${count}@example.com`, "Cy")
  const workspace = await ana.createWorkspace("Review")
  await ana.addMember(workspace.id, bo.user.email, "viewer")
  await ana.addMember(workspace.id, cy.user.email, "editor")
  const file = await ana.createFile(workspace.id, "rfc.md", "# RFC\n\nWe should ship on Friday.\n")
  const base = `/workspaces/${workspace.id}/nodes/${file.id}/comments`
  return { ana, bo, cy, workspace, file, base }
}

const status = (code: number) => (error: unknown) => error instanceof ApiError && error.status === code

test("people discuss a passage in a thread and resolve it, live", async () => {
  const { ana, bo, workspace, file, base } = await setup()
  const open = await ana.open(workspace.id, file.id)
  try {
    const { comment: thread } = await bo.call<{ comment: Comment }>(base, "POST", {
      body: "Friday is risky.",
      quote: "ship on Friday",
    })
    assert.equal(thread.authorName, "Bo")
    assert.equal(thread.quote, "ship on Friday")
    await waitFor(() => open.notices.comments === 1, "Ana's editor to hear about the comment")

    await ana.call(base, "POST", { body: "Monday then.", parentId: thread.id, quote: "ignored" })
    await bo.call(`${base}/${thread.id}`, "PATCH", { resolved: true })

    const { comments } = await ana.call<{ comments: Comment[] }>(base)
    assert.deepEqual(
      comments.map((item) => [item.authorName, item.body, item.parentId === thread.id, item.resolved, item.quote]),
      [
        ["Bo", "Friday is risky.", false, true, "ship on Friday"],
        ["Ana", "Monday then.", true, false, ""],
      ],
    )
    await waitFor(() => open.notices.comments === 3, "every change to reach the editor")

    await bo.call(base, "POST", { body: "Reopening.", parentId: thread.id })
    const reopened = (await ana.call<{ comments: Comment[] }>(base)).comments.find((item) => item.id === thread.id)
    assert.equal(reopened?.resolved, false)
  } finally {
    open.doc.destroy()
  }
})

test("only authors edit their words, and editors moderate", async () => {
  const { ana, bo, cy, base } = await setup()
  const { comment } = await bo.call<{ comment: Comment }>(base, "POST", { body: "Typo here" })
  await assert.rejects(ana.call(`${base}/${comment.id}`, "PATCH", { body: "changed" }), status(403))
  const edited = await bo.call<{ comment: Comment }>(`${base}/${comment.id}`, "PATCH", { body: "Typo in the title" })
  assert.equal(edited.comment.body, "Typo in the title")

  const { comment: other } = await cy.call<{ comment: Comment }>(base, "POST", { body: "From Cy" })
  await assert.rejects(bo.call(`${base}/${other.id}`, "PATCH", { resolved: true }), status(403))
  await assert.rejects(bo.call(`${base}/${other.id}`, "DELETE"), status(403))

  await ana.call(base, "POST", { body: "reply", parentId: comment.id })
  await cy.call(`${base}/${comment.id}`, "DELETE")
  const { comments } = await ana.call<{ comments: Comment[] }>(base)
  assert.deepEqual(
    comments.map((item) => item.body),
    ["From Cy"],
  )
})

test("outsiders cannot read or add comments", async () => {
  const { workspace, base } = await setup()
  const eve = await Client.register(server.url, `eve${count}@example.com`, "Eve")
  await assert.rejects(eve.call(base), status(403))
  await assert.rejects(eve.call(base, "POST", { body: "hi" }), status(403))
  await assert.rejects(
    eve.call(`/workspaces/${workspace.id}/nodes/nope/comments`, "POST", { body: "hi" }),
    status(403),
  )
})

test("a viewer suggests an edit and an editor accepts it into the closed file", async () => {
  const { ana, bo, workspace, file, base } = await setup()
  await assert.rejects(bo.call(base, "POST", { body: "no quote", suggestion: "x" }), status(400))
  const { comment } = await bo.call<{ comment: Comment }>(base, "POST", {
    body: "Monday is safer.",
    quote: "on Friday",
    suggestion: "on Monday",
  })
  assert.equal(comment.suggestion, "on Monday")
  await assert.rejects(bo.call(`${base}/${comment.id}/accept`, "POST"), status(403))

  const accepted = await ana.call<{ comment: Comment }>(`${base}/${comment.id}/accept`, "POST")
  assert.equal(accepted.comment.accepted, true)
  assert.equal(accepted.comment.resolved, true)
  const saved = await ana.content(workspace.id, file.id)
  assert.equal(saved.content, "# RFC\n\nWe should ship on Monday.\n")
  assert.equal(saved.revision, 2)
  await assert.rejects(ana.call(`${base}/${comment.id}/accept`, "POST"), status(409))
})

test("accepting a suggestion while people are typing merges it live", async () => {
  const { ana, cy, workspace, file, base } = await setup()
  const open = await cy.open(workspace.id, file.id)
  try {
    const { comment } = await ana.call<{ comment: Comment }>(base, "POST", {
      body: "Shorter",
      quote: "We should ship",
      suggestion: "Ship",
    })
    open.doc.text.insert(0, "Draft: ")
    await new Promise((resolve) => setTimeout(resolve, 50))
    await ana.call(`${base}/${comment.id}/accept`, "POST")
    await waitFor(() => open.doc.text.toString().includes("Ship on Friday"), "the editor to receive the change")
    assert.equal(open.doc.text.toString(), "Draft: # RFC\n\nShip on Friday.\n")
    const saved = await ana.content(workspace.id, file.id)
    assert.equal(saved.content, "Draft: # RFC\n\nShip on Friday.\n")
  } finally {
    open.doc.destroy()
  }
})

test("a suggestion whose text was changed can't be accepted", async () => {
  const { ana, workspace, file, base } = await setup()
  const { comment } = await ana.call<{ comment: Comment }>(base, "POST", {
    body: "x",
    quote: "on Friday",
    suggestion: "on Monday",
  })
  await ana.call(`/workspaces/${workspace.id}/nodes/${file.id}/content`, "PUT", { content: "Rewritten.\n", baseRevision: 1 })
  await assert.rejects(ana.call(`${base}/${comment.id}/accept`, "POST"), status(409))
  assert.equal((await ana.content(workspace.id, file.id)).content, "Rewritten.\n")
})
