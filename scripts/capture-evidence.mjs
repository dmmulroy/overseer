import { constants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.PROTOTYPE_URL ?? "http://127.0.0.1:4184/prototype/mutation-recovery";
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/Users/dmmulroy/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

async function firstExecutable() {
  for (const candidate of executableCandidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known local Chromium installation.
    }
  }
  throw new Error("No executable Chromium found; set PLAYWRIGHT_CHROMIUM_EXECUTABLE");
}

await rm("evidence", { recursive: true, force: true });
await mkdir("evidence", { recursive: true });

const browser = await chromium.launch({ executablePath: await firstExecutable(), headless: true });
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
for (const page of [desktop, mobile]) {
  page.on("pageerror", (error) => errors.push(error));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(new Error(`Browser console at ${message.location().url}: ${message.text()}`));
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(new Error(`Browser response ${response.status()}: ${response.url()}`));
  });
}

const stateText = {
  steady: "Fresh and ready",
  editing: "device-local draft",
  conflict: "newer title Revision",
  stale: "Couldn’t refresh",
  closed: "Issue closed",
  "confirm-delete": "Delete Issue #72?",
  deleted: "read-only",
};

async function open(page, variant, mode, state) {
  await page.goto(`${baseUrl}?variant=${variant}&mode=${mode}&state=${state}`, { waitUntil: "networkidle" });
  await page.locator(".prototype-switcher").waitFor();
  await page.getByText(stateText[state], { exact: false }).first().waitFor();
  const rootState = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    mode: document.documentElement.dataset.mode,
    darkClass: document.documentElement.classList.contains("dark"),
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  const url = new URL(page.url());
  if (
    rootState.theme !== "overseer-crisp"
    || rootState.mode !== mode
    || rootState.darkClass !== (mode === "dark")
    || url.searchParams.get("variant") !== variant
    || url.searchParams.get("state") !== state
  ) errors.push(new Error(`Wrong root/URL state: ${JSON.stringify({ rootState, url: page.url() })}`));
  if (rootState.scrollWidth > rootState.clientWidth) errors.push(new Error(`${variant}/${mode}/${state} horizontally overflows: ${rootState.scrollWidth} > ${rootState.clientWidth}`));
}

for (const page of [desktop, mobile]) {
  for (const variant of ["A", "B", "C"]) {
    for (const mode of ["light", "dark"]) {
      for (const state of Object.keys(stateText)) await open(page, variant, mode, state);
    }
  }
}

for (const variant of ["A", "B", "C"]) {
  for (const mode of ["light", "dark"]) {
    await open(desktop, variant, mode, "steady");
    await desktop.screenshot({ path: `evidence/${variant.toLowerCase()}-${mode}-desktop.png`, fullPage: true });
    await open(mobile, variant, mode, "steady");
    await mobile.screenshot({ path: `evidence/${variant.toLowerCase()}-${mode}-mobile.png`, fullPage: true });
  }
}

const focused = [
  [desktop, "A", "light", "editing", "editing-inline-light-desktop.png"],
  [desktop, "A", "dark", "conflict", "conflict-inline-dark-desktop.png"],
  [desktop, "B", "light", "stale", "stale-workbench-light-desktop.png"],
  [mobile, "C", "dark", "closed", "close-checkpoint-dark-mobile.png"],
  [desktop, "A", "light", "confirm-delete", "delete-confirmation-light-desktop.png"],
  [mobile, "B", "dark", "deleted", "deleted-restore-dark-mobile.png"],
];
for (const [page, variant, mode, state, filename] of focused) {
  await open(page, variant, mode, state);
  await page.screenshot({ path: `evidence/${filename}`, fullPage: true });
}

await open(desktop, "A", "light", "editing");
await desktop.getByRole("button", { name: "Save title" }).click();
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("state") === "steady");
await desktop.getByText("Title saved as Revision 20", { exact: false }).waitFor();

await open(desktop, "A", "light", "conflict");
await desktop.getByRole("button", { name: "Save my version" }).click();
await desktop.getByText("saved as Revision 21", { exact: false }).waitFor();

await open(desktop, "A", "light", "stale");
if (await desktop.getByRole("button", { name: "Save title" }).isEnabled()) errors.push(new Error("Stale state did not disable server write"));
await desktop.getByRole("button", { name: "Retry now" }).first().click();
await desktop.getByText("Server writes are available again", { exact: false }).waitFor();

await open(desktop, "A", "light", "closed");
await desktop.getByRole("button", { name: "Reopen issue" }).click();
await desktop.getByText("Issue reopened", { exact: false }).waitFor();

await open(desktop, "A", "light", "steady");
await desktop.locator(".issue-actions").getByRole("button", { name: "Delete", exact: true }).click();
const alertDialog = desktop.getByRole("alertdialog");
await alertDialog.waitFor();
if (!await alertDialog.evaluate((dialog) => dialog.contains(document.activeElement))) errors.push(new Error("Alert Dialog did not move focus inside"));
await desktop.keyboard.press("Escape");
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("state") === "steady");

await open(desktop, "A", "light", "confirm-delete");
await desktop.getByRole("button", { name: "Delete issue" }).click();
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("state") === "deleted");
await desktop.getByRole("button", { name: "Restore issue" }).click();
await desktop.getByText("Issue restored", { exact: false }).waitFor();

await open(desktop, "A", "light", "steady");
await desktop.keyboard.press("ArrowRight");
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("variant") === "B");
await desktop.getByRole("button", { name: "Dark mode" }).click();
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("mode") === "dark" && document.documentElement.classList.contains("dark"));

await browser.close();
if (errors.length > 0) throw new AggregateError(errors, "Prototype browser checks failed");
console.log("Captured 18 screenshots; checked 84 responsive variant/mode/state combinations plus mutation, recovery, keyboard, URL, console, and overflow behavior.");
