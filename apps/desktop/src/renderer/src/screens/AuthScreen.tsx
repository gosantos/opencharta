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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError("")
    setFieldErrors({})
    try {
      const api = new Api(url, null)
      const result = creating
        ? await api.register({ email, name, password })
        : await api.login({ email, password })
      await onSignedIn({ serverUrl: url, token: result.token, user: result.user })
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fields).length > 0) {
        setFieldErrors(caught.fields)
      } else {
        setError(caught instanceof ApiError ? caught.message : "Can't reach the server.")
      }
    } finally {
      setPending(false)
    }
  }

  function edit(field: string, set: (value: string) => void) {
    return (value: string) => {
      set(value)
      setFieldErrors(({ [field]: _, ...rest }) => rest)
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
        {creating ? (
          <Field label="Name" value={name} onChange={edit("name", setName)} error={fieldErrors.name} autoFocus />
        ) : null}
        <Field
          label="Email"
          value={email}
          onChange={edit("email", setEmail)}
          error={fieldErrors.email}
          type="email"
          autoFocus={!creating}
        />
        <Field
          label="Password"
          value={password}
          onChange={edit("password", setPassword)}
          error={fieldErrors.password ?? (creating ? "Use at least 8 characters." : undefined)}
          hint={creating && !fieldErrors.password}
          minLength={creating ? 8 : undefined}
          type="password"
        />
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
            setFieldErrors({})
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
  error,
  hint = false,
  minLength,
  type = "text",
  autoFocus,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  /** Shown under the input. Styled as an error unless `hint` is set. */
  error?: string
  hint?: boolean
  minLength?: number
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
        minLength={minLength}
        aria-invalid={error && !hint ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        required
      />
      {error ? (
        <p className={hint ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>{error}</p>
      ) : null}
    </div>
  )
}
