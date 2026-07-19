import { Moon, Sun } from "lucide-react";
import { useEffect } from "react";

import { useTheme } from "@/ui/theme-provider";

/** The URL-addressable issue-detail alternatives. */
export type PrototypeVariant = "A" | "B" | "C";

const order: ReadonlyArray<PrototypeVariant> = ["A", "B", "C"];

const names: Readonly<Record<PrototypeVariant, string>> = {
  A: "Command header",
  B: "Steering rail",
  C: "Readiness board",
};

function cycle(current: PrototypeVariant, direction: -1 | 1): PrototypeVariant {
  const index = order.indexOf(current);
  return order[(index + direction + order.length) % order.length] ?? "A";
}

/** A development-only, URL-backed switcher for issue-detail prototype variants. */
export function PrototypeSwitcher({
  current,
  onChange,
}: {
  readonly current: PrototypeVariant;
  readonly onChange: (variant: PrototypeVariant) => void;
}) {
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element
        && event.target.matches("input, textarea, [contenteditable='true']")
      ) return;
      if (event.key === "ArrowLeft") onChange(cycle(current, -1));
      if (event.key === "ArrowRight") onChange(cycle(current, 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, onChange]);

  if (import.meta.env.PROD) return null;

  return (
    <nav
      className="prototype-switcher fixed bottom-4 left-1/2 z-50 flex w-[min(560px,calc(100%-24px))] -translate-x-1/2 items-center gap-1.5 rounded-lg border border-inactive bg-strong p-2 text-inverse shadow-2xl"
      aria-label="Prototype variants"
    >
      <button
        type="button"
        className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-inactive bg-foreground/10 text-base hover:bg-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="Previous variant"
        onClick={() => onChange(cycle(current, -1))}
      >
        ←
      </button>
      <div className="min-w-0 flex-1 px-1.5">
        <span className="block font-mono text-[9px] tracking-widest text-inactive">ISSUE DETAIL</span>
        <strong className="block truncate text-xs">{current} — {names[current]}</strong>
      </div>
      <div className="hidden items-center gap-1 sm:flex" aria-label="Choose variant">
        {order.map((variant) => (
          <button
            key={variant}
            type="button"
            aria-label={`${variant} — ${names[variant]}`}
            aria-current={current === variant ? "page" : undefined}
            className={current === variant
              ? "size-7 rounded-md bg-inverse text-strong"
              : "size-7 rounded-md text-inactive hover:bg-foreground/10 hover:text-inverse"}
            onClick={() => onChange(variant)}
          >
            {variant}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-inverse hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`Switch to ${resolvedTheme === "light" ? "dark" : "light"} mode`}
        onClick={() => setTheme(resolvedTheme === "light" ? "dark" : "light")}
      >
        {resolvedTheme === "light" ? <Moon aria-hidden="true" size={14} /> : <Sun aria-hidden="true" size={14} />}
        <span className="hidden sm:inline">{resolvedTheme === "light" ? "Dark" : "Light"}</span>
      </button>
      <button
        type="button"
        className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md border border-inactive bg-foreground/10 text-base hover:bg-foreground/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="Next variant"
        onClick={() => onChange(cycle(current, 1))}
      >
        →
      </button>
    </nav>
  );
}
