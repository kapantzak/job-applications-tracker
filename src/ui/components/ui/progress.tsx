"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

// Local change (SOW-0023): a null or missing value renders an indeterminate bar, because the agent
// reports no percentage. Re-apply if this file is ever overwritten by `shadcn add`.
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const indeterminate = value === null || value === undefined
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full flex-1 bg-primary",
          indeterminate
            ? "w-2/5 rounded-full animate-progress-indeterminate motion-reduce:w-full motion-reduce:animate-pulse"
            : "w-full transition-all"
        )}
        style={indeterminate ? undefined : { transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
