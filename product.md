# OpenCharta

OpenCharta is Google Docs for Markdown.

People share Markdown files across machines and edit them together, live. A set of permissions controls who can see and change what, as in Google Docs. The difference is that every document is a plain `.md` file, and each person can keep those files in a real folder on their own machine.

## The problem

Google Docs makes sharing and editing together easy, but the documents are in Google's format. Markdown files work with every editor, script, git, and AI tool, but there's no easy way to share them with a team, control who can change them, or edit one at the same time as someone else.

## What OpenCharta does

- **Share.** Put Markdown files in a workspace and invite people. They see the same files from their own machines.
- **Permissions.** Each person has a role: owner, admin, editor, or viewer. Viewers can read. Editors can change files. Admins and owners manage people.
- **Edit together.** Several people can edit the same file at once and see each other's changes live.
- **Keep it as files.** Each machine can mirror the workspace to a local folder of ordinary `.md` files. Edits made in any editor reach everyone else. If a folder edit and a live edit happen at the same time, both are kept.
- **History.** The last 10 versions of each file are kept and can be restored.
- **Agent.** An AI agent in the app can read and change the files, and its edits merge with what people are typing.

## Who it's for

Teams that write in Markdown and want to share it the way they'd share a Google Doc.

## Principles

1. **Plain Markdown is the source of truth.** The files are always complete and usable without OpenCharta.
2. **Sharing should feel like Google Docs.** Invite someone, give them a role, and they're in.
3. **Never lose an edit.** When changes conflict, keep both sides. Never overwrite silently.

## In v1

- Accounts, workspaces, and the four roles
- Sharing a single file or folder, as editor or viewer
- Folders and Markdown files
- Live editing in the Mac app
- Folder sync on each Mac, including renames
- The last 10 versions of each file, and restore
- An HTTP API for the same operations
- The agent panel

## Not yet

- Sharing by link
- Comments and suggestions
- Apps for platforms other than Mac, or a web editor
