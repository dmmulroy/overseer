import { tv, type VariantProps } from "tailwind-variants";
import { forwardRef, type HTMLAttributes } from "react";

const badge = tv({
  base: [
    "inline-flex items-center justify-center gap-1.5",
    "font-mono text-xs font-medium uppercase tracking-wider",
    "px-2 py-0.5 rounded",
  ],
  variants: {
    variant: {
      pending: "bg-status-pending/20 text-status-pending border border-status-pending/30",
      active: "bg-status-active/20 text-status-active border border-status-active/30",
      blocked: "bg-status-blocked/20 text-status-blocked border border-status-blocked/30",
      done: "bg-status-done/20 text-status-done border border-status-done/30",
    },
    appearance: {
      default: "",
      brutalist: "rounded-none border-2 tracking-[0.15em] font-bold",
    },
  },
  defaultVariants: {
    variant: "pending",
    appearance: "default",
  },
});

type BadgeVariants = VariantProps<typeof badge>;

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, BadgeVariants {
  /** Show pulsing indicator (for active tasks) */
  pulsing?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, appearance, pulsing, children, ...props }, ref) => {
    return (
      <span ref={ref} className={badge({ variant, appearance, className })} {...props}>
        {pulsing && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-current animate-pulse-active-sm motion-reduce:animate-none"
            aria-hidden="true"
          />
        )}
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";
