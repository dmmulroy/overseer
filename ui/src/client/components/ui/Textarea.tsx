import { tv, type VariantProps } from "tailwind-variants";
import { forwardRef, type TextareaHTMLAttributes } from "react";

const textarea = tv({
  base: [
    "w-full min-h-[80px]",
    "bg-surface-primary text-text-primary placeholder:text-text-dim",
    "font-mono text-sm",
    "border border-border rounded",
    "px-3 py-2",
    "transition-colors duration-150 motion-reduce:transition-none resize-y",
    "focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  ],
  variants: {
    size: {
      sm: "text-xs px-2 py-1.5",
      md: "text-sm px-3 py-2",
      lg: "text-base px-4 py-3",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

type TextareaVariants = VariantProps<typeof textarea>;

interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size">,
    TextareaVariants {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size, ...props }, ref) => {
    return (
      <textarea ref={ref} className={textarea({ size, className })} {...props} />
    );
  }
);

Textarea.displayName = "Textarea";
