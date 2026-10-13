import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const scryptAsync = promisify(scrypt)

export function sha256(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex")
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export function newToken() {
  return randomBytes(32).toString("base64url")
}

export function newId() {
  return crypto.randomUUID()
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex")
  const hash = (await scryptAsync(password, salt, 32)) as Buffer
  return `scrypt$${salt}$${hash.toString("hex")}`
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hex] = stored.split("$")
  if (scheme !== "scrypt" || !salt || !hex) return false
  const hash = (await scryptAsync(password, salt, 32)) as Buffer
  const expected = Buffer.from(hex, "hex")
  if (hash.length !== expected.length) return false
  return timingSafeEqual(hash, expected)
}
