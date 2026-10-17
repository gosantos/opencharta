import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { Client, Mac, bootServer } from "./harness"

let server: Awaited<ReturnType<typeof bootServer>>
const macs: Mac[] = []

before(async () => {
  server = await bootServer()
})

after(async () => {
  for (const mac of macs) mac.dispose()
  await server.close()
})

async function team(viewerRole: "editor" | "viewer" = "editor") {
  const n = macs.length
  const ana = await Client.register(server.url, `ana${n}@example.com`, "Ana")
  const bo = await Client.register(server.url, `bo${n}@example.com`, "Bo")
  const workspace = await ana.createWorkspace("Team notes")
  await ana.addMember(workspace.id, bo.user.email, viewerRole)
  const anaMac = new Mac(ana, workspace.id)
  const boMac = new Mac(bo, workspace.id)
  macs.push(anaMac, boMac)
  return { ana, bo, workspace, anaMac, boMac }
}

test("a file written on one Mac shows up on another, with edits, renames, and deletes", async () => {
  const { anaMac, boMac } = await team()

  anaMac.write("plans/q4.md", "# Q4\n")
  await anaMac.sync()
  await boMac.sync()
  assert.deepEqual(boMac.files(), ["plans/q4.md"])
  assert.equal(boMac.read("plans/q4.md"), "# Q4\n")

  boMac.write("plans/q4.md", "# Q4\n\nShip sharing.\n")
  await boMac.sync()
  await anaMac.sync()
  assert.equal(anaMac.read("plans/q4.md"), "# Q4\n\nShip sharing.\n")

  anaMac.write("plans/roadmap.md", anaMac.read("plans/q4.md"))
  anaMac.remove("plans/q4.md")
  await anaMac.sync()
  await boMac.sync()
  assert.deepEqual(boMac.files(), ["plans/roadmap.md"])

  boMac.remove("plans/roadmap.md")
  await boMac.sync()
  await anaMac.sync()
  assert.deepEqual(anaMac.files(), [])
})

test("when two Macs change the same file, both versions are kept", async () => {
  const { anaMac, boMac } = await team()

  anaMac.write("notes.md", "start\n")
  await anaMac.sync()
  await boMac.sync()

  anaMac.write("notes.md", "from Ana\n")
  boMac.write("notes.md", "from Bo\n")
  await anaMac.sync()
  const result = await boMac.sync()

  assert.match(result.message, /Kept both/)
  const files = boMac.files()
  assert.equal(files.length, 2)
  const copy = files.find((file) => file.includes("conflict"))
  assert.ok(copy, `expected a conflict copy in ${files.join(", ")}`)
  assert.equal(boMac.read("notes.md"), "from Ana\n")
  assert.equal(boMac.read(copy), "from Bo\n")

  await boMac.sync()
  await anaMac.sync()
  assert.deepEqual(anaMac.files(), files)
})

test("a viewer's Mac gets files but cannot change them on the server", async () => {
  const { ana, workspace, anaMac, boMac } = await team("viewer")

  anaMac.write("policy.md", "Read me.\n")
  await anaMac.sync()
  await boMac.sync()
  assert.equal(boMac.read("policy.md"), "Read me.\n")

  boMac.write("policy.md", "Changed by a viewer.\n")
  boMac.write("new.md", "Not allowed.\n")
  await boMac.sync()

  const nodes = await ana.nodes(workspace.id)
  assert.deepEqual(nodes.map((node) => node.path).sort(), ["policy.md"])
  const content = await ana.content(workspace.id, nodes[0]!.id)
  assert.equal(content.content, "Read me.\n")
})
