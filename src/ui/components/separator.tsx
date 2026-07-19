import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "@/lib/ui-classnames";

/** An application-owned semantic separator composed over Base UI. */
export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}
