import { Badge, Button, Input, Surface } from "@cloudflare/kumo";
import { useEffect, useMemo, useState } from "react";

// PROTOTYPE — Four Kumo token mappings of Utility, switchable via ?variant=
// and ?mode= on /prototype/kumo-utility. The specimen is intentionally fixed:
// this ticket decides the reusable theme foundation, not a screen layout.

type Variant = "A" | "B" | "C" | "D";
type Mode = "light" | "dark";

const variants: ReadonlyArray<Variant> = ["A", "B", "C", "D"];
const variantMeta: Record<Variant, { name: string; thesis: string; contract: string }> = {
  A: {
    name: "Faithful",
    thesis: "Directly translates the chosen Utility palette into every Kumo semantic role.",
    contract: "Explicit core + state tokens",
  },
  B: {
    name: "Ember",
    thesis: "Pairs cool utility surfaces with a warm vermilion action signal and plum graphite darks.",
    contract: "Warm signal / cool graphite",
  },
  C: {
    name: "Delineated",
    thesis: "Strengthens borders, fills, and state contrast for long, dense work queues.",
    contract: "High-separation surfaces",
  },
  D: {
    name: "Signal",
    thesis: "Pushes Utility toward technical blue-greens with an electric teal interaction signal.",
    contract: "Teal signal / blue graphite",
  },
};

const tokenGroups = [
  {
    label: "Surfaces",
    tokens: ["--color-kumo-canvas", "--color-kumo-base", "--color-kumo-recessed", "--color-kumo-elevated"],
  },
  {
    label: "Interaction",
    tokens: ["--color-kumo-brand", "--color-kumo-fill", "--color-kumo-line", "--color-kumo-focus"],
  },
  {
    label: "States",
    tokens: ["--color-kumo-success", "--color-kumo-warning", "--color-kumo-danger", "--color-kumo-info"],
  },
] as const;

function readInitial(): { variant: Variant; mode: Mode } {
  const params = new URL(window.location.href).searchParams;
  const candidate = params.get("variant");
  return {
    variant: candidate === "B" || candidate === "C" || candidate === "D" ? candidate : "A",
    mode: params.get("mode") === "dark" ? "dark" : "light",
  };
}

function writeUrl(variant: Variant, mode: Mode): void {
  const url = new URL(window.location.href);
  url.pathname = "/prototype/kumo-utility";
  url.searchParams.set("variant", variant);
  url.searchParams.set("mode", mode);
  window.history.replaceState({}, "", url);
}

function humanToken(token: string): string {
  return token.replace("--color-kumo-", "").replaceAll("-", " ");
}

function TokenMatrix({ refreshKey }: { refreshKey: string }) {
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
    <div className="token-groups" aria-label="Current computed Kumo theme tokens">
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

function IssueRow({ number, title, labels, selected = false }: { number: number; title: string; labels: string[]; selected?: boolean }) {
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
    <Surface className="product-shell">
      <header className="product-header">
        <div className="wordmark"><span>O</span> Overseer</div>
        <button className="project-picker" type="button">Personal / overseer <span>⌄</span></button>
        <div className="header-actions">
          <Input size="sm" aria-label="Filter issues" placeholder="Filter issues…" />
          <Button variant="primary" size="sm">New issue</Button>
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
              <Button variant="secondary" size="sm">State: open</Button>
              <Button variant="secondary" size="sm">Assignee: anyone</Button>
            </div>
          </div>
          <div className="issue-list">
            <IssueRow number={40} title="Prototype the Kumo Utility theme foundation" labels={["prototype"]} selected />
            <IssueRow number={41} title="Prototype issue discovery and navigation in Kumo" labels={["prototype", "blocked"]} />
            <IssueRow number={37} title="Define HATEOAS-style agent discovery" labels={["grilling"]} />
          </div>
        </main>

        <aside className="issue-inspector" aria-label="Selected issue preview">
          <div className="inspector-topline">
            <Badge variant="success">Open</Badge>
            <span>#40</span>
          </div>
          <h2>Prototype the Kumo Utility theme foundation</h2>
          <p className="subtle">Map Utility's compact neutral language onto reusable Kumo semantics.</p>
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
            <Button variant="secondary" size="sm">Edit</Button>
            <Button variant="secondary-destructive" size="sm">Close issue</Button>
          </div>
        </aside>
      </div>
    </Surface>
  );
}

