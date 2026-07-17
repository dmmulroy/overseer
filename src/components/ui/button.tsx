import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--control-radius)] border border-transparent text-[length:var(--control-font-size)] leading-4 font-medium outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/75",
        outline: "border-border bg-card text-card-foreground hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        "secondary-destructive": "border-border bg-card text-destructive hover:bg-destructive/10",
      },
      size: {
        default: "h-[calc(var(--control-height)+4px)] px-[calc(var(--control-padding-x)+2px)]",
        sm: "h-[var(--control-height)] px-[var(--control-padding-x)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/** An application-owned shadcn/Base UI button recipe for compact Overseer controls. */
function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button };
