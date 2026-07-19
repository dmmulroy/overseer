import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/ui-classnames";

const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--control-radius)] border border-transparent text-[length:var(--control-font-size)] leading-4 font-medium outline-none select-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
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
        xs: "h-6 px-2 text-xs",
        default: "h-[var(--control-height)] px-[var(--control-padding-x)]",
        lg: "h-8 px-3",
        icon: "size-[var(--control-height)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/** An application-owned shadcn/Base UI button recipe for Overseer controls. */
export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

/** A semantic anchor that shares the owned button recipe without changing element semantics. */
export function ButtonLink({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<"a"> & VariantProps<typeof buttonVariants>) {
  return (
    <a
      data-slot="button-link"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
