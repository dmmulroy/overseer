import { ChevronDown, CircleDot, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  IssueDetailPrototype,
  issueDetailVariantMeta,
  type IssueDetailVariant,
} from "@/features/issues/issue-detail-prototype";
import {
  PrototypeSwitcher,
  type PrototypeVariant,
} from "@/prototype/prototype-switcher";
import { Button } from "@/ui/components/button";

// PROTOTYPE — Three structurally different issue-detail compositions,
// switchable via ?variant=, on /prototype/issue-detail.

function variantFromUrl(): IssueDetailVariant {
  const value = new URL(window.location.href).searchParams.get("variant");
  return value === "B" || value === "C" ? value : "A";
}

function writeVariantToUrl(variant: IssueDetailVariant): void {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/issue-detail";
  url.searchParams.set("variant", variant);
  window.history.replaceState({}, "", url);
}

/** Render the throwaway issue-detail steering comparison in a focused issue route. */
export function PrototypeApp() {
  const initialVariant = useMemo(variantFromUrl, []);
  const [variant, setVariant] = useState<IssueDetailVariant>(initialVariant);
  const meta = issueDetailVariantMeta(variant);

  useEffect(() => writeVariantToUrl(initialVariant), [initialVariant]);

  const changeVariant = useCallback((next: PrototypeVariant) => {
    setVariant(next);
    writeVariantToUrl(next);
  }, []);

  return (
    <div className="min-h-screen bg-background px-0 pt-5 pb-28 sm:px-4 sm:pt-8 lg:px-8">
      <header className="mx-auto mb-5 flex w-full max-w-[1520px] flex-col gap-4 px-4 sm:px-0 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold tracking-widest text-accent-foreground">PROTOTYPE · ISSUE #42 · DIRECTION {variant}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-strong sm:text-3xl">{meta.name}</h1>
        </div>
        <p className="max-w-2xl border-l-2 border-primary pl-4 text-xs leading-5 text-muted-foreground">{meta.thesis}</p>
      </header>

      <div className="mx-auto w-full max-w-[1520px] overflow-hidden border-y border-border bg-card shadow-2xl sm:rounded-md sm:border">
        <header className="grid min-h-12 grid-cols-[1fr_auto] items-center gap-3 border-b border-border bg-surface-raised px-3 sm:grid-cols-[190px_minmax(0,1fr)_auto] sm:px-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-md bg-strong text-xs font-bold text-inverse">O</span>
            <strong className="text-sm text-strong">Overseer</strong>
          </div>
          <button
            type="button"
            className="hidden w-fit items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:flex"
            aria-label="Switch workspace or project"
          >
            Personal / Overseer <ChevronDown aria-hidden="true" size={13} />
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] text-success-foreground md:flex"><CircleDot aria-hidden="true" size={11} /> Polling · current</span>
            <Button><Plus aria-hidden="true" size={13} /> New issue</Button>
          </div>
        </header>
        <nav className="flex min-h-11 items-center gap-2 overflow-x-auto border-b border-border bg-surface-recessed px-4 text-xs" aria-label="Breadcrumb">
          <a href="#issues" className="shrink-0 text-muted-foreground hover:text-foreground">Issues</a>
          <span aria-hidden="true" className="text-inactive">/</span>
          <span className="shrink-0 text-muted-foreground">State: open · Assignee: anyone</span>
          <span aria-hidden="true" className="text-inactive">/</span>
          <strong className="shrink-0 text-foreground">#42</strong>
          <span className="ml-auto hidden shrink-0 text-[11px] text-muted-foreground sm:inline">Back preserves list filters</span>
        </nav>
        <main>
          <IssueDetailPrototype variant={variant} />
        </main>
      </div>

      <PrototypeSwitcher current={variant} onChange={changeVariant} />
    </div>
  );
}
