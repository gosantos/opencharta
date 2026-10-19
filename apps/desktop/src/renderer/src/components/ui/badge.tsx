import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-[11px] leading-[18px] font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "bg-secondary text-foreground/80",
        brand: "bg-brand-soft text-brand-ink",
        info: "bg-insert text-insert-ink",
        warning: "border border-conflict-border bg-conflict text-conflict-ink",
        agent: "bg-agent-soft text-agent-ink",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
)

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
