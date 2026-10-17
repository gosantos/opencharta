# OpenCharta

A team workspace for Markdown. Files stay plain `.md` files. People can edit the same file together. Each Mac can keep a local folder in sync with the server.

## Stack

- Mac app: Electron, Vite, React, Tailwind, shadcn/ui
- Server: Hono on Node, SQLite, Drizzle
- Live edits: WebSocket, built into `@hono/node-server` (`@hono/node-ws` is deprecated)
- Documents: UTF-8 Markdown, last 10 versions per file
- Agent: the app talks to a running OpenCode server over its HTTP API and streams events

## Run it

```sh
pnpm install
pnpm dev
```

That starts the server on `http://127.0.0.1:8787` and opens the Mac app. In the app, create an account, create a workspace, then choose a folder to sync.

To share the server on a local network, other people set the server field to `http://<this-machine>:8787`.

```sh
pnpm dev:server
pnpm dev:desktop
pnpm test
pnpm test:e2e
```

`pnpm test` runs the server tests and then the end-to-end tests. The end-to-end tests start a real server on a free port, then act as several people at once: Macs syncing temporary folders, and editors connected over WebSocket.

Server data defaults to `./data/opencharta.sqlite`. Override with `OPENCHARTA_DATA`, `PORT`, and `HOST`.

## What v1 does

- Accounts, workspaces, and roles: owner, admin, editor, viewer
- Sharing a single file or folder with someone outside the workspace
- Folders and Markdown files
- Live editing in the app, with both sides kept if a folder edit races a live edit
- A local folder mirror, including renames matched by content
- The last 10 versions of each file, and restore
- An HTTP API for the same operations

Workspace roles apply to every file. On top of that, anyone with edit access can share a single file or folder with another account as an editor or viewer, up to their own access. That person doesn't join the workspace: they see only what was shared with them, plus the names of the folders above it, and their Mac syncs only those files.

The local folder is a normal directory of `.md` files plus a hidden `.opencharta/index.json`. It is not object storage. The server keeps the shared copy in SQLite.

## Agent

The app has an Agent panel that connects to an OpenCode server on the same Mac. Open the panel from the header, choose a sync folder, and type what you want changed. The agent edits files in that folder; the app notices the change and applies it to the open document live, then syncs it to the server like any other edit.

The agent works in the synced folder, so it acts on real `.md` files. Files the agent creates appear in the tree. Edits to a document that is open are applied as a live collaborative change, so nobody's typing is overwritten and both sides merge.

The document you have open is part of every message. Its current contents are attached to the prompt, and the file on disk is brought up to date first, so the agent's own tools read the same text you see. That makes "make this shorter" or "fix the grammar" work without naming the file. Use the chip above the box to send a message without the document.

Connection:

- **Find the server automatically** (default): OpenCharta reads the running server's registration file from `$XDG_STATE_HOME/opencode/service.json` (usually `~/.local/state/opencode/service.json`) and authenticates with its password.
- **Use a specific address**: point OpenCharta at any `opencode serve` instance, with an optional password.

The panel shows the connection state, streams the agent's thinking and tool calls, lets you stop a turn, and asks you before anything needs permission. The conversation is remembered per sync folder across restarts; use **New chat** to start fresh.
