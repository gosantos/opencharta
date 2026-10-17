import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import type { NodeShare, Workspace } from "@opencharta/shared"
import { ApiError, Client, Mac, bootServer } from "./harness"

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
  const workspace = await ana.createWorkspace("Company")
  const projects = await ana.createFolder(workspace.id, "projects")
  const atlas = await ana.createFolder(workspace.id, "atlas", projects.id)
  const spec = await ana.createFile(workspace.id, "spec.md", "# Atlas\n", atlas.id)
  const salaries = await ana.createFile(workspace.id, "salaries.md", "secret\n")
  return { ana, bo, workspace, projects, atlas, spec, salaries }
}

function share(client: Client, workspaceId: string, nodeId: string, email: string, role: "editor" | "viewer") {
  return client.call<{ shares: NodeShare[] }>(`/workspaces/${workspaceId}/nodes/${nodeId}/shares`, "POST", { email, role })
}

const forbidden = (error: unknown) => error instanceof ApiError && error.status === 403

test("sharing one folder lets a non-member see and edit only that folder", async () => {
  const { ana, bo, workspace, atlas, spec, salaries } = await setup()
  await assert.rejects(bo.nodes(workspace.id), forbidden)

  const { shares } = await share(ana, workspace.id, atlas.id, bo.user.email, "editor")
  assert.deepEqual(
    shares.map((item) => [item.name, item.role]),
    [["Bo", "editor"]],
  )

  const { workspaces } = await bo.call<{ workspaces: Workspace[] }>("/workspaces")
  assert.equal(workspaces.length, 1)
  assert.equal(workspaces[0]!.shared, true)
  assert.equal(workspaces[0]!.role, "editor")

  const nodes = await bo.nodes(workspace.id)
  assert.deepEqual(nodes.map((node) => [node.path, node.role]).sort(), [
    ["projects", null],
    ["projects/atlas", "editor"],
    ["projects/atlas/spec.md", "editor"],
  ])
  await assert.rejects(bo.content(workspace.id, salaries.id), forbidden)
  await assert.rejects(bo.createFile(workspace.id, "root.md"), forbidden)
  await assert.rejects(bo.call(`/workspaces/${workspace.id}/members`), forbidden)

  const mac = new Mac(bo, workspace.id)
  try {
    await mac.sync()
    assert.deepEqual(mac.files(), ["projects/atlas/spec.md"])
    mac.write("projects/atlas/spec.md", "# Atlas\n\nBo's notes.\n")
    mac.write("projects/atlas/plan.md", "Plan\n")
    mac.write("sneaky.md", "Not shared.\n")
    await mac.sync()
  } finally {
    mac.dispose()
  }

  assert.equal((await ana.content(workspace.id, spec.id)).content, "# Atlas\n\nBo's notes.\n")
  const paths = (await ana.nodes(workspace.id)).map((node) => node.path).sort()
  assert.ok(paths.includes("projects/atlas/plan.md"))
  assert.ok(!paths.includes("sneaky.md"))

  const changes = await bo.call<{ changes: Array<{ nodeId: string }> }>(`/workspaces/${workspace.id}/changes?since=0`)
  assert.ok(!changes.changes.some((change) => change.nodeId === salaries.id))
})

test("a viewer share is read-only, and removing it takes access away", async () => {
  const { ana, bo, workspace, spec } = await setup()
  await share(ana, workspace.id, spec.id, bo.user.email, "viewer")

  assert.equal((await bo.content(workspace.id, spec.id)).content, "# Atlas\n")
  await assert.rejects(
    bo.call(`/workspaces/${workspace.id}/nodes/${spec.id}/content`, "PUT", { content: "x", baseRevision: 1 }),
    forbidden,
  )
  const live = await bo.open(workspace.id, spec.id)
  live.doc.text.insert(0, "x")
  await new Promise((resolve) => setTimeout(resolve, 50))
  live.doc.destroy()
  assert.match(live.errors.join(" "), /read this file/)

  await ana.call(`/workspaces/${workspace.id}/nodes/${spec.id}/shares/${bo.user.id}`, "DELETE")
  await assert.rejects(bo.content(workspace.id, spec.id), forbidden)
  const { workspaces } = await bo.call<{ workspaces: Workspace[] }>("/workspaces")
  assert.equal(workspaces.length, 0)
})

test("people can only share up to their own access", async () => {
  const { ana, bo, workspace, atlas, spec } = await setup()
  const cy = await Client.register(server.url, `cy${count}@example.com`, "Cy")
  await share(ana, workspace.id, atlas.id, bo.user.email, "viewer")
  await assert.rejects(share(bo, workspace.id, spec.id, cy.user.email, "viewer"), forbidden)

  await share(ana, workspace.id, atlas.id, bo.user.email, "editor")
  await share(bo, workspace.id, spec.id, cy.user.email, "viewer")
  assert.equal((await cy.content(workspace.id, spec.id)).content, "# Atlas\n")

  await assert.rejects(
    bo.call(`/workspaces/${workspace.id}/nodes/${spec.id}`, "PATCH", { parentId: null }),
    forbidden,
  )
})
