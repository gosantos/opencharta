import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { linkToken, type ShareLink, type Workspace, type WorkspaceNode } from "@opencharta/shared"
import { ApiError, Client, bootServer } from "./harness"

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
  const workspace = await ana.createWorkspace("Links")
  const file = await ana.createFile(workspace.id, "launch.md", "# Launch\n")
  const base = `/workspaces/${workspace.id}/nodes/${file.id}/links`
  return { ana, bo, workspace, file, base }
}

function accept(client: Client, url: string) {
  return client.call<{ workspace: Workspace; node: WorkspaceNode }>(`/links/${linkToken(url)}/accept`, "POST")
}

test("anyone signed in who opens a link gets that access", async () => {
  const { ana, bo, workspace, file, base } = await setup()
  const { link } = await ana.call<{ link: ShareLink }>(base, "POST", { role: "viewer" })
  assert.ok(link.url?.startsWith(`${server.url}/l/`))

  const page = await fetch(link.url!)
  assert.match(await page.text(), /Open a link/)

  const opened = await accept(bo, link.url!)
  assert.equal(opened.node.id, file.id)
  assert.equal(opened.workspace.shared, true)
  assert.equal(opened.workspace.role, "viewer")
  assert.equal((await bo.content(workspace.id, file.id)).content, "# Launch\n")
  await assert.rejects(
    bo.call(`/workspaces/${workspace.id}/nodes/${file.id}/content`, "PUT", { content: "x", baseRevision: 1 }),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  )

  const { links } = await ana.call<{ links: ShareLink[] }>(base)
  assert.equal(links.length, 1)
  assert.equal(links[0]!.url, undefined)
  assert.equal(links[0]!.createdByName, "Ana")
})

test("opening a viewer link never lowers access, and an editor link raises it", async () => {
  const { ana, bo, workspace, base } = await setup()
  await ana.addMember(workspace.id, bo.user.email, "editor")
  const viewer = (await ana.call<{ link: ShareLink }>(base, "POST", { role: "viewer" })).link
  assert.equal((await accept(bo, viewer.url!)).node.role, "editor")

  const cy = await Client.register(server.url, `cy${count}@example.com`, "Cy")
  await accept(cy, viewer.url!)
  const editor = (await ana.call<{ link: ShareLink }>(base, "POST", { role: "editor" })).link
  assert.equal((await accept(cy, editor.url!)).node.role, "editor")
})

test("a revoked link stops working, and viewers cannot make links", async () => {
  const { ana, bo, base } = await setup()
  const { link } = await ana.call<{ link: ShareLink }>(base, "POST", { role: "editor" })
  await ana.call(`${base}/${link.id}`, "DELETE")
  await assert.rejects(accept(bo, link.url!), (error: unknown) => error instanceof ApiError && error.status === 404)

  const viewer = (await ana.call<{ link: ShareLink }>(base, "POST", { role: "viewer" })).link
  await accept(bo, viewer.url!)
  await assert.rejects(
    bo.call(base, "POST", { role: "viewer" }),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  )
})
