import { startServer } from "./server"

const server = await startServer({
  dataFile: process.env.OPENCHARTA_DATA ?? "./data/opencharta.sqlite",
  port: Number(process.env.PORT ?? 8787),
  hostname: process.env.HOST ?? "0.0.0.0",
})

console.log(`OpenCharta listening on ${server.url}`)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void server.close().finally(() => process.exit(0))
  })
}