function FoundationContract({ variant }: { variant: Variant }) {
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
          <Badge variant="success">Kumo 2.8</Badge>
          <Badge variant="outline">light + dark</Badge>
          <Badge variant="secondary">Inter Variable</Badge>
        </div>
      </div>

      <div className="foundation-grid">
        <Surface className="contract-card">
          <h3>Formal boundary</h3>
          <ul>
            <li><strong>Kumo theme:</strong> semantic color roles and typography scale.</li>
            <li><strong>Component props:</strong> compact density via Kumo's <code>xs</code>/<code>sm</code> sizes.</li>
            <li><strong>App layout:</strong> spacing, radius, and shell geometry stay outside theme tokens.</li>
            <li><strong>No raw colors:</strong> feature UI consumes only <code>kumo-*</code> roles.</li>
          </ul>
        </Surface>
        <Surface className="control-card">
          <h3>Kumo component states</h3>
          <div className="button-rack">
            <Button variant="primary" size="sm">Primary</Button>
            <Button variant="secondary" size="sm">Secondary</Button>
            <Button variant="outline" size="sm">Outline</Button>
            <Button variant="destructive" size="sm">Danger</Button>
          </div>
          <div className="badge-rack">
            <Badge variant="secondary">metadata</Badge>
            <Badge variant="success">success</Badge>
            <Badge variant="destructive">danger</Badge>
            <Badge variant="beta">focus</Badge>
          </div>
          <Input size="sm" label="Compact field" placeholder="Kumo semantic control" description="Focus this field to inspect the focus token." />
        </Surface>
      </div>
      <TokenMatrix refreshKey={variant + document.documentElement.dataset.mode} />
    </section>
  );
}

function PrototypeSwitcher({ current, onCycle }: { current: Variant; onCycle: (direction: -1 | 1) => void }) {
  if (import.meta.env.PROD) return null;
  return (
    <div className="prototype-switcher" role="group" aria-label="Prototype variant switcher">
      <button type="button" onClick={() => onCycle(-1)} aria-label="Previous variant">←</button>
      <span><strong>{current}</strong> — {variantMeta[current].name}</span>
      <button type="button" onClick={() => onCycle(1)} aria-label="Next variant">→</button>
    </div>
  );
}

export function PrototypeApp() {
  const initial = useMemo(readInitial, []);
  const [variant, setVariant] = useState<Variant>(initial.variant);
  const [mode, setMode] = useState<Mode>(initial.mode);

  useEffect(() => {
    document.documentElement.dataset.theme = `overseer-utility-${variant.toLowerCase()}`;
    document.documentElement.dataset.mode = mode;
    writeUrl(variant, mode);
  }, [variant, mode]);

  const cycle = (direction: -1 | 1) => {
    const index = variants.indexOf(variant);
    setVariant(variants[(index + direction + variants.length) % variants.length]);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
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
          <p className="prototype-kicker">PROTOTYPE · Issue #40 · theme tokens only</p>
          <h1>Kumo Utility foundation</h1>
          <p>Compare four formal token mappings against one fixed, compact issue-tracker specimen.</p>
        </div>
        <div className="review-state">
          <span>Variant <strong>{variant}</strong></span>
          <Button variant="secondary" size="sm" onClick={() => setMode(mode === "light" ? "dark" : "light")}>
            {mode === "light" ? "Dark" : "Light"} mode
          </Button>
        </div>
      </header>

      <ProductSpecimen />
      <FoundationContract variant={variant} />
      <PrototypeSwitcher current={variant} onCycle={cycle} />
    </div>
  );
}
