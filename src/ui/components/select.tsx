import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/ui-classnames";

/** One option rendered by the application-owned Select recipe. */
export type SelectOption<TValue extends string> = {
  readonly value: TValue;
  readonly label: string;
};

/** Props for the compact application-owned Select recipe. */
export type SelectProps<TValue extends string> = {
  readonly ariaLabel: string;
  readonly value: TValue;
  readonly options: ReadonlyArray<SelectOption<TValue>>;
  readonly onValueChange: (value: TValue) => void;
  readonly className?: string;
  readonly prefix?: string;
};

/** Compact shadcn/Base UI Select used by generic structured controls. */
export function Select<TValue extends string>({
  ariaLabel,
  value,
  options,
  onValueChange,
  className,
  prefix,
}: SelectProps<TValue>): React.ReactNode {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;
  return (
    <SelectPrimitive.Root value={value} onValueChange={(nextValue) => {
      if (nextValue !== null) onValueChange(nextValue);
    }}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        data-slot="select-trigger"
        className={cn(
          "inline-flex h-[var(--control-height)] min-w-0 items-center justify-between gap-2 rounded-[var(--control-radius)] border border-input bg-card px-[var(--control-padding-x)] text-[length:var(--control-font-size)] text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 data-popup-open:border-ring motion-reduce:transition-none",
          className,
        )}
      >
        <span className="truncate">
          {prefix === undefined ? null : <span className="text-muted-foreground">{prefix}: </span>}
          <SelectPrimitive.Value>{selectedLabel}</SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon><ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner className="z-50 outline-none" sideOffset={4}>
          <SelectPrimitive.Popup className="min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-[var(--control-radius)] border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none transition-[transform,scale,opacity] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="grid min-h-7 cursor-default grid-cols-[16px_1fr] items-center gap-1 rounded-[var(--control-radius)] px-1.5 text-[length:var(--control-font-size)] outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              >
                <SelectPrimitive.ItemIndicator><Check aria-hidden="true" className="size-3.5" /></SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
