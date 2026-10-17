import {
  addMemberBody,
  createNodeBody,
  createWorkspaceBody,
  loginBody,
  patchMemberBody,
  patchNodeBody,
  putContentBody,
  registerBody,
  shareNodeBody,
  createLinkBody,
} from "@opencharta/shared"
import { Hono } from "hono"
import { cors } from "hono/cors"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { upgradeWebSocket } from "@hono/node-server"
import { z } from "zod"
import { CollabHub } from "./collab"
import type { Db } from "./db/client"
import { AppError } from "./lib/errors"
import { hashPassword } from "./lib/crypto"
import { WorkspaceStore } from "./store"

type Vars = { userId: string }

export function createApp(db: Db, collab = new CollabHub(new WorkspaceStore(db))) {
  const store = new WorkspaceStore(db)
  const app = new Hono<{ Variables: Vars }>()

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json(
        { error: { code: error.code, message: error.message, details: error.details } },
        error.status as ContentfulStatusCode,
      )
    }
    console.error(error)
    return c.json({ error: { code: "internal", message: "Something went wrong." } }, 500)
  })

  app.use("*", async (c, next) => {
    if (c.req.path.endsWith("/collab")) return next()
    return cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"] })(c, next)
  })

  app.get("/health", (c) => c.json({ ok: true, name: "opencharta" }))

  app.post("/auth/register", async (c) => {
    const body = parse(registerBody, await c.req.json().catch(() => null))
    const passwordHash = await hashPassword(body.password)
    return c.json(await store.register({ email: body.email, name: body.name, passwordHash }))
  })

  app.post("/auth/login", async (c) => {
    const body = parse(loginBody, await c.req.json().catch(() => null))
    return c.json(await store.login(body.email, body.password))
  })

  app.post("/auth/logout", (c) => {
    const token = bearer(c.req.header("authorization"))
    if (token) store.logout(token)
    return c.json({ ok: true })
  })

  app.get("/auth/me", (c) => {
    return c.json({ user: requireUser(c, store) })
  })

  app.get("/workspaces", (c) => {
    const user = requireUser(c, store)
    return c.json({ workspaces: store.listWorkspaces(user.id) })
  })

  app.post("/workspaces", async (c) => {
    const user = requireUser(c, store)
    const body = parse(createWorkspaceBody, await c.req.json().catch(() => null))
    return c.json({ workspace: store.createWorkspace(user.id, body.name) }, 201)
  })

  app.get("/workspaces/:workspaceId", (c) => {
    const user = requireUser(c, store)
    return c.json({ workspace: store.getWorkspace(user.id, c.req.param("workspaceId")) })
  })

  app.delete("/workspaces/:workspaceId", (c) => {
    const user = requireUser(c, store)
    store.deleteWorkspace(user.id, c.req.param("workspaceId"))
    return c.json({ ok: true })
  })

  app.get("/workspaces/:workspaceId/members", (c) => {
    const user = requireUser(c, store)
    return c.json({ members: store.listMembers(user.id, c.req.param("workspaceId")) })
  })

  app.post("/workspaces/:workspaceId/members", async (c) => {
    const user = requireUser(c, store)
    const body = parse(addMemberBody, await c.req.json().catch(() => null))
    return c.json({ members: store.addMember(user.id, c.req.param("workspaceId"), body.email, body.role) }, 201)
  })

  app.patch("/workspaces/:workspaceId/members/:userId", async (c) => {
    const user = requireUser(c, store)
    const body = parse(patchMemberBody, await c.req.json().catch(() => null))
    store.updateMember(user.id, c.req.param("workspaceId"), c.req.param("userId"), body.role)
    return c.json({ members: store.listMembers(user.id, c.req.param("workspaceId")) })
  })

  app.delete("/workspaces/:workspaceId/members/:userId", (c) => {
    const user = requireUser(c, store)
    store.removeMember(user.id, c.req.param("workspaceId"), c.req.param("userId"))
    return c.json({ ok: true })
  })

  app.get("/workspaces/:workspaceId/nodes", (c) => {
    const user = requireUser(c, store)
    return c.json({ nodes: store.listNodes(user.id, c.req.param("workspaceId")) })
  })

  app.post("/workspaces/:workspaceId/nodes", async (c) => {
    const user = requireUser(c, store)
    const body = parse(createNodeBody, await c.req.json().catch(() => null))
    const node = store.createNode(user.id, c.req.param("workspaceId"), body)
    return c.json({ node }, 201)
  })

  app.patch("/workspaces/:workspaceId/nodes/:nodeId", async (c) => {
    const user = requireUser(c, store)
    const body = parse(patchNodeBody, await c.req.json().catch(() => null))
    const node = store.updateNode(user.id, c.req.param("workspaceId"), c.req.param("nodeId"), body)
    return c.json({ node })
  })

  app.delete("/workspaces/:workspaceId/nodes/:nodeId", (c) => {
    const user = requireUser(c, store)
    store.deleteNode(user.id, c.req.param("workspaceId"), c.req.param("nodeId"))
    return c.json({ ok: true })
  })

  app.get("/workspaces/:workspaceId/nodes/:nodeId/shares", (c) => {
    const user = requireUser(c, store)
    return c.json({ shares: store.listShares(user.id, c.req.param("workspaceId"), c.req.param("nodeId")) })
  })

  app.post("/workspaces/:workspaceId/nodes/:nodeId/shares", async (c) => {
    const user = requireUser(c, store)
    const body = parse(shareNodeBody, await c.req.json().catch(() => null))
    const shares = store.shareNode(user.id, c.req.param("workspaceId"), c.req.param("nodeId"), body.email, body.role)
    return c.json({ shares }, 201)
  })

  app.delete("/workspaces/:workspaceId/nodes/:nodeId/shares/:userId", (c) => {
    const user = requireUser(c, store)
    store.unshareNode(user.id, c.req.param("workspaceId"), c.req.param("nodeId"), c.req.param("userId"))
    return c.json({ ok: true })
  })

  app.get("/workspaces/:workspaceId/nodes/:nodeId/links", (c) => {
    const user = requireUser(c, store)
    return c.json({ links: store.listLinks(user.id, c.req.param("workspaceId"), c.req.param("nodeId")) })
  })

  app.post("/workspaces/:workspaceId/nodes/:nodeId/links", async (c) => {
    const user = requireUser(c, store)
    const body = parse(createLinkBody, await c.req.json().catch(() => null))
    const { token, link } = store.createLink(user.id, c.req.param("workspaceId"), c.req.param("nodeId"), body.role)
    const url = new URL(`/l/${token}`, c.req.url).toString()
    return c.json({ link: { ...link, url } }, 201)
  })

  app.delete("/workspaces/:workspaceId/nodes/:nodeId/links/:linkId", (c) => {
    const user = requireUser(c, store)
    store.revokeLink(user.id, c.req.param("workspaceId"), c.req.param("nodeId"), c.req.param("linkId"))
    return c.json({ ok: true })
  })

  app.post("/links/:token/accept", (c) => {
    const user = requireUser(c, store)
    return c.json(store.acceptLink(user.id, c.req.param("token")))
  })

  // Opening a share link in a browser explains where it goes. The app accepts the pasted link.
  app.get("/l/:token", (c) =>
    c.html(
      `<!doctype html><meta charset="utf-8"><title>OpenCharta link</title>` +
        `<body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">` +
        `<h1 style="font-weight:500">Open this in OpenCharta</h1>` +
        `<p>Copy this page's address, then in the OpenCharta app choose <b>Open a link</b> and paste it.</p></body>`,
    ),
  )

  app.get("/workspaces/:workspaceId/nodes/:nodeId/content", (c) => {
    const user = requireUser(c, store)
    return c.json(store.getContent(user.id, c.req.param("workspaceId"), c.req.param("nodeId")))
  })

  app.put("/workspaces/:workspaceId/nodes/:nodeId/content", async (c) => {
    const user = requireUser(c, store)
    const workspaceId = c.req.param("workspaceId")
    const nodeId = c.req.param("nodeId")
    if (collab.isActive(nodeId)) {
      const current = store.getContent(user.id, workspaceId, nodeId)
      throw new AppError(409, "editing", "This file is open for editing.", current)
    }
    const body = parse(putContentBody, await c.req.json().catch(() => null))
    return c.json(store.putContent(user.id, workspaceId, nodeId, body.content, body.baseRevision))
  })

  app.get("/workspaces/:workspaceId/nodes/:nodeId/revisions", (c) => {
    const user = requireUser(c, store)
    return c.json({
      revisions: store.listRevisions(user.id, c.req.param("workspaceId"), c.req.param("nodeId")),
    })
  })

  app.get("/workspaces/:workspaceId/nodes/:nodeId/revisions/:revision", (c) => {
    const user = requireUser(c, store)
    return c.json(
      store.getRevision(
        user.id,
        c.req.param("workspaceId"),
        c.req.param("nodeId"),
        numberParam(c.req.param("revision")),
      ),
    )
  })

  app.post("/workspaces/:workspaceId/nodes/:nodeId/revisions/:revision/restore", (c) => {
    const user = requireUser(c, store)
    return c.json(
      store.restoreRevision(
        user.id,
        c.req.param("workspaceId"),
        c.req.param("nodeId"),
        numberParam(c.req.param("revision")),
      ),
    )
  })

  app.get("/workspaces/:workspaceId/changes", (c) => {
    const user = requireUser(c, store)
    const since = Number(c.req.query("since") ?? "0")
    return c.json(store.listChanges(user.id, c.req.param("workspaceId"), Number.isFinite(since) ? since : 0))
  })

  app.get(
    "/workspaces/:workspaceId/collab",
    (c, next) => {
      const token = c.req.query("token") ?? ""
      const user = token ? store.userForToken(token) : null
      if (!user) return c.json({ error: { code: "unauthorized", message: "Sign in required." } }, 401)
      c.set("userId", user.id)
      return next()
    },
    upgradeWebSocket((c) => {
      const workspaceId = c.req.param("workspaceId") ?? ""
      const nodeId = c.req.query("nodeId") ?? ""
      const actorId = c.get("userId")
      if (!actorId) return { onOpen() {}, onMessage() {}, onClose() {} }
      const userId: string = actorId
      let connId = ""
      return {
        onOpen(_event, ws) {
          try {
            const { node, role, name } = store.collabNode(userId, workspaceId, nodeId)
            connId = collab.join({
              nodeId,
              userId,
              name,
              role,
              yjsState: node.yjsState,
              content: node.content,
              send: (message) => ws.send(JSON.stringify(message)),
            })
          } catch (error) {
            const message = error instanceof AppError ? error.message : "Could not open the file."
            ws.send(JSON.stringify({ type: "error", message }))
            ws.close()
          }
        },
        onMessage(event) {
          collab.message(connId, String(event.data))
        },
        onClose() {
          collab.leave(connId)
        },
      }
    }),
  )

  return { app, store, collab }
}

function requireUser(c: { req: { header: (name: string) => string | undefined } }, store: WorkspaceStore) {
  const token = bearer(c.req.header("authorization"))
  if (!token) throw new AppError(401, "unauthorized", "Sign in required.")
  const user = store.userForToken(token)
  if (!user) throw new AppError(401, "unauthorized", "Sign in required.")
  return user
}

function bearer(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return null
  return header.slice("Bearer ".length).trim()
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new AppError(400, "invalid", "Check the fields and try again.", result.error.flatten())
  }
  return result.data
}

function numberParam(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new AppError(400, "invalid", "That version is not valid.")
  return parsed
}
