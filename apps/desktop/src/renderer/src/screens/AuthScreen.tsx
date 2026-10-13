import { useState } from "react"
import type { User } from "@opencharta/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Api, ApiError } from "../lib/api"

export function AuthScreen({
  serverUrl,
  onSignedIn,
}: {
  serverUrl: string
  onSignedIn: (session: { serverUrl: string; token: string; user: User }) => Promise<void>
}) {
  const [url, setUrl] = useState(serverUrl)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const api = new Api(url, null)
      const result = creating
        ? await api.register({ email, name, password })
        : await api.login({ email, password })
      await onSignedIn({ serverUrl: url, token: result.token, user: result.user })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Can't reach the server.")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full max-w-sm flex-col justify-center gap-8 pr-12">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">OpenCharta</h1>
        <p className="mt-2 text-sm text-muted-foreground">A shared folder of Markdown.</p>
      </div>
      <div className="grid gap-4">
        <Field label="Server" value={url} onChange={setUrl} type="url" />
        {creating ? <Field label="Name" value={name} onChange={setName} autoFocus /> : null}
        <Field label="Email" value={email} onChange={setEmail} type="email" autoFocus={!creating} />
        <Field label="Password" value={password} onChange={setPassword} type="password" />
      </div>
      {error ? <p className="text-sm">{error}</p> : null}
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={pending}>
          {creating ? "Create account" : "Sign in"}
        </Button>
        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setCreating((value) => !value)
            setError("")
          }}
        >
          {creating ? "Have an account? Sign in" : "Create an account"}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoFocus,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  autoFocus?: boolean
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </div>
  )
}
