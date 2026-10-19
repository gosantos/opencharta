import * as React from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** An icon-only button. `label` is its accessible name and its tooltip. */
export function IconButton({
  label,
  pressed,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "aria-label" | "size"> & { label: string; pressed?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={pressed}
          className={cn("text-foreground/75", pressed && "bg-accent text-foreground", className)}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
