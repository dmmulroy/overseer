import type * as React from "react";

import { cn } from "@/lib/utils";

/** An application-owned shadcn text-area recipe using Overseer's control tokens. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full min-w-0 resize-y rounded-[var(--control-radius)] border border-input bg-card px-[var(--control-padding-x)] py-2 text-base leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50 md:text-[length:var(--control-font-size)]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
