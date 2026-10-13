# OpenCharta

A team workspace for Markdown. Files stay plain `.md` files. People can edit the same file together. Each Mac can keep a local folder in sync with the server.

## Stack

- Mac app: Electron, Vite, React, Tailwind, shadcn/ui
- Server: Hono on Node, SQLite, Drizzle
- Live edits: WebSocket, built into `@hono/node-server` (`@hono/node-ws` is deprecated)
- Documents: UTF-8 Markdown, last 10 versions per file

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
```

Server data defaults to `./data/opencharta.sqlite`. Override with `OPENCHARTA_DATA`, `PORT`, and `HOST`.

## What v1 does

- Accounts, workspaces, and roles: owner, admin, editor, viewer
- Folders and Markdown files
- Live editing in the app, with both sides kept if a folder edit races a live edit
- A local folder mirror, including renames matched by content
- The last 10 versions of each file, and restore
- An HTTP API for the same operations

Permissions are workspace-wide. Folder-level access is not in this version.

The local folder is a normal directory of `.md` files plus a hidden `.opencharta/index.json`. It is not object storage. The server keeps the shared copy in SQLite.
