import { cn } from "@/lib/utils"

/** The OpenCharta mark: a folded page on the brand green. */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={cn("shrink-0", className)}>
      <rect width="24" height="24" rx="6" className="fill-primary" />
      <path d="M8 6h5.5L16.5 9v9H8z" fill="none" stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10.5 12.5h3.5M10.5 15h2.5" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
