import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { ApiError, Client, Mac, bootServer, eventually, waitFor } from "./harness"

let server: Awaited<ReturnType<typeof bootServer>>
let count = 0

before(async () => {
  server = await bootServer()
})

after(async () => {
  await server.close()
})

async function team(role: "editor" | "viewer" = "editor") {
  count += 1
  const ana = await Client.register(server.url, `ana${count}@example.com`, "Ana")
  const bo = await Client.register(server.url, `bo${count}@example.com`, "Bo")
  const workspace = await ana.createWorkspace("Live")
  await ana.addMember(workspace.id, bo.user.email, role)
  const file = await ana.createFile(workspace.id, "draft.md", "Hello")
  return { ana, bo, workspace, file }
}

test("two people typing in the same file see each other and converge", async () => {
  const { ana, bo, workspace, file } = await team()
  const a = await ana.open(workspace.id, file.id)
  const b = await bo.open(workspace.id, file.id)
  try {
    await waitFor(() => a.peers.at(-1)?.length === 2, "Ana to see Bo")
    assert.deepEqual([...(a.peers.at(-1) ?? [])].sort(), ["Ana", "Bo"])

    a.doc.text.insert(a.doc.text.length, " world")
    b.doc.text.insert(0, "> ")
    await waitFor(
      () => a.doc.text.toString() === b.doc.text.toString() && a.doc.text.length === "> Hello world".length,
      "both editors to converge",
    )
    assert.equal(a.doc.text.toString(), "> Hello world")
  } finally {
    a.doc.destroy()
    b.doc.destroy()
  }

  const saved = await eventually(() => ana.content(workspace.id, file.id), (body) => body.revision === 2)
  assert.equal(saved.content, "> Hello world")
  assert.equal(saved.revision, 2)
})

test("a viewer can watch live edits but cannot type", async () => {
  const { ana, bo, workspace, file } = await team("viewer")
  const a = await ana.open(workspace.id, file.id)
  const b = await bo.open(workspace.id, file.id)
  try {
    b.doc.text.insert(0, "sneaky ")
    await waitFor(() => b.errors.length > 0, "the viewer to be told")
    assert.match(b.errors[0]!, /read this file/)

    a.doc.text.insert(5, "!")
    await waitFor(() => b.doc.text.toString().endsWith("Hello!"), "the viewer to see Ana's edit")
    assert.equal(a.doc.text.toString(), "Hello!")
  } finally {
    a.doc.destroy()
    b.doc.destroy()
  }
})

test("a folder edit to an open file keeps both versions", async () => {
  const { ana, bo, workspace, file } = await team()
  const mac = new Mac(bo, workspace.id)
  try {
    await mac.sync()
    assert.equal(mac.read("draft.md"), "Hello")

    const a = await ana.open(workspace.id, file.id)
    try {
      await assert.rejects(
        bo.call(`/workspaces/${workspace.id}/nodes/${file.id}/content`, "PUT", { content: "x", baseRevision: 1 }),
        (error: unknown) => error instanceof ApiError && error.code === "editing",
      )

      mac.write("draft.md", "Edited in a text editor")
      const result = await mac.sync()
      assert.match(result.message, /Kept both/)
      const copy = mac.files().find((name) => name.includes("conflict"))
      assert.ok(copy)
      assert.equal(mac.read(copy), "Edited in a text editor")
      assert.equal(mac.read("draft.md"), "Hello")
    } finally {
      a.doc.destroy()
    }
  } finally {
    mac.dispose()
  }
})

test("stopping the server saves what people were typing", async () => {
  const first = await bootServer({ keep: true })
  const ana = await Client.register(first.url, "restart@example.com", "Ana")
  const workspace = await ana.createWorkspace("Restart")
  const file = await ana.createFile(workspace.id, "draft.md", "Hello")
  const a = await ana.open(workspace.id, file.id)
  a.doc.text.insert(5, ", still here")
  await new Promise((resolve) => setTimeout(resolve, 50))
  await first.close()
  a.doc.destroy()

  const second = await bootServer({ dir: first.dir })
  try {
    const again = new Client(second.url, ana.token, ana.user)
    const saved = await again.content(workspace.id, file.id)
    assert.equal(saved.content, "Hello, still here")
    assert.equal(saved.revision, 2)
  } finally {
    await second.close()
  }
})
