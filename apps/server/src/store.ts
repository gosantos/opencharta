import {
  REVISION_LIMIT,
  normalizeFileName,
  rewriteMarkdownLinks,
  roleAtLeast,
  validateNodeName,
  type ChangeOp,
  type ChangeRecord,
  type Comment,
  type ConflictDetails,
  type Member,
  type NodeKind,
  type NodeShare,
  type Role,
  type ShareLink,
  type ShareRole,
  type User,
  type Workspace,
  type WorkspaceNode,
} from "@opencharta/shared"
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm"
import { changes, comments, memberships, nodeShares, nodes, shareLinks, revisions, sessions, users, workspaces } from "./db/schema"
import type { Db } from "./db/client"
import { AppError } from "./lib/errors"
import { hashToken, newId, newToken, sha256, verifyPassword } from "./lib/crypto"
import { freshMarkdownState, readMarkdownState } from "./lib/yjs"

type NodeRow = typeof nodes.$inferSelect

const SESSION_MS = 30 * 24 * 60 * 60 * 1000

export class WorkspaceStore {
  constructor(private readonly db: Db) {}

  async register(input: { email: string; name: string; passwordHash: string }) {
    const now = Date.now()
    const user = {
      id: newId(),
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      createdAt: now,
    }
    try {
      this.db.insert(users).values(user).run()
    } catch (error) {
      if (isUnique(error)) throw new AppError(409, "email_taken", "That email is already registered.")
      throw error
    }
    const token = this.createSession(user.id, now)
    return { token, user: publicUser(user) }
  }

