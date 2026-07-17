import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";

// PROTOTYPE — Three Tailwind/shadcn Utility foundations, switchable via
// ?variant= and ?mode= on /prototype/utility-foundation. The fixture stays
// fixed so this round decides tokens and core component recipes, not layout.

type Variant = "A" | "B" | "C";
type Mode = "light" | "dark";

const variants: ReadonlyArray<Variant> = ["A", "B", "C"];
const variantMeta: Record<Variant, { name: string; thesis: string; contract: string }> = {
  A: {
    name: "Balanced",
    thesis: "Faithful Utility colors with a compact 28px control, 6px radius, and quiet borders.",
    contract: "28px controls / 6px radius",
  },
  B: {
    name: "Crisp",
    thesis: "The delineated neutral ladder with stronger boundaries and tighter 4px controls.",
    contract: "28px controls / 4px radius",
  },
  C: {
    name: "Roomy",
    thesis: "Faithful Utility colors with a softer 30px control and more horizontal breathing room.",
    contract: "30px controls / 8px radius",
  },
};

const tokenGroups = [
  {
    label: "Surfaces",
    tokens: ["--background", "--card", "--surface-recessed", "--surface-raised"],
  },
  {
    label: "Interaction",
    tokens: ["--primary", "--secondary", "--border", "--ring"],
  },
  {
    label: "States",
    tokens: ["--success", "--warning", "--destructive", "--info"],
  },
] as const;

function readInitial(): { variant: Variant; mode: Mode } {
  const params = new URL(window.location.href).searchParams;
  const candidate = params.get("variant");
  return {
    variant: candidate === "B" || candidate === "C" ? candidate : "A",
    mode: params.get("mode") === "dark" ? "dark" : "light",
  };
}

function writeUrl(variant: Variant, mode: Mode): void {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/utility-foundation";
  url.searchParams.set("variant", variant);
  url.searchParams.set("mode", mode);
  window.history.replaceState({}, "", url);
}

function humanToken(token: string): string {
  return token.replace("--", "").replaceAll("-", " ");
}

