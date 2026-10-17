import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { after, before, test } from "node:test"
import { _electron, type ElectronApplication, type Page } from "playwright"
import type { Comment } from "@opencharta/shared"
import { Client, bootServer, eventually } from "../src/harness"

// Drives the built Mac app against a real server. Run `pnpm --filter @opencharta/desktop build` first.
const desktop = resolve(import.meta.dirname, "../../apps/desktop")
const electronPath = createRequire(join(desktop, "package.json"))("electron") as unknown as string

let server: Awaited<ReturnType<typeof bootServer>>
let app: ElectronApplication
let page: Page
let profile: string

before(async () => {
  server = await bootServer()
  profile = mkdtempSync(join(tmpdir(), "opencharta-ui-"))
  app = await _electron.launch({
    executablePath: electronPath,
    args: [join(desktop, "out/main/index.js")],
    env: { ...process.env, OPENCHARTA_USER_DATA: profile, ELECTRON_RENDERER_URL: "" },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(10_000)
})

after(async () => {
  await app?.close()
  await server?.close()
  rmSync(profile, { recursive: true, force: true })
})

test("create an account, a workspace, and a file, then write, share, and comment", async () => {
  await page.getByRole("button", { name: "Create an account" }).click()
  await page.locator('input[type="url"]').fill(server.url)
  await page.locator('input[type="text"]').first().fill("Ana")
  await page.locator('input[type="email"]').fill("ana@example.com")
  await page.locator('input[type="password"]').fill("password123")
  await page.getByRole("button", { name: "Create account" }).click()

  await page.getByPlaceholder("New workspace").fill("Team")
  await page.getByRole("button", { name: "Create", exact: true }).click()

  await page.getByRole("button", { name: "New file" }).click()
  await page.getByRole("dialog").locator("input").fill("plan")
  await page.getByRole("dialog").locator("input").press("Enter")

  const editor = page.locator(".cm-content")
  await editor.click()
  await page.keyboard.type("# Plan\n\nShip sharing this week.")

  const ana = await Client.login(server.url, "ana@example.com")
  const workspace = (await ana.call<{ workspaces: Array<{ id: string }> }>("/workspaces")).workspaces[0]!
  const file = (await ana.nodes(workspace.id)).find((node) => node.path === "plan.md")!
  await page.keyboard.press("ControlOrMeta+s")
  const saved = await eventually(
    () => ana.content(workspace.id, file.id),
    (body) => body.content.includes("Ship sharing"),
  )
  assert.equal(saved.content, "# Plan\n\nShip sharing this week.")

  await Client.register(server.url, "bo@example.com", "Bo")
  await page.getByRole("button", { name: "Share", exact: true }).click()
  const share = page.getByRole("dialog")
  await share.locator('input[type="email"]').fill("bo@example.com")
  await share.getByRole("button", { name: "Share", exact: true }).click()
  await share.getByText("bo@example.com").waitFor()
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Hide agent" }).click()
  await page.getByRole("button", { name: "Comments" }).click()
  await page.getByPlaceholder("Add a comment").fill("Which day?")
  await page.getByRole("button", { name: "Comment", exact: true }).click()
  await page.getByText("Which day?").waitFor()
  const { comments } = await ana.call<{ comments: Comment[] }>(`/workspaces/${workspace.id}/nodes/${file.id}/comments`)
  assert.deepEqual(
    comments.map((comment) => comment.body),
    ["Which day?"],
  )
})
