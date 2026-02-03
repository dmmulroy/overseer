import { tv, type VariantProps } from "tailwind-variants";
import { forwardRef, type HTMLAttributes } from "react";

const card = tv({
  base: [
    "bg-surface-primary border-2 border-border rounded",
    "transition-all duration-150 motion-reduce:transition-none",
  ],
  variants: {
    selected: {
      true: "border-accent bg-accent-subtle/30 shadow-[0_0_20px_-8px_var(--color-accent)]",
      false: "",
    },
    interactive: {
      true: "cursor-pointer hover:border-border-hover hover:bg-surface-secondary hover:scale-[1.01] motion-reduce:hover:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary",
      false: "",
    },
  },
  compoundVariants: [
    {
      selected: true,
      interactive: true,
      className: "hover:border-accent hover:bg-accent-subtle/40",
    },
  ],
  defaultVariants: {
    selected: false,
    interactive: false,
  },
});

type CardVariants = VariantProps<typeof card>;

interface CardProps extends HTMLAttributes<HTMLDivElement>, CardVariants {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, selected, interactive, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={card({ selected, interactive, className })}
        {...props}
      />
    );
  }
);

Card.displayName = "Card";

// Card subcomponents
const cardHeader = tv({
  base: "px-4 py-3 border-b border-border",
});

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ className, ...props }: CardHeaderProps) {
  return <div className={cardHeader({ className })} {...props} />;
}

const cardContent = tv({
  base: "px-4 py-3",
});

interface CardContentProps extends HTMLAttributes<HTMLDivElement> {}

export function CardContent({ className, ...props }: CardContentProps) {
  return <div className={cardContent({ className })} {...props} />;
}

const cardFooter = tv({
  base: "px-4 py-3 border-t border-border",
});

interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {}

export function CardFooter({ className, ...props }: CardFooterProps) {
  return <div className={cardFooter({ className })} {...props} />;
}