  async login(email: string, password: string) {
    const user = this.db.select().from(users).where(eq(users.email, email)).get()
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new AppError(401, "invalid_login", "Email or password is wrong.")
    }
    return { token: this.createSession(user.id, Date.now()), user: publicUser(user) }
  }

  logout(token: string) {
    this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run()
  }

  userForToken(token: string) {
    const now = Date.now()
    const session = this.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get()
    if (!session || session.expiresAt <= now) return null
    const user = this.db.select().from(users).where(eq(users.id, session.userId)).get()
    return user ? publicUser(user) : null
  }

  createWorkspace(userId: string, name: string) {
    const now = Date.now()
    const workspace = {
      id: newId(),
      name,
      slug: this.uniqueSlug(name),
      createdAt: now,
    }
    this.db.transaction((tx) => {
      tx.insert(workspaces).values(workspace).run()
      tx.insert(memberships)
        .values({ workspaceId: workspace.id, userId, role: "owner", createdAt: now })
        .run()
    })
    return this.getWorkspace(userId, workspace.id)
  }

  listWorkspaces(userId: string): Workspace[] {
    const rows = this.db
      .select({ workspace: workspaces, role: memberships.role })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, userId))
      .all()
    const member: Workspace[] = rows.map((row) => ({
      id: row.workspace.id,
      name: row.workspace.name,
      slug: row.workspace.slug,
      role: row.role as Role,
      shared: false,
      createdAt: iso(row.workspace.createdAt),
    }))
    const memberIds = new Set(member.map((workspace) => workspace.id))
    const sharedIds = [
      ...new Set(
        this.db
          .select({ workspaceId: nodeShares.workspaceId })
          .from(nodeShares)
          .where(eq(nodeShares.userId, userId))
          .all()
          .map((row) => row.workspaceId)
          .filter((id) => !memberIds.has(id)),
      ),
    ]
    return [...member, ...sharedIds.map((id) => this.getWorkspace(userId, id))]
  }

  getWorkspace(userId: string, workspaceId: string): Workspace {
    const access = this.access(userId, workspaceId)
    const role = access.bestRole()
    if (!role) throw forbidden()
    const workspace = this.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()
    if (!workspace) throw new AppError(404, "not_found", "Workspace not found.")
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role,
      shared: !access.member,
      createdAt: iso(workspace.createdAt),
    }
  }

  deleteWorkspace(userId: string, workspaceId: string) {
    this.membership(userId, workspaceId, "owner")
    const ids = this.db
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.workspaceId, workspaceId))
      .all()
      .map((row) => row.id)
    this.db.transaction((tx) => {
      for (const id of ids) tx.delete(revisions).where(eq(revisions.nodeId, id)).run()
      tx.delete(nodeShares).where(eq(nodeShares.workspaceId, workspaceId)).run()
      tx.delete(shareLinks).where(eq(shareLinks.workspaceId, workspaceId)).run()
      tx.delete(comments).where(eq(comments.workspaceId, workspaceId)).run()
      tx.delete(changes).where(eq(changes.workspaceId, workspaceId)).run()
      tx.delete(nodes).where(eq(nodes.workspaceId, workspaceId)).run()
      tx.delete(memberships).where(eq(memberships.workspaceId, workspaceId)).run()
      tx.delete(workspaces).where(eq(workspaces.id, workspaceId)).run()
    })
  }

  listMembers(userId: string, workspaceId: string): Member[] {
    this.membership(userId, workspaceId, "viewer")
    const rows = this.db
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, workspaceId))
      .all()
    return rows
      .map((row) => ({
        userId: row.user.id,
        email: row.user.email,
        name: row.user.name,
        role: row.membership.role as Role,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  addMember(actorId: string, workspaceId: string, email: string, role: Role) {
    this.membership(actorId, workspaceId, "admin")
    if (role === "owner") throw new AppError(403, "forbidden", "Transfer ownership separately.")
    const user = this.db.select().from(users).where(eq(users.email, email)).get()
    if (!user) throw new AppError(404, "not_found", "No account with that email yet.")
    const existing = this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, user.id)))
      .get()
    if (existing) throw new AppError(409, "already_member", "That person is already in this workspace.")
    this.db
      .insert(memberships)
      .values({ workspaceId, userId: user.id, role, createdAt: Date.now() })
      .run()
    return this.listMembers(actorId, workspaceId)
  }

  updateMember(actorId: string, workspaceId: string, userId: string, role: Role) {
    const actor = this.membership(actorId, workspaceId, "admin")
    if (role === "owner" && actor.role !== "owner") {
      throw new AppError(403, "forbidden", "Only an owner can add another owner.")
    }
    const target = this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
      .get()
    if (!target) throw new AppError(404, "not_found", "That person is not in this workspace.")
    if (target.role === "owner" && role !== "owner") this.assertOtherOwner(workspaceId, userId)
    this.db
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
      .run()
  }

  removeMember(actorId: string, workspaceId: string, userId: string) {
    this.membership(actorId, workspaceId, "admin")
    const target = this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
      .get()
    if (!target) return
    if (target.role === "owner") this.assertOtherOwner(workspaceId, userId)
    this.db
      .delete(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
      .run()
  }

  listNodes(userId: string, workspaceId: string): WorkspaceNode[] {
    const access = this.access(userId, workspaceId)
    if (!access.bestRole()) throw forbidden()
    const rows = this.liveNodes(workspaceId)
    const paths = pathMap(rows)
    const listed: WorkspaceNode[] = []
    for (const row of rows) {
      const role = access.roleFor(row.id)
      if (role || (row.kind === "folder" && access.isAncestorOfShare(row.id))) {
        listed.push(toNode(row, paths.get(row.id) ?? row.name, role))
      }
    }
    return listed
  }

  listShares(userId: string, workspaceId: string, nodeId: string): NodeShare[] {
    this.authorize(userId, workspaceId, nodeId, "viewer")
    this.mustNode(this.db, workspaceId, nodeId)
    return this.db
      .select({ share: nodeShares, user: users })
      .from(nodeShares)
      .innerJoin(users, eq(users.id, nodeShares.userId))
      .where(eq(nodeShares.nodeId, nodeId))
      .all()
      .map((row) => ({
        nodeId,
        userId: row.user.id,
        email: row.user.email,
        name: row.user.name,
        role: row.share.role as ShareRole,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  shareNode(actorId: string, workspaceId: string, nodeId: string, email: string, role: ShareRole) {
    const actorRole = this.authorize(actorId, workspaceId, nodeId, "editor")
    if (!roleAtLeast(actorRole, role)) throw forbidden()
    this.mustNode(this.db, workspaceId, nodeId)
    const user = this.db.select().from(users).where(eq(users.email, email)).get()
    if (!user) throw new AppError(404, "not_found", "No account with that email yet.")
    if (user.id === actorId) throw new AppError(400, "invalid", "You already have access.")
    this.db
      .insert(nodeShares)
      .values({ workspaceId, nodeId, userId: user.id, role, createdBy: actorId, createdAt: Date.now() })
      .onConflictDoUpdate({ target: [nodeShares.nodeId, nodeShares.userId], set: { role } })
      .run()
    return this.listShares(actorId, workspaceId, nodeId)
  }

  listLinks(userId: string, workspaceId: string, nodeId: string): ShareLink[] {
    this.authorize(userId, workspaceId, nodeId, "editor")
    return this.db
      .select({ link: shareLinks, creator: users.name })
      .from(shareLinks)
      .leftJoin(users, eq(users.id, shareLinks.createdBy))
      .where(and(eq(shareLinks.nodeId, nodeId), eq(shareLinks.workspaceId, workspaceId)))
      .orderBy(desc(shareLinks.createdAt))
      .all()
      .map((row) => ({
        id: row.link.id,
        nodeId,
        role: row.link.role as ShareRole,
        createdAt: iso(row.link.createdAt),
        createdByName: row.creator ?? "Unknown",
      }))
  }

  /** Makes a new link and returns its secret once. */
  createLink(userId: string, workspaceId: string, nodeId: string, role: ShareRole) {
    const actorRole = this.authorize(userId, workspaceId, nodeId, "editor")
    if (!roleAtLeast(actorRole, role)) throw forbidden()
    this.mustNode(this.db, workspaceId, nodeId)
    const token = newToken()
    const id = newId()
    const now = Date.now()
    this.db
      .insert(shareLinks)
      .values({ id, workspaceId, nodeId, tokenHash: hashToken(token), role, createdBy: userId, createdAt: now })
      .run()
    const creator = this.db.select().from(users).where(eq(users.id, userId)).get()
    return {
      token,
      link: { id, nodeId, role, createdAt: iso(now), createdByName: creator?.name ?? "Unknown" } as ShareLink,
    }
  }

  revokeLink(userId: string, workspaceId: string, nodeId: string, linkId: string) {
    this.authorize(userId, workspaceId, nodeId, "editor")
    this.db
      .delete(shareLinks)
      .where(and(eq(shareLinks.id, linkId), eq(shareLinks.nodeId, nodeId), eq(shareLinks.workspaceId, workspaceId)))
      .run()
  }

  /** Turns a link into a share for the person opening it. Never lowers access they already have. */
  acceptLink(userId: string, token: string) {
    const link = this.db.select().from(shareLinks).where(eq(shareLinks.tokenHash, hashToken(token))).get()
    if (!link) throw new AppError(404, "not_found", "That link doesn't work anymore.")
    const node = this.db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, link.nodeId), isNull(nodes.deletedAt)))
      .get()
    if (!node) throw new AppError(404, "not_found", "The shared file was deleted.")
    const current = this.access(userId, link.workspaceId).roleFor(link.nodeId)
    if (!current || !roleAtLeast(current, link.role as Role)) {
      this.db
        .insert(nodeShares)
        .values({
          workspaceId: link.workspaceId,
          nodeId: link.nodeId,
          userId,
          role: link.role,
          createdBy: link.createdBy,
          createdAt: Date.now(),
        })
        .onConflictDoUpdate({ target: [nodeShares.nodeId, nodeShares.userId], set: { role: link.role } })
        .run()
    }
    return {
      workspace: this.getWorkspace(userId, link.workspaceId),
      node: this.nodeById(userId, link.workspaceId, link.nodeId),
    }
  }

  listComments(userId: string, workspaceId: string, nodeId: string): Comment[] {
    this.authorize(userId, workspaceId, nodeId, "viewer")
    this.mustFile(this.db, workspaceId, nodeId)
    return this.db
      .select({ comment: comments, author: users.name })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .where(and(eq(comments.nodeId, nodeId), eq(comments.workspaceId, workspaceId)))
      .orderBy(comments.createdAt)
      .all()
      .map((row) => toComment(row.comment, row.author))
  }

  /** Anyone who can read a file can comment on it. */
  addComment(
    userId: string,
    workspaceId: string,
    nodeId: string,
    input: { body: string; quote?: string; parentId?: string | null },
  ) {
    this.authorize(userId, workspaceId, nodeId, "viewer")
    this.mustFile(this.db, workspaceId, nodeId)
    let quote = input.quote ?? ""
    if (input.parentId) {
      const parent = this.mustComment(workspaceId, nodeId, input.parentId)
      if (parent.parentId) throw new AppError(400, "invalid", "Reply to the first comment in the thread.")
      quote = ""
      this.db.update(comments).set({ resolvedAt: null }).where(eq(comments.id, parent.id)).run()
    }
    const now = Date.now()
    const id = newId()
    this.db
      .insert(comments)
      .values({
        id,
        workspaceId,
        nodeId,
        parentId: input.parentId ?? null,
        authorId: userId,
        body: input.body,
        quote,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return this.commentById(id)
  }

  /** Authors edit their own words. Resolving a thread takes the author or someone who can edit the file. */
  updateComment(
    userId: string,
    workspaceId: string,
    nodeId: string,
    commentId: string,
    input: { body?: string; resolved?: boolean },
  ) {
    const role = this.authorize(userId, workspaceId, nodeId, "viewer")
    const comment = this.mustComment(workspaceId, nodeId, commentId)
    const isAuthor = comment.authorId === userId
    if (input.body !== undefined && !isAuthor) throw forbidden()
    if (input.resolved !== undefined) {
      if (comment.parentId) throw new AppError(400, "invalid", "Resolve the thread, not a reply.")
      if (!isAuthor && !roleAtLeast(role, "editor")) throw forbidden()
    }
    const now = Date.now()
    this.db
      .update(comments)
      .set({
        ...(input.body !== undefined ? { body: input.body, updatedAt: now } : {}),
        ...(input.resolved !== undefined ? { resolvedAt: input.resolved ? now : null } : {}),
      })
      .where(eq(comments.id, commentId))
      .run()
    return this.commentById(commentId)
  }

  /** Authors can delete their comments, and editors can delete any. Deleting a thread removes its replies. */
  deleteComment(userId: string, workspaceId: string, nodeId: string, commentId: string) {
    const role = this.authorize(userId, workspaceId, nodeId, "viewer")
    const comment = this.mustComment(workspaceId, nodeId, commentId)
    if (comment.authorId !== userId && !roleAtLeast(role, "editor")) throw forbidden()
    this.db.transaction((tx) => {
      tx.delete(comments).where(eq(comments.parentId, commentId)).run()
      tx.delete(comments).where(eq(comments.id, commentId)).run()
    })
  }

  private mustComment(workspaceId: string, nodeId: string, commentId: string) {
    const comment = this.db
      .select()
      .from(comments)
      .where(and(eq(comments.id, commentId), eq(comments.nodeId, nodeId), eq(comments.workspaceId, workspaceId)))
      .get()
    if (!comment) throw new AppError(404, "not_found", "That comment is gone.")
    return comment
  }

  private commentById(id: string) {
    const row = this.db
      .select({ comment: comments, author: users.name })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.id, id))
      .get()
    if (!row) throw new AppError(404, "not_found", "That comment is gone.")
    return toComment(row.comment, row.author)
  }

  unshareNode(actorId: string, workspaceId: string, nodeId: string, userId: string) {
    if (actorId !== userId) this.authorize(actorId, workspaceId, nodeId, "editor")
    this.db
      .delete(nodeShares)
      .where(and(eq(nodeShares.nodeId, nodeId), eq(nodeShares.userId, userId), eq(nodeShares.workspaceId, workspaceId)))
      .run()
  }

  createNode(
    userId: string,
    workspaceId: string,
    input: { parentId: string | null; kind: NodeKind; name: string; content?: string },
  ) {
    this.authorize(userId, workspaceId, input.parentId, "editor")
    const name = input.kind === "file" ? normalizeFileName(input.name) : input.name.trim()
    const invalid = validateNodeName(name)
    if (invalid) throw new AppError(400, "invalid", invalid)
    const content = input.kind === "file" ? (input.content ?? "") : ""
    const now = Date.now()
    const id = newId()
    this.db.transaction((tx) => {
      this.assertParent(tx, workspaceId, input.parentId)
      this.assertUniqueName(tx, workspaceId, input.parentId, name)
      const hash = input.kind === "file" ? sha256(content) : ""
      tx.insert(nodes)
        .values({
          id,
          workspaceId,
          parentId: input.parentId,
          kind: input.kind,
          name,
          revision: input.kind === "file" ? 1 : 0,
          content,
          contentHash: hash,
          yjsState: input.kind === "file" ? freshMarkdownState(content) : null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          createdBy: userId,
        })
        .run()
      if (input.kind === "file") {
        tx.insert(revisions)
          .values({
            nodeId: id,
            revision: 1,
            content,
            contentHash: hash,
            authorId: userId,
            createdAt: now,
          })
          .run()
      }
      const created = tx.select().from(nodes).where(eq(nodes.id, id)).get()
      if (!created) throw new AppError(500, "internal", "Could not create the file.")
      this.emit(
        tx,
        workspaceId,
        "create",
        id,
        nodePayload(created, this.paths(tx, workspaceId).get(created.id) ?? created.name),
        userId,
        now,
      )
    })
    return this.nodeById(userId, workspaceId, id)
  }

  updateNode(
    userId: string,
    workspaceId: string,
    nodeId: string,
    input: { name?: string; parentId?: string | null },
  ) {
    this.authorize(userId, workspaceId, nodeId, "editor")
    this.db.transaction((tx) => {
      const node = this.mustNode(tx, workspaceId, nodeId)
      const parentId = input.parentId === undefined ? node.parentId : input.parentId
      if (parentId !== node.parentId) this.authorize(userId, workspaceId, parentId, "editor")
      const name = input.name
        ? node.kind === "file"
          ? normalizeFileName(input.name)
          : input.name.trim()
        : node.name
      const invalid = validateNodeName(name)
      if (invalid) throw new AppError(400, "invalid", invalid)
      if (parentId === nodeId || this.isDescendant(tx, workspaceId, nodeId, parentId)) {
        throw new AppError(400, "invalid", "A folder cannot be moved into itself.")
      }
      this.assertParent(tx, workspaceId, parentId)
      this.assertUniqueName(tx, workspaceId, parentId, name, nodeId)
      const before = this.paths(tx, workspaceId)
      const now = Date.now()
      tx.update(nodes).set({ name, parentId, updatedAt: now }).where(eq(nodes.id, nodeId)).run()
      const after = this.paths(tx, workspaceId)
      const affected = descendantIds(this.liveNodesIn(tx, workspaceId), nodeId)
      affected.add(nodeId)
      const moves = [...affected]
        .map((id) => ({ from: before.get(id) ?? "", to: after.get(id) ?? "" }))
        .filter((move) => move.from && move.from !== move.to)
      this.emit(tx, workspaceId, "move", nodeId, { name, parentId, path: after.get(nodeId) ?? name }, userId, now)
      if (moves.length) this.rewriteLinks(tx, workspaceId, moves, userId, now)
    })
    return this.nodeById(userId, workspaceId, nodeId)
  }

  deleteNode(userId: string, workspaceId: string, nodeId: string) {
    this.authorize(userId, workspaceId, nodeId, "editor")
    const now = Date.now()
    this.db.transaction((tx) => {
      const node = tx
        .select()
        .from(nodes)
        .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId)))
        .get()
      if (!node || node.deletedAt) return
      const live = this.liveNodesIn(tx, workspaceId)
      const ids = [...descendantIds(live, nodeId), nodeId]
      const paths = pathMap(live)
      const ordered = ids.sort((a, b) => (paths.get(b)?.length ?? 0) - (paths.get(a)?.length ?? 0))
      for (const id of ordered) {
        tx.update(nodes).set({ deletedAt: now, updatedAt: now }).where(eq(nodes.id, id)).run()
        this.emit(tx, workspaceId, "delete", id, { path: paths.get(id) ?? "" }, userId, now)
      }
    })
  }

  getContent(userId: string, workspaceId: string, nodeId: string) {
    this.authorize(userId, workspaceId, nodeId, "viewer")
    const node = this.db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .get()
    if (!node || node.kind !== "file") throw new AppError(404, "not_found", "File not found.")
    const checkpoint = this.checkpointOf(node)
    return {
      nodeId: node.id,
      revision: node.revision,
      content: checkpoint.content,
      contentHash: checkpoint.hash,
    }
  }

  putContent(userId: string, workspaceId: string, nodeId: string, content: string, baseRevision: number) {
    this.authorize(userId, workspaceId, nodeId, "editor")
    return this.db.transaction((tx) => {
      const node = this.mustFile(tx, workspaceId, nodeId)
      const checkpoint = this.checkpointOf(node, tx)
      const live = readMarkdownState(node.yjsState, node.content)
      if (sha256(live) !== checkpoint.hash || node.revision !== baseRevision) {
        throw conflict(node.id, node.revision, checkpoint.content, checkpoint.hash)
      }
      const revision = this.checkpoint(tx, node, content, userId, freshMarkdownState(content), Date.now())
      return { nodeId, revision, contentHash: sha256(content) }
    })
  }

  listRevisions(userId: string, workspaceId: string, nodeId: string) {
    this.authorize(userId, workspaceId, nodeId, "viewer")
    this.mustFile(this.db, workspaceId, nodeId)
    const rows = this.db
      .select({
        revision: revisions.revision,
        contentHash: revisions.contentHash,
        authorId: revisions.authorId,
        authorName: users.name,
        createdAt: revisions.createdAt,
        byteLength: sql<number>`length(${revisions.content})`,
      })
      .from(revisions)
      .leftJoin(users, eq(users.id, revisions.authorId))
      .where(eq(revisions.nodeId, nodeId))
      .orderBy(desc(revisions.revision))
      .all()
    return rows.map((row) => ({
      revision: row.revision,
      contentHash: row.contentHash,
      authorId: row.authorId,
      authorName: row.authorName ?? "Unknown",
      createdAt: iso(row.createdAt),
      byteLength: Number(row.byteLength ?? 0),
    }))
  }

  getRevision(userId: string, workspaceId: string, nodeId: string, revision: number) {
    this.authorize(userId, workspaceId, nodeId, "viewer")
    this.mustFile(this.db, workspaceId, nodeId)
    const row = this.db
      .select()
      .from(revisions)
      .where(and(eq(revisions.nodeId, nodeId), eq(revisions.revision, revision)))
      .get()
    if (!row) throw new AppError(404, "not_found", "That version is no longer kept.")
    return { revision: row.revision, content: row.content, contentHash: row.contentHash }
  }

  restoreRevision(userId: string, workspaceId: string, nodeId: string, revision: number) {
    this.authorize(userId, workspaceId, nodeId, "editor")
    return this.db.transaction((tx) => {
      const node = this.mustFile(tx, workspaceId, nodeId)
      const row = tx
        .select()
        .from(revisions)
        .where(and(eq(revisions.nodeId, nodeId), eq(revisions.revision, revision)))
        .get()
      if (!row) throw new AppError(404, "not_found", "That version is no longer kept.")
      const next = this.checkpoint(tx, node, row.content, userId, freshMarkdownState(row.content), Date.now())
      return { nodeId, revision: next }
    })
  }

  listChanges(userId: string, workspaceId: string, since: number) {
    const access = this.access(userId, workspaceId)
    if (!access.bestRole()) throw forbidden()
    const latest = this.db
      .select({ value: sql<number>`coalesce(max(${changes.seq}), 0)` })
      .from(changes)
      .where(eq(changes.workspaceId, workspaceId))
      .get()
    const cursor = Number(latest?.value ?? 0)
    const rows = this.db
      .select()
      .from(changes)
      .where(and(eq(changes.workspaceId, workspaceId), gt(changes.seq, since)))
      .orderBy(changes.seq)
      .limit(1000)
      .all()
    const visible = access.member ? rows : rows.filter((row) => access.roleFor(row.nodeId))
    const records: ChangeRecord[] = visible.map((row) => ({
      seq: row.seq,
      op: row.op as ChangeOp,
      nodeId: row.nodeId,
      actorId: row.actorId,
      createdAt: iso(row.createdAt),
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }))
    return {
      cursor: rows.at(-1)?.seq ?? cursor,
      hasMore: rows.length === 1000,
      changes: records,
    }
  }

  collabNode(userId: string, workspaceId: string, nodeId: string) {
    const role = this.authorize(userId, workspaceId, nodeId, "viewer")
    const node = this.db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .get()
    if (!node || node.kind !== "file") throw new AppError(404, "not_found", "File not found.")
    const user = this.db.select().from(users).where(eq(users.id, userId)).get()
    return { node, role, name: user?.name ?? "Someone" }
  }

  saveLive(nodeId: string, content: string, yjsState: Buffer) {
    this.db
      .update(nodes)
      .set({ content, yjsState, updatedAt: Date.now() })
      .where(eq(nodes.id, nodeId))
      .run()
  }

  checkpointLive(nodeId: string, authorId: string, content: string, yjsState: Buffer) {
    return this.db.transaction((tx) => {
      const node = tx.select().from(nodes).where(eq(nodes.id, nodeId)).get()
      if (!node || node.deletedAt || node.kind !== "file") return node?.revision ?? 0
      return this.checkpoint(tx, node, content, authorId, yjsState, Date.now())
    })
  }

  checkpointDirtyDocuments() {
    const rows = this.db.select().from(nodes).where(and(eq(nodes.kind, "file"), isNull(nodes.deletedAt))).all()
    for (const node of rows) {
      const live = readMarkdownState(node.yjsState, node.content)
      if (sha256(live) === node.contentHash) continue
      this.db.transaction((tx) => {
        const fresh = tx.select().from(nodes).where(eq(nodes.id, node.id)).get()
        if (!fresh) return
        this.checkpoint(tx, fresh, live, fresh.createdBy, fresh.yjsState ?? freshMarkdownState(live), Date.now())
      })
    }
  }

  private createSession(userId: string, now: number) {
    const token = newToken()
    this.db
      .insert(sessions)
      .values({
        id: newId(),
        userId,
        tokenHash: hashToken(token),
        createdAt: now,
        expiresAt: now + SESSION_MS,
      })
      .run()
    return token
  }

  private membership(userId: string, workspaceId: string, minimum: Role) {
    const membership = this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
      .get()
    if (!membership || !roleAtLeast(membership.role as Role, minimum)) {
      throw new AppError(403, "forbidden", "You do not have access to do that.")
    }
    return { ...membership, role: membership.role as Role }
  }

  private access(userId: string, workspaceId: string) {
    const membership = this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
      .get()
    const shares = this.db
      .select()
      .from(nodeShares)
      .where(and(eq(nodeShares.workspaceId, workspaceId), eq(nodeShares.userId, userId)))
      .all()
    const loadParents = () =>
      new Map(
        this.db
          .select({ id: nodes.id, parentId: nodes.parentId })
          .from(nodes)
          .where(eq(nodes.workspaceId, workspaceId))
          .all()
          .map((row) => [row.id, row.parentId]),
      )
    return new Access(
      (membership?.role as Role | undefined) ?? null,
      new Map(shares.map((share) => [share.nodeId, share.role as Role])),
      loadParents,
    )
  }

  /** Throws unless the person has at least `minimum` on the node, or on the workspace root when nodeId is null. */
  private authorize(userId: string, workspaceId: string, nodeId: string | null, minimum: Role) {
    const role = this.access(userId, workspaceId).roleFor(nodeId)
    if (!role || !roleAtLeast(role, minimum)) throw forbidden()
    return role
  }

  private assertOtherOwner(workspaceId: string, exceptUserId: string) {
    const owners = this.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, "owner")))
      .all()
    if (owners.filter((owner) => owner.userId !== exceptUserId).length === 0) {
      throw new AppError(409, "last_owner", "A workspace needs at least one owner.")
    }
  }

  private uniqueSlug(name: string) {
    const base =
      name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "workspace"
    let slug = base
    let n = 2
    while (this.db.select().from(workspaces).where(eq(workspaces.slug, slug)).get()) {
      slug = `${base}-${n}`
      n += 1
    }
    return slug
  }

  private liveNodes(workspaceId: string) {
    return this.db
      .select()
      .from(nodes)
      .where(and(eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .all()
  }

  private liveNodesIn(tx: Tx, workspaceId: string) {
    return tx
      .select()
      .from(nodes)
      .where(and(eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .all()
  }

  private paths(tx: Tx, workspaceId: string) {
    return pathMap(this.liveNodesIn(tx, workspaceId))
  }

  private nodeById(userId: string, workspaceId: string, nodeId: string) {
    const node = this.listNodes(userId, workspaceId).find((item) => item.id === nodeId)
    if (!node) throw new AppError(404, "not_found", "File not found.")
    return node
  }

  private mustNode(tx: Tx | Db, workspaceId: string, nodeId: string) {
    const node = tx
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .get()
    if (!node) throw new AppError(404, "not_found", "File not found.")
    return node
  }

  private mustFile(tx: Tx | Db, workspaceId: string, nodeId: string) {
    const node = tx
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, nodeId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .get()
    if (!node || node.kind !== "file") throw new AppError(404, "not_found", "File not found.")
    return node
  }

  private assertParent(tx: Tx, workspaceId: string, parentId: string | null) {
    if (!parentId) return
    const parent = tx
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, parentId), eq(nodes.workspaceId, workspaceId), isNull(nodes.deletedAt)))
      .get()
    if (!parent || parent.kind !== "folder") throw new AppError(400, "invalid", "Choose a folder to put this in.")
  }

  private assertUniqueName(tx: Tx, workspaceId: string, parentId: string | null, name: string, exceptId?: string) {
    const siblings = tx
      .select()
      .from(nodes)
      .where(
        and(
          eq(nodes.workspaceId, workspaceId),
          parentId ? eq(nodes.parentId, parentId) : isNull(nodes.parentId),
          isNull(nodes.deletedAt),
        ),
      )
      .all()
    const taken = siblings.some(
      (sibling) => sibling.id !== exceptId && sibling.name.toLowerCase() === name.toLowerCase(),
    )
    if (taken) throw new AppError(409, "name_taken", "A file with that name is already in this folder.")
  }

  private isDescendant(tx: Tx, workspaceId: string, nodeId: string, parentId: string | null) {
    if (!parentId) return false
    const live = this.liveNodesIn(tx, workspaceId)
    return descendantIds(live, nodeId).has(parentId)
  }

  private checkpointOf(node: NodeRow, tx: Tx | Db = this.db) {
    if (node.revision === 0) return { content: "", hash: sha256("") }
    const row = tx
      .select()
      .from(revisions)
      .where(and(eq(revisions.nodeId, node.id), eq(revisions.revision, node.revision)))
      .get()
    return {
      content: row?.content ?? "",
      hash: row?.contentHash ?? sha256(""),
    }
  }

  private checkpoint(tx: Tx, node: NodeRow, content: string, authorId: string, yjsState: Buffer, now: number) {
    const hash = sha256(content)
    if (hash === node.contentHash && node.revision > 0) {
      tx.update(nodes).set({ content, yjsState, updatedAt: now }).where(eq(nodes.id, node.id)).run()
      return node.revision
    }
    const revision = node.revision + 1
    tx.update(nodes)
      .set({ content, contentHash: hash, revision, yjsState, updatedAt: now })
      .where(eq(nodes.id, node.id))
      .run()
    tx.insert(revisions)
      .values({ nodeId: node.id, revision, content, contentHash: hash, authorId, createdAt: now })
      .run()
    const stale = tx
      .select()
      .from(revisions)
      .where(eq(revisions.nodeId, node.id))
      .orderBy(desc(revisions.revision))
      .all()
    for (const row of stale.slice(REVISION_LIMIT)) {
      tx.delete(revisions)
        .where(and(eq(revisions.nodeId, node.id), eq(revisions.revision, row.revision)))
        .run()
    }
    const path = this.paths(tx, node.workspaceId).get(node.id) ?? node.name
    this.emit(
      tx,
      node.workspaceId,
      "update",
      node.id,
      { path, revision, contentHash: hash, name: node.name },
      authorId,
      now,
    )
    return revision
  }

  private rewriteLinks(
    tx: Tx,
    workspaceId: string,
    moves: Array<{ from: string; to: string }>,
    actorId: string,
    now: number,
  ) {
    const files = this.liveNodesIn(tx, workspaceId).filter((node) => node.kind === "file")
    for (const file of files) {
      const checkpoint = this.checkpointOf(file, tx)
      const next = rewriteMarkdownLinks(checkpoint.content, moves)
      if (next === checkpoint.content) continue
      const current = tx.select().from(nodes).where(eq(nodes.id, file.id)).get()
      if (!current) continue
      this.checkpoint(tx, current, next, actorId, freshMarkdownState(next), now)
    }
  }

  private emit(
    tx: Tx,
    workspaceId: string,
    op: ChangeOp,
    nodeId: string,
    payload: Record<string, unknown>,
    actorId: string,
    now: number,
  ) {
    const latest = tx
      .select({ value: sql<number>`coalesce(max(${changes.seq}), 0)` })
      .from(changes)
      .where(eq(changes.workspaceId, workspaceId))
      .get()
    tx.insert(changes)
      .values({
        workspaceId,
        seq: Number(latest?.value ?? 0) + 1,
        op,
        nodeId,
        payload: JSON.stringify(payload),
        actorId,
        createdAt: now,
      })
      .run()
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

function publicUser(user: { id: string; email: string; name: string }): User {
  return { id: user.id, email: user.email, name: user.name }
}

function iso(ms: number) {
  return new Date(ms).toISOString()
}

function pathMap(rows: NodeRow[]) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const cache = new Map<string, string>()
  const visit = (id: string, seen = new Set<string>()): string => {
    const cached = cache.get(id)
    if (cached) return cached
    const node = byId.get(id)
    if (!node || seen.has(id)) return ""
    seen.add(id)
    const path = node.parentId ? `${visit(node.parentId, seen)}/${node.name}` : node.name
    cache.set(id, path)
    return path
  }
  for (const row of rows) visit(row.id)
  return cache
}

function descendantIds(rows: NodeRow[], rootId: string) {
  const children = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.parentId) continue
    const list = children.get(row.parentId) ?? []
    list.push(row.id)
    children.set(row.parentId, list)
  }
  const ids = new Set<string>()
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      ids.add(child)
      walk(child)
    }
  }
  walk(rootId)
  return ids
}

