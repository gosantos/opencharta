import { useState } from "react"
import type { User } from "@opencharta/shared"
import { FolderOpen } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Api, ApiError } from "../lib/api"
import { Logo } from "../components/Logo"

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
    <div className="flex h-full">
      <div className="flex w-[44%] max-w-[520px] shrink-0 flex-col justify-between bg-brand-tint px-10 pt-16 pb-10">
        <div className="flex items-center gap-2.5">
          <Logo size={30} />
          <span className="text-[17px] font-semibold tracking-tight">OpenCharta</span>
        </div>
        <Illustration />
        <p className="max-w-[340px] text-[15px] leading-relaxed text-brand-ink">
          Plain Markdown files, shared like a doc. Edit them in the app or in any editor you like.
        </p>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto px-10 py-12">
        <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-7">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">{creating ? "Create your account" : "Welcome back"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Share Markdown with your team, edit it together live, and keep every file in a folder on your Mac.
            </p>
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
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-col gap-3">
            <Button type="submit" size="lg" disabled={pending}>
              {creating ? "Create account" : "Sign in"}
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
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
      </div>
    </div>
  )
}

/** A folder of files next to a document being edited live: what OpenCharta is, at a glance. */
function Illustration() {
  const files = ["README.md", "product/pricing.md", "specs/onboarding.md", "handbook/on-call.md"]
  return (
    <div aria-hidden="true" className="relative mx-auto h-[260px] w-full max-w-[370px]">
      <div className="absolute top-0 left-0 w-[230px] rounded-xl bg-background p-3.5 shadow-[0_10px_30px_rgba(15,60,45,0.12),0_0_0_1px_rgba(15,60,45,0.06)]">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <FolderOpen className="size-3.5 text-primary" />
          Team notes
        </div>
        <div className="my-2 h-px bg-line-soft" />
        {files.map((file, index) => (
          <div
            key={file}
            className={`flex items-center justify-between rounded-md px-1.5 py-1 text-xs ${index === 2 ? "bg-brand-tint" : ""}`}
          >
            <span>{file}</span>
            {index === 2 ? <Avatar name="Ana" colorKey="ana" size="xs" /> : null}
          </div>
        ))}
      </div>
      <div className="absolute top-[124px] left-[100px] w-[260px] rounded-xl bg-background p-4 shadow-[0_18px_40px_rgba(15,60,45,0.16),0_0_0_1px_rgba(15,60,45,0.06)]">
        <p className="font-serif text-lg">Onboarding</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Invitees see who invited them and where their files will live
          <span className="ml-px inline-block h-3.5 w-0.5 translate-y-0.5 bg-presence-2" />
        </p>
        <div className="mt-3 flex gap-1.5">
          <span className="h-2 flex-[3] rounded bg-line-soft" />
          <span className="h-2 flex-[2] rounded bg-comment" />
        </div>
      </div>
    </div>
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
