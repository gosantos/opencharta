import { cn } from "@/lib/utils"

// Collaborator colors (see --presence-* in index.css). Listed in full so Tailwind generates them.
const PRESENCE = [
  "bg-presence-1",
  "bg-presence-2",
  "bg-presence-3",
  "bg-presence-4",
  "bg-presence-5",
  "bg-presence-6",
  "bg-presence-7",
] as const

/** A stable collaborator color for a user id, so a person keeps the same color everywhere. */
export function presenceClass(key: string) {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return PRESENCE[Math.abs(hash) % PRESENCE.length] ?? PRESENCE[0]
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? "?"
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""
  return (first + last).toUpperCase()
}

const SIZES = {
  xs: "size-4 text-[9px]",
  sm: "size-5 text-[10px]",
  md: "size-6 text-[11px]",
  lg: "size-8 text-xs",
} as const

export type AvatarSize = keyof typeof SIZES

/** Initials on a collaborator color. Decorative: put the person's name in nearby text. */
export function Avatar({
  name,
  colorKey,
  size = "md",
  title,
  className,
}: {
  name: string
  /** What picks the color, usually the user id. Defaults to the name. */
  colorKey?: string
  size?: AvatarSize
  title?: string
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none",
        SIZES[size],
        presenceClass(colorKey ?? name),
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

/** Overlapping avatars with a "+N" when there are more people than `max`. */
export function AvatarStack({
  people,
  max = 4,
  size = "md",
  label,
}: {
  people: Array<{ id: string; name: string }>
  max?: number
  size?: AvatarSize
  /** Read by screen readers, for example "Ana and Marco are here". */
  label: string
}) {
  if (people.length === 0) return null
  const shown = people.slice(0, max)
  const extra = people.length - shown.length
  return (
    <span role="img" aria-label={label} title={label} className="flex items-center">
      {shown.map((person, index) => (
        <Avatar
          key={person.id}
          name={person.name}
          colorKey={person.id}
          size={size}
          className={cn("ring-2 ring-background", index > 0 && "-ml-1.5")}
        />
      ))}
      {extra > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            "-ml-1.5 inline-flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-muted-foreground ring-2 ring-background",
            SIZES[size],
          )}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  )
}
