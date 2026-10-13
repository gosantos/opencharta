import assert from "node:assert/strict"
import test from "node:test"
import { planSync, rewriteMarkdownLinks, type IndexEntry, type LocalEntry, type RemoteNode } from "./index"

const date = "2026-10-13"

function remote(partial: Partial<RemoteNode> & Pick<RemoteNode, "id" | "path">): RemoteNode {
  return {
    parentId: null,
    kind: "file",
    name: partial.path.slice(partial.path.lastIndexOf("/") + 1),
    revision: 1,
    contentHash: "server",
    ...partial,
  }
}

function local(path: string, contentHash = "local", kind: LocalEntry["kind"] = "file"): LocalEntry {
  return { path, kind, contentHash }
}

function indexed(partial: Partial<IndexEntry> & Pick<IndexEntry, "nodeId" | "path">): IndexEntry {
  return {
    kind: "file",
    baseRevision: 1,
    contentHash: "server",
    ...partial,
  }
}

test("downloads a file the device has never seen", () => {
  const actions = planSync({
    remote: [remote({ id: "a", path: "notes.md" })],
    local: [],
    index: [],
    conflictDate: date,
  })
  assert.deepEqual(
    actions.map((action) => action.type),
    ["write", "adopt"],
  )
})

test("does nothing when the folder already matches", () => {
  const actions = planSync({
    remote: [remote({ id: "a", path: "notes.md", contentHash: "same" })],
    local: [local("notes.md", "same")],
    index: [indexed({ nodeId: "a", path: "notes.md", contentHash: "same" })],
    conflictDate: date,
  })
  assert.deepEqual(actions, [])
})

test("pushes a local edit when the server copy is unchanged", () => {
  const actions = planSync({
    remote: [remote({ id: "a", path: "notes.md", contentHash: "server" })],
    local: [local("notes.md", "edited")],
    index: [indexed({ nodeId: "a", path: "notes.md", contentHash: "server" })],
    conflictDate: date,
  })
  assert.equal(actions[0]?.type, "push-update")
})

test("writes the server copy when only the server changed", () => {
  const actions = planSync({
    remote: [remote({ id: "a", path: "notes.md", revision: 2, contentHash: "next" })],
    local: [local("notes.md", "server")],
    index: [indexed({ nodeId: "a", path: "notes.md", contentHash: "server" })],
    conflictDate: date,
  })
  assert.equal(actions[0]?.type, "write")
  assert.equal(actions.at(-1)?.type, "adopt")
})

test("keeps both sides when the same file changed in two places", () => {
  const actions = planSync({
    remote: [remote({ id: "a", path: "notes.md", revision: 2, contentHash: "server-2" })],
    local: [local("notes.md", "local-edit")],
    index: [indexed({ nodeId: "a", path: "notes.md", contentHash: "server" })],
    conflictDate: date,
  })
  assert.equal(actions[0]?.type, "conflict-copy")
  if (actions[0]?.type === "conflict-copy") {
    assert.equal(actions[0].to, "notes (conflict, local, 2026-10-13).md")
  }
  assert.equal(actions[1]?.type, "write")
})

test("treats a clean missing file as a local delete", () => {
  const actions = planSync({
    remote: [remote({ id: "a", path: "notes.md" })],
    local: [],
    index: [indexed({ nodeId: "a", path: "notes.md" })],
    conflictDate: date,
  })
  assert.equal(actions[0]?.type, "push-delete")
})

test("recognizes a local rename by content hash", () => {
  const actions = planSync({
    remote: [remote({ id: "a", path: "notes.md", contentHash: "same" })],
    local: [local("renamed.md", "same")],
    index: [indexed({ nodeId: "a", path: "notes.md", contentHash: "same" })],
    conflictDate: date,
  })
  assert.equal(actions[0]?.type, "push-rename")
  if (actions[0]?.type === "push-rename") assert.equal(actions[0].path, "renamed.md")
})

test("renames a clean local file when the server moved it", () => {
  const actions = planSync({
    remote: [remote({ id: "a", path: "archive/notes.md", contentHash: "same", parentId: "folder" })],
    local: [local("notes.md", "same")],
    index: [indexed({ nodeId: "a", path: "notes.md", contentHash: "same" })],
    conflictDate: date,
  })
  assert.ok(actions.some((action) => action.type === "rename-local" && action.to === "archive/notes.md"))
})

test("removes a local file the server deleted", () => {
  const actions = planSync({
    remote: [],
    local: [local("notes.md", "same")],
    index: [indexed({ nodeId: "a", path: "notes.md", contentHash: "same" })],
    conflictDate: date,
  })
  assert.ok(actions.some((action) => action.type === "delete-local"))
  assert.ok(actions.some((action) => action.type === "drop-index"))
})

test("reuploads a locally edited file the server deleted", () => {
  const actions = planSync({
    remote: [],
    local: [local("notes.md", "edited")],
    index: [indexed({ nodeId: "a", path: "notes.md", contentHash: "same" })],
    conflictDate: date,
  })
  assert.ok(actions.some((action) => action.type === "push-create" && action.path === "notes.md"))
  assert.ok(!actions.some((action) => action.type === "delete-local"))
})

test("uploads a new local markdown file", () => {
  const actions = planSync({
    remote: [],
    local: [local("ideas.md", "hash")],
    index: [],
    conflictDate: date,
  })
  assert.deepEqual(actions, [{ type: "push-create", path: "ideas.md", kind: "file" }])
})

test("rewrites markdown links when a file moves", () => {
  const next = rewriteMarkdownLinks("See [notes](notes/weekly.md) and [abs](/notes/weekly.md).", [
    { from: "notes/weekly.md", to: "archive/weekly.md" },
  ])
  assert.equal(next, "See [notes](archive/weekly.md) and [abs](/archive/weekly.md).")
})
