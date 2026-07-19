import type * as React from "react";

import { cn } from "@/lib/ui-classnames";

/** An application-owned shadcn textarea recipe using Overseer's semantic controls. */
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full resize-y rounded-[var(--control-radius)] border border-input bg-card px-[var(--control-padding-x)] py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
