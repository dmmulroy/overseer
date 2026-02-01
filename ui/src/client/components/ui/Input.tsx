import { tv, type VariantProps } from "tailwind-variants";
import { forwardRef, type InputHTMLAttributes } from "react";

const input = tv({
  base: [
    "w-full",
    "bg-surface-primary text-text-primary placeholder:text-text-dim",
    "font-mono",
    "border border-border rounded",
    "transition-colors duration-150 motion-reduce:transition-none",
    "focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ],
  variants: {
    size: {
      sm: "h-7 px-2 py-1 text-xs",
      md: "h-9 px-3 py-2 text-sm",
      lg: "h-11 px-4 py-2.5 text-base",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

type InputVariants = VariantProps<typeof input>;

interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">,
    InputVariants {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, ...props }, ref) => {
    return (
      <input ref={ref} className={input({ size, className })} {...props} />
    );
  }
);

Input.displayName = "Input";
