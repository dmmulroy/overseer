import { constants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.PROTOTYPE_URL ?? "http://127.0.0.1:4183/prototype/issue-detail";
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/Users/dmmulroy/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Users/dillon/.agent-browser/browsers/chrome-147.0.7727.57/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
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
    if (message.type() === "error") errors.push(new Error(`Browser console: ${message.text()}`));
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(new Error(`Browser response ${response.status()}: ${response.url()}`));
  });
}

async function open(page, variant, mode) {
  await page.goto(`${baseUrl}?variant=${variant}&mode=${mode}`, { waitUntil: "networkidle" });
  await page.locator(`[data-variant="${variant}"]`).waitFor();
  await page.locator(".prototype-switcher").waitFor();
  const state = await page.evaluate(() => ({
    variant: new URL(location.href).searchParams.get("variant"),
    mode: new URL(location.href).searchParams.get("mode"),
    dark: document.documentElement.classList.contains("dark"),
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (state.variant !== variant || state.mode !== mode || state.dark !== (mode === "dark")) {
    errors.push(new Error(`Wrong URL/theme state: ${JSON.stringify(state)}`));
  }
  if (state.scrollWidth > state.clientWidth) {
    errors.push(new Error(`${variant}/${mode} horizontally overflows: ${state.scrollWidth} > ${state.clientWidth}`));
  }
}

const names = { A: "command-header", B: "steering-rail", C: "readiness-board" };
for (const variant of ["A", "B", "C"]) {
  for (const mode of ["light", "dark"]) {
    await open(desktop, variant, mode);
    await desktop.screenshot({ path: `evidence/issue-detail-${names[variant]}-${mode}-desktop.png`, fullPage: true });
    await open(mobile, variant, mode);
    await mobile.screenshot({ path: `evidence/issue-detail-${names[variant]}-${mode}-mobile.png`, fullPage: true });
  }
}

await open(desktop, "A", "light");
const controlRecipe = await desktop.evaluate(() => {
  const button = document.querySelector('[data-slot="button"]');
  if (!(button instanceof HTMLButtonElement)) return null;
  const style = getComputedStyle(button);
  return { height: style.height, radius: style.borderRadius, fontSize: style.fontSize };
});
if (controlRecipe?.height !== "28px" || controlRecipe.radius !== "4px" || controlRecipe.fontSize !== "13px") {
  errors.push(new Error(`Crisp Base UI control recipe regressed: ${JSON.stringify(controlRecipe)}`));
}

await desktop.keyboard.press("ArrowRight");
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("variant") === "B");
await desktop.locator('[data-variant="B"]').waitFor();
await desktop.getByRole("button", { name: "Release claim", exact: true }).first().click();
await desktop.getByRole("status").filter({ hasText: "unassigned" }).waitFor();
await desktop.getByRole("button", { name: "Claim issue", exact: true }).first().waitFor();
await desktop.getByRole("button", { name: "Close issue", exact: true }).first().click();
await desktop.getByRole("status").filter({ hasText: "closed" }).waitFor();
await desktop.getByRole("button", { name: "Reopen issue", exact: true }).first().waitFor();
await desktop.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
await desktop.waitForFunction(() => document.documentElement.classList.contains("dark") && new URL(location.href).searchParams.get("mode") === "dark");
await desktop.screenshot({ path: "evidence/issue-detail-interaction-proof.png", fullPage: true });

await browser.close();
if (errors.length > 0) throw new AggregateError(errors, "Prototype browser checks failed");
console.log("Captured 13 screenshots; desktop/mobile light/dark, URL switching, Crisp recipes, action applicability, theme, console, and overflow checks passed.");
