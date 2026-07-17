import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** An application-owned shadcn/Base UI text input using Overseer's control tokens. */
function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-[var(--control-height)] w-full min-w-0 rounded-[var(--control-radius)] border border-input bg-card px-[var(--control-padding-x)] py-1 text-base leading-4 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50 md:text-[length:var(--control-font-size)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
