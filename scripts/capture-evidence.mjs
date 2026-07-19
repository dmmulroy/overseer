import { constants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.PROTOTYPE_URL ?? "http://127.0.0.1:4191/prototype/issue-discovery";
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/Users/dmmulroy/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Users/dillon/.agent-browser/browsers/chrome-147.0.7727.57/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
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
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const errors = [];

for (const page of [desktop, mobile]) {
  page.on("pageerror", (error) => errors.push(error));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(new Error(`Browser console error: ${message.text()}`));
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(new Error(`Browser response ${response.status()}: ${response.url()}`));
  });
}

async function open(page, variant, mode, freshness = "fresh") {
  await page.goto(`${baseUrl}?variant=${variant}&mode=${mode}&freshness=${freshness}`, { waitUntil: "networkidle" });
  await page.locator(".prototype-switcher").waitFor();
  await page.locator(".product-shell").waitFor();
  const state = await page.evaluate(() => ({
    variant: new URL(location.href).searchParams.get("variant"),
    mode: new URL(location.href).searchParams.get("mode"),
    dark: document.documentElement.classList.contains("dark"),
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    control: (() => {
      const button = document.querySelector('.app-header [data-slot="button"]');
      const select = document.querySelector('[data-slot="select-trigger"]');
      if (!(button instanceof HTMLElement) || !(select instanceof HTMLElement)) return null;
      return {
        buttonHeight: getComputedStyle(button).height,
        buttonRadius: getComputedStyle(button).borderRadius,
        selectHeight: getComputedStyle(select).height,
        selectRadius: getComputedStyle(select).borderRadius,
      };
    })(),
  }));
  if (state.variant !== variant || state.mode !== mode || state.dark !== (mode === "dark")) {
    errors.push(new Error(`Wrong URL/theme state: ${JSON.stringify(state)}`));
  }
  if (state.scrollWidth > state.clientWidth) {
    errors.push(new Error(`${variant}/${mode} horizontally overflows: ${state.scrollWidth} > ${state.clientWidth}`));
  }
  if (state.control === null || state.control.buttonHeight !== "28px" || state.control.selectHeight !== "28px" || state.control.buttonRadius !== "4px" || state.control.selectRadius !== "4px") {
    errors.push(new Error(`Crisp control recipe regressed: ${JSON.stringify(state.control)}`));
  }
}

const names = { A: "triage-rail", B: "issue-ledger", C: "route-stack", D: "rail-route" };
for (const variant of ["A", "B", "C", "D"]) {
  for (const mode of ["light", "dark"]) {
    await open(desktop, variant, mode);
    await desktop.screenshot({ path: `evidence/issue-discovery-${variant.toLowerCase()}-${names[variant]}-${mode}-desktop.png`, fullPage: true });
    await open(mobile, variant, mode);
    await mobile.screenshot({ path: `evidence/issue-discovery-${variant.toLowerCase()}-${names[variant]}-${mode}-mobile.png`, fullPage: true });
  }
}

await open(desktop, "A", "light");
const issue42 = desktop.getByRole("button", { name: /Prototype issue detail steering/ });
await issue42.hover();
await desktop.getByText("Prefetched", { exact: true }).waitFor();
await desktop.screenshot({ path: "evidence/issue-discovery-prefetch-proof.png", fullPage: false });
await issue42.click();
await desktop.getByRole("heading", { name: "Prototype issue detail steering in shadcn/Base UI" }).waitFor();
await desktop.screenshot({ path: "evidence/issue-discovery-selection-proof.png", fullPage: false });

await open(desktop, "B", "light");
await desktop.getByRole("combobox", { name: "Filter by blocking status" }).click();
await desktop.getByRole("option", { name: "Blocked", exact: true }).click();
await desktop.getByText("2 issues", { exact: true }).waitFor();
await desktop.screenshot({ path: "evidence/issue-discovery-structured-filter-proof.png", fullPage: false });

await open(desktop, "C", "dark", "stale");
await desktop.getByText("Couldn’t refresh", { exact: false }).waitFor();
await desktop.screenshot({ path: "evidence/issue-discovery-stale-proof.png", fullPage: false });

await open(mobile, "C", "light");
await mobile.getByRole("button", { name: /Prototype issue detail steering/ }).click();
await mobile.getByRole("button", { name: /Issues/ }).waitFor();
await mobile.screenshot({ path: "evidence/issue-discovery-mobile-detail-proof.png", fullPage: true });

await open(desktop, "D", "light");
await desktop.getByRole("button", { name: /Prototype issue detail steering/ }).click();
await desktop.getByRole("heading", { name: "Prototype issue detail steering in shadcn/Base UI" }).waitFor();
await desktop.screenshot({ path: "evidence/issue-discovery-d-rail-route-detail-desktop.png", fullPage: false });
await open(mobile, "D", "dark");
await mobile.getByRole("button", { name: /Prototype issue detail steering/ }).click();
await mobile.getByRole("button", { name: /Issues/ }).waitFor();
await mobile.screenshot({ path: "evidence/issue-discovery-d-rail-route-detail-mobile.png", fullPage: true });

await open(desktop, "A", "light");
await desktop.keyboard.press("ArrowRight");
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("variant") === "B");
await desktop.getByRole("button", { name: "Use dark mode" }).click();
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("mode") === "dark" && document.documentElement.classList.contains("dark"));

await browser.close();
if (errors.length > 0) throw new AggregateError(errors, "Prototype browser checks failed");
console.log("Captured 16 desktop/mobile light/dark views and 7 interaction/freshness proofs; URL, keyboard, Crisp controls, console, and overflow checks passed.");