function TokenMatrix({ refreshKey }: { readonly refreshKey: string }) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const styles = getComputedStyle(document.documentElement);
      setValues(Object.fromEntries(
        tokenGroups.flatMap((group) => group.tokens).map((token) => [token, styles.getPropertyValue(token).trim()]),
      ));
    });
    return () => cancelAnimationFrame(frame);
  }, [refreshKey]);

  return (
    <div className="token-groups" aria-label="Current computed application theme tokens">
      {tokenGroups.map((group) => (
        <section className="token-group" key={group.label}>
          <h3>{group.label}</h3>
          <div className="token-list">
            {group.tokens.map((token) => (
              <div className="token-row" key={token}>
                <span className="swatch" style={{ background: `var(${token})` }} />
                <span className="token-name">{humanToken(token)}</span>
                <code>{values[token] ?? "—"}</code>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function IssueRow({ number, title, labels, selected = false }: { readonly number: number; readonly title: string; readonly labels: ReadonlyArray<string>; readonly selected?: boolean }) {
  return (
    <button className={`issue-row${selected ? " selected" : ""}`} type="button">
      <span className="state-dot" aria-label="Open issue" />
      <span className="issue-copy">
        <strong>{title}</strong>
        <span className="issue-meta">#{number} · updated {number === 40 ? "now" : `${number - 34}m ago`}</span>
      </span>
      <span className="row-labels">
        {labels.map((label) => <Badge variant="secondary" key={label}>{label}</Badge>)}
      </span>
    </button>
  );
}

function ProductSpecimen() {
  return (
    <section className="product-shell">
      <header className="product-header">
        <div className="wordmark"><span>O</span> Overseer</div>
        <button className="project-picker" type="button">Personal / overseer <span>⌄</span></button>
        <div className="header-actions">
          <Input name="issue-filter" aria-label="Filter issues" placeholder="Filter issues…" />
          <Button size="sm">New issue</Button>
        </div>
      </header>

      <div className="product-body">
        <nav className="product-nav" aria-label="Project navigation">
          <p className="nav-label">Project</p>
          <a className="nav-item active" href="#issues">Issues <span>18</span></a>
          <a className="nav-item" href="#labels">Labels <span>7</span></a>
          <a className="nav-item" href="#settings">Settings</a>
          <p className="nav-label nav-section">Filters</p>
          <a className="nav-item" href="#mine">Assigned to me <span>3</span></a>
          <a className="nav-item" href="#blocked">Blocked <span>2</span></a>
        </nav>

        <main className="issue-index" id="issues">
          <div className="index-heading">
            <div>
              <p className="eyebrow">Issues / Open</p>
              <h1>Current work</h1>
            </div>
            <div className="index-actions">
              <Button variant="outline" size="sm">State: open</Button>
              <Button variant="outline" size="sm">Assignee: anyone</Button>
            </div>
          </div>
          <div className="issue-list">
            <IssueRow number={40} title="Prototype the Utility foundation in Tailwind and shadcn/Base UI" labels={["prototype"]} selected />
            <IssueRow number={41} title="Prototype issue discovery and navigation in shadcn/Base UI" labels={["prototype", "blocked"]} />
            <IssueRow number={37} title="Define HATEOAS-style agent discovery for the REST API" labels={["grilling"]} />
          </div>
        </main>

        <aside className="issue-inspector" aria-label="Selected issue preview">
          <div className="inspector-topline">
            <Badge variant="success">Open</Badge>
            <span>#40</span>
          </div>
          <h2>Prototype the Utility foundation in Tailwind and shadcn/Base UI</h2>
          <p className="subtle">Test Utility's compact neutral language as application-owned component recipes.</p>
          <dl className="facts">
            <div><dt>Assignee</dt><dd>dmmulroy</dd></div>
            <div><dt>Label</dt><dd><Badge variant="secondary">prototype</Badge></dd></div>
            <div><dt>Readiness</dt><dd className="success-text">Unblocked</dd></div>
          </dl>
          <div className="notice warning-notice">
            <strong>Review gate</strong>
            <span>Do not resolve until the theme is approved in both modes.</span>
          </div>
          <div className="inspector-actions">
            <Button variant="outline" size="sm">Edit</Button>
            <Button variant="secondary-destructive" size="sm">Close issue</Button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function FoundationContract({ variant, mode }: { readonly variant: Variant; readonly mode: Mode }) {
  const meta = variantMeta[variant];
  return (
    <section className="foundation-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Theme contract · {meta.contract}</p>
          <h2>{variant} — {meta.name}</h2>
          <p>{meta.thesis}</p>
        </div>
        <div className="contract-badges">
          <Badge variant="success">shadcn/Base UI</Badge>
          <Badge variant="outline">Tailwind v4</Badge>
          <Badge variant="secondary">Geist Variable</Badge>
        </div>
      </div>

      <div className="foundation-grid">
        <article className="contract-card">
          <h3>Formal boundary</h3>
          <ul>
            <li><strong>Theme CSS:</strong> semantic color, radius, type, and control tokens.</li>
            <li><strong>shadcn source:</strong> application-owned recipes composed over Base UI.</li>
            <li><strong>Feature UI:</strong> consumes recipes and semantic roles, never raw colors.</li>
            <li><strong>App layout:</strong> page composition stays outside the component foundation.</li>
          </ul>
        </article>
        <article className="control-card">
          <h3>Application-owned component states</h3>
          <div className="button-rack">
            <Button size="sm">Primary</Button>
            <Button variant="secondary" size="sm">Secondary</Button>
            <Button variant="outline" size="sm">Outline</Button>
            <Button variant="secondary-destructive" size="sm">Danger</Button>
          </div>
          <div className="badge-rack">
            <Badge variant="secondary">metadata</Badge>
            <Badge variant="success">success</Badge>
            <Badge variant="destructive">danger</Badge>
            <Badge variant="outline">focus</Badge>
          </div>
          <label className="compact-field" htmlFor="compact-field">Compact field</label>
          <Input id="compact-field" name="compact-field" placeholder="Application semantic control" />
          <p className="field-description">Focus this field to inspect the ring token.</p>
        </article>
      </div>
      <TokenMatrix refreshKey={`${variant}-${mode}`} />
    </section>
  );
}

function PrototypeSwitcher({ current, onCycle }: { readonly current: Variant; readonly onCycle: (direction: -1 | 1) => void }) {
  if (import.meta.env.PROD) return null;
  return (
    <div className="prototype-switcher" role="group" aria-label="Prototype variant switcher">
      <button type="button" onClick={() => onCycle(-1)} aria-label="Previous variant">←</button>
      <span><strong>{current}</strong> — {variantMeta[current].name}</span>
      <button type="button" onClick={() => onCycle(1)} aria-label="Next variant">→</button>
    </div>
  );
}

function cycleVariant(current: Variant, direction: -1 | 1): Variant {
  const index = variants.indexOf(current);
  const next = variants.at((index + direction + variants.length) % variants.length);
  if (next === undefined) throw new Error("Variant cycle produced no result");
  return next;
}

/** Render the throwaway Utility foundation comparison. */
export function PrototypeApp() {
  const initial = useMemo(readInitial, []);
  const [variant, setVariant] = useState<Variant>(initial.variant);
  const [mode, setMode] = useState<Mode>(initial.mode);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = `overseer-utility-${variant.toLowerCase()}`;
    root.dataset.mode = mode;
    root.classList.toggle("dark", mode === "dark");
    writeUrl(variant, mode);
  }, [variant, mode]);

  const cycle = (direction: -1 | 1) => {
    setVariant((current) => cycleVariant(current, direction));
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.matches("input, textarea, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="prototype-page">
      <header className="prototype-heading">
        <div>
          <p className="prototype-kicker">PROTOTYPE · Issue #40 · foundation recipes only</p>
          <h1>Utility foundation</h1>
          <p>Compare three close neutral-blue recipes against one fixed, compact issue-tracker specimen.</p>
        </div>
        <div className="review-state">
          <span>Variant <strong>{variant}</strong></span>
          <Button variant="outline" size="sm" onClick={() => setMode(mode === "light" ? "dark" : "light")}>
            {mode === "light" ? "Dark" : "Light"} mode
          </Button>
        </div>
      </header>

      <ProductSpecimen />
      <FoundationContract variant={variant} mode={mode} />
      <PrototypeSwitcher current={variant} onCycle={cycle} />
    </div>
  );
}