function toNode(row: NodeRow, path: string, role: Role | null): WorkspaceNode {
  return {
    id: row.id,
    parentId: row.parentId,
    kind: row.kind as NodeKind,
    name: row.name,
    path,
    revision: row.revision,
    contentHash: row.contentHash,
    updatedAt: iso(row.updatedAt),
    role,
  }
}

function nodePayload(row: NodeRow, path: string) {
  return {
    parentId: row.parentId,
    kind: row.kind,
    name: row.name,
    path,
    revision: row.revision,
    contentHash: row.contentHash,
  }
}

function toComment(row: typeof comments.$inferSelect, authorName: string | null): Comment {
  return {
    id: row.id,
    nodeId: row.nodeId,
    parentId: row.parentId,
    authorId: row.authorId,
    authorName: authorName ?? "Unknown",
    body: row.body,
    quote: row.quote,
    resolved: row.resolvedAt !== null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

function forbidden() {
  return new AppError(403, "forbidden", "You do not have access to do that.")
}

/** A person's access in one workspace: their member role, plus shares on single files and folders. */
class Access {
  private parents: Map<string, string | null> | null = null

  constructor(
    readonly member: Role | null,
    private readonly shares: Map<string, Role>,
    private readonly loadParents: () => Map<string, string | null>,
  ) {}

  bestRole(): Role | null {
    let best = this.member
    for (const role of this.shares.values()) best = higher(best, role)
    return best
  }

  roleFor(nodeId: string | null): Role | null {
    let best = this.member
    if (!this.shares.size || !nodeId) return best
    const parents = this.parentMap()
    const seen = new Set<string>()
    let id: string | null = nodeId
    while (id && !seen.has(id)) {
      seen.add(id)
      best = higher(best, this.shares.get(id) ?? null)
      id = parents.get(id) ?? null
    }
    return best
  }

  /** A folder that holds something shared, so the shared item has a place in the tree. */
  isAncestorOfShare(folderId: string) {
    const parents = this.parentMap()
    for (const sharedId of this.shares.keys()) {
      let id = parents.get(sharedId) ?? null
      const seen = new Set<string>()
      while (id && !seen.has(id)) {
        if (id === folderId) return true
        seen.add(id)
        id = parents.get(id) ?? null
      }
    }
    return false
  }

  private parentMap() {
    this.parents ??= this.loadParents()
    return this.parents
  }
}

function higher(a: Role | null, b: Role | null) {
  if (!a) return b
  if (!b) return a
  return roleAtLeast(a, b) ? a : b
}

function conflict(nodeId: string, serverRevision: number, serverContent: string, serverHash: string) {
  const details: ConflictDetails = { nodeId, serverRevision, serverContent, serverHash }
  return new AppError(409, "conflict", "This file changed on the server.", details)
}

function isUnique(error: unknown) {
  return error instanceof Error && /UNIQUE/i.test(error.message)
}
