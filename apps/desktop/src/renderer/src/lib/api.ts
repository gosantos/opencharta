import type { Comment, Member, NodeShare, ShareLink, RevisionSummary, Role, ShareRole, User, Workspace, WorkspaceNode } from "@opencharta/shared"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export class Api {
  constructor(
    private readonly base: string,
    private token: string | null,
  ) {}

  setToken(token: string | null) {
    this.token = token
  }

  me() {
    return this.get<{ user: User }>("/auth/me")
  }

  register(body: { email: string; name: string; password: string }) {
    return this.send<{ token: string; user: User }>("/auth/register", "POST", body)
  }

  login(body: { email: string; password: string }) {
    return this.send<{ token: string; user: User }>("/auth/login", "POST", body)
  }

  logout() {
    return this.send("/auth/logout", "POST")
  }

  workspaces() {
    return this.get<{ workspaces: Workspace[] }>("/workspaces")
  }

  createWorkspace(name: string) {
    return this.send<{ workspace: Workspace }>("/workspaces", "POST", { name })
  }

  members(workspaceId: string) {
    return this.get<{ members: Member[] }>(`/workspaces/${workspaceId}/members`)
  }

  addMember(workspaceId: string, email: string, role: Exclude<Role, "owner">) {
    return this.send<{ members: Member[] }>(`/workspaces/${workspaceId}/members`, "POST", { email, role })
  }

  nodes(workspaceId: string) {
    return this.get<{ nodes: WorkspaceNode[] }>(`/workspaces/${workspaceId}/nodes`)
  }

  createNode(workspaceId: string, body: { parentId: string | null; kind: "file" | "folder"; name: string }) {
    return this.send<{ node: WorkspaceNode }>(`/workspaces/${workspaceId}/nodes`, "POST", body)
  }

  updateNode(workspaceId: string, nodeId: string, body: { name?: string; parentId?: string | null }) {
    return this.send<{ node: WorkspaceNode }>(`/workspaces/${workspaceId}/nodes/${nodeId}`, "PATCH", body)
  }

  deleteNode(workspaceId: string, nodeId: string) {
    return this.send(`/workspaces/${workspaceId}/nodes/${nodeId}`, "DELETE")
  }

  shares(workspaceId: string, nodeId: string) {
    return this.get<{ shares: NodeShare[] }>(`/workspaces/${workspaceId}/nodes/${nodeId}/shares`)
  }

  share(workspaceId: string, nodeId: string, email: string, role: ShareRole) {
    return this.send<{ shares: NodeShare[] }>(`/workspaces/${workspaceId}/nodes/${nodeId}/shares`, "POST", { email, role })
  }

  unshare(workspaceId: string, nodeId: string, userId: string) {
    return this.send(`/workspaces/${workspaceId}/nodes/${nodeId}/shares/${userId}`, "DELETE")
  }

  comments(workspaceId: string, nodeId: string) {
    return this.get<{ comments: Comment[] }>(`/workspaces/${workspaceId}/nodes/${nodeId}/comments`)
  }

  addComment(workspaceId: string, nodeId: string, body: { body: string; quote?: string; parentId?: string }) {
    return this.send<{ comment: Comment }>(`/workspaces/${workspaceId}/nodes/${nodeId}/comments`, "POST", body)
  }

  updateComment(workspaceId: string, nodeId: string, commentId: string, body: { body?: string; resolved?: boolean }) {
    return this.send<{ comment: Comment }>(`/workspaces/${workspaceId}/nodes/${nodeId}/comments/${commentId}`, "PATCH", body)
  }

  deleteComment(workspaceId: string, nodeId: string, commentId: string) {
    return this.send(`/workspaces/${workspaceId}/nodes/${nodeId}/comments/${commentId}`, "DELETE")
  }

  links(workspaceId: string, nodeId: string) {
    return this.get<{ links: ShareLink[] }>(`/workspaces/${workspaceId}/nodes/${nodeId}/links`)
  }

  createLink(workspaceId: string, nodeId: string, role: ShareRole) {
    return this.send<{ link: ShareLink }>(`/workspaces/${workspaceId}/nodes/${nodeId}/links`, "POST", { role })
  }

  revokeLink(workspaceId: string, nodeId: string, linkId: string) {
    return this.send(`/workspaces/${workspaceId}/nodes/${nodeId}/links/${linkId}`, "DELETE")
  }

  acceptLink(token: string) {
    return this.send<{ workspace: Workspace; node: WorkspaceNode }>(`/links/${token}/accept`, "POST")
  }

  revisions(workspaceId: string, nodeId: string) {
    return this.get<{ revisions: RevisionSummary[] }>(`/workspaces/${workspaceId}/nodes/${nodeId}/revisions`)
  }

  revision(workspaceId: string, nodeId: string, revision: number) {
    return this.get<{ content: string }>(`/workspaces/${workspaceId}/nodes/${nodeId}/revisions/${revision}`)
  }

  restore(workspaceId: string, nodeId: string, revision: number) {
    return this.send(`/workspaces/${workspaceId}/nodes/${nodeId}/revisions/${revision}/restore`, "POST")
  }

  private get<T>(path: string) {
    return this.send<T>(path, "GET")
  }

  private async send<T>(path: string, method: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.base.replace(/\/$/, "")}${path}`, {
        method,
        headers: {
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, "offline", "Can't reach the server.")
    }
    const payload = (await response.json().catch(() => null)) as {
      error?: { code: string; message: string }
    } | null
    if (!response.ok) {
      throw new ApiError(response.status, payload?.error?.code ?? "http", payload?.error?.message ?? "Request failed.")
    }
    return payload as T
  }
}
