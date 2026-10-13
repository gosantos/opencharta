import assert from "node:assert/strict"
import test from "node:test"
import { REVISION_LIMIT } from "@opencharta/shared"
import { createApp } from "../app"
import { openDatabase } from "../db/client"

async function boot() {
  const { sqlite, db } = openDatabase(":memory:")
  const { app } = createApp(db)
  return { app, close: () => sqlite.close() }
}

async function register(app: Awaited<ReturnType<typeof boot>>["app"], email: string, name = "Ana") {
  const response = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name, password: "password123" }),
  })
  assert.equal(response.status, 200)
  return (await response.json()) as { token: string; user: { id: string; name: string } }
}

function auth(token: string, init: RequestInit = {}) {
  return {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  }
}

test("registers, creates a workspace, and rejects a stale file write", async () => {
  const { app, close } = await boot()
  try {
    const ana = await register(app, "ana@example.com")
    const created = await app.request(
      "/workspaces",
      auth(ana.token, { method: "POST", body: JSON.stringify({ name: "Notes" }) }),
    )
    assert.equal(created.status, 201)
    const { workspace } = (await created.json()) as { workspace: { id: string; role: string } }
    assert.equal(workspace.role, "owner")

    const file = await app.request(
      `/workspaces/${workspace.id}/nodes`,
      auth(ana.token, {
        method: "POST",
        body: JSON.stringify({ parentId: null, kind: "file", name: "weekly", content: "hello" }),
      }),
    )
    assert.equal(file.status, 201)
    const { node } = (await file.json()) as { node: { id: string; name: string; revision: number } }
    assert.equal(node.name, "weekly.md")
    assert.equal(node.revision, 1)

    const saved = await app.request(
      `/workspaces/${workspace.id}/nodes/${node.id}/content`,
      auth(ana.token, {
        method: "PUT",
        body: JSON.stringify({ content: "hello there", baseRevision: 1 }),
      }),
    )
    assert.equal(saved.status, 200)

    const stale = await app.request(
      `/workspaces/${workspace.id}/nodes/${node.id}/content`,
      auth(ana.token, {
        method: "PUT",
        body: JSON.stringify({ content: "overwrite", baseRevision: 1 }),
      }),
    )
    assert.equal(stale.status, 409)
    const body = (await stale.json()) as { error: { code: string; details: { serverContent: string } } }
    assert.equal(body.error.code, "conflict")
    assert.equal(body.error.details.serverContent, "hello there")

    const changes = await app.request(`/workspaces/${workspace.id}/changes?since=0`, auth(ana.token))
    const log = (await changes.json()) as { changes: Array<{ op: string }>; cursor: number }
    assert.ok(log.cursor > 0)
    assert.ok(log.changes.some((change) => change.op === "create"))
    assert.ok(log.changes.some((change) => change.op === "update"))
  } finally {
    close()
  }
})

test("keeps only the latest 10 versions", async () => {
  const { app, close } = await boot()
  try {
    const ana = await register(app, "ana@example.com")
    const { workspace } = (await (
      await app.request("/workspaces", auth(ana.token, { method: "POST", body: JSON.stringify({ name: "Notes" }) }))
    ).json()) as { workspace: { id: string } }
    const { node } = (await (
      await app.request(
        `/workspaces/${workspace.id}/nodes`,
        auth(ana.token, {
          method: "POST",
          body: JSON.stringify({ parentId: null, kind: "file", name: "log.md", content: "v1" }),
        }),
      )
    ).json()) as { node: { id: string } }

    let revision = 1
    for (let i = 2; i <= 12; i += 1) {
      const response = await app.request(
        `/workspaces/${workspace.id}/nodes/${node.id}/content`,
        auth(ana.token, {
          method: "PUT",
          body: JSON.stringify({ content: `v${i}`, baseRevision: revision }),
        }),
      )
      assert.equal(response.status, 200)
      revision = ((await response.json()) as { revision: number }).revision
    }

    const history = await app.request(
      `/workspaces/${workspace.id}/nodes/${node.id}/revisions`,
      auth(ana.token),
    )
    const { revisions } = (await history.json()) as { revisions: Array<{ revision: number }> }
    assert.equal(revisions.length, REVISION_LIMIT)
    assert.equal(revisions[0]?.revision, 12)
    assert.equal(revisions.at(-1)?.revision, 3)
  } finally {
    close()
  }
})

test("viewers can read and cannot edit", async () => {
  const { app, close } = await boot()
  try {
    const ana = await register(app, "ana@example.com", "Ana")
    const bo = await register(app, "bo@example.com", "Bo")
    const { workspace } = (await (
      await app.request("/workspaces", auth(ana.token, { method: "POST", body: JSON.stringify({ name: "Notes" }) }))
    ).json()) as { workspace: { id: string } }
    const added = await app.request(
      `/workspaces/${workspace.id}/members`,
      auth(ana.token, {
        method: "POST",
        body: JSON.stringify({ email: "bo@example.com", role: "viewer" }),
      }),
    )
    assert.equal(added.status, 201)

    const denied = await app.request(
      `/workspaces/${workspace.id}/nodes`,
      auth(bo.token, {
        method: "POST",
        body: JSON.stringify({ parentId: null, kind: "file", name: "secret.md" }),
      }),
    )
    assert.equal(denied.status, 403)

    const listed = await app.request(`/workspaces/${workspace.id}/nodes`, auth(bo.token))
    assert.equal(listed.status, 200)
  } finally {
    close()
  }
})

test("renaming a file rewrites links in other markdown files", async () => {
  const { app, close } = await boot()
  try {
    const ana = await register(app, "ana@example.com")
    const { workspace } = (await (
      await app.request("/workspaces", auth(ana.token, { method: "POST", body: JSON.stringify({ name: "Notes" }) }))
    ).json()) as { workspace: { id: string } }
    const base = `/workspaces/${workspace.id}/nodes`
    const linked = (await (
      await app.request(
        base,
        auth(ana.token, {
          method: "POST",
          body: JSON.stringify({ parentId: null, kind: "file", name: "index.md", content: "See [weekly](weekly.md)." }),
        }),
      )
    ).json()) as { node: { id: string } }
    const target = (await (
      await app.request(
        base,
        auth(ana.token, {
          method: "POST",
          body: JSON.stringify({ parentId: null, kind: "file", name: "weekly.md", content: "week" }),
        }),
      )
    ).json()) as { node: { id: string } }

    const renamed = await app.request(
      `${base}/${target.node.id}`,
      auth(ana.token, { method: "PATCH", body: JSON.stringify({ name: "archive.md" }) }),
    )
    assert.equal(renamed.status, 200)

    const content = await app.request(`${base}/${linked.node.id}/content`, auth(ana.token))
    const body = (await content.json()) as { content: string }
    assert.equal(body.content, "See [weekly](archive.md).")
  } finally {
    close()
  }
})
