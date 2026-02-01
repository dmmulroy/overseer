import { tv, type VariantProps } from "tailwind-variants";
import { forwardRef, type ButtonHTMLAttributes } from "react";

const button = tv({
  base: [
    "inline-flex items-center justify-center gap-2",
    "font-mono text-sm font-medium",
    "border rounded transition-colors duration-150 motion-reduce:transition-none",
    "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-bg-primary",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ],
  variants: {
    variant: {
      primary: [
        "bg-accent text-bg-primary border-accent",
        "hover:bg-accent-muted hover:border-accent-muted",
        "focus:ring-accent",
      ],
      secondary: [
        "bg-surface-primary text-text-primary border-border",
        "hover:bg-surface-secondary hover:border-border-hover",
        "focus:ring-border-focus",
      ],
      ghost: [
        "bg-transparent text-text-muted border-transparent",
        "hover:bg-surface-primary hover:text-text-primary",
        "focus:ring-border-focus",
      ],
      danger: [
        "bg-status-blocked/20 text-status-blocked border-status-blocked/50",
        "hover:bg-status-blocked/30 hover:border-status-blocked",
        "focus:ring-status-blocked",
      ],
    },
    size: {
      sm: "h-7 px-2 text-xs",
      md: "h-9 px-3 text-sm",
      lg: "h-11 px-4 text-base",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "md",
  },
});

type ButtonVariants = VariantProps<typeof button>;

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonVariants {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={button({ variant, size, className })}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
