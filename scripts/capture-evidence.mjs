import { access, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium } from "playwright-core";

const baseUrl = process.env.PROTOTYPE_URL ?? "http://127.0.0.1:5173/prototype/kumo-utility";
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/Users/dillon/.agent-browser/browsers/chrome-147.0.7727.57/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Users/dmmulroy/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
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
for (const page of [desktop, mobile]) page.on("pageerror", (error) => errors.push(error));

async function open(page, variant, mode) {
  await page.goto(`${baseUrl}?variant=${variant}&mode=${mode}`, { waitUntil: "networkidle" });
  await page.locator(".prototype-switcher").waitFor();
  await page.locator(".token-row code").first().waitFor();
  const state = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    mode: document.documentElement.dataset.mode,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (state.theme !== `overseer-utility-${variant.toLowerCase()}` || state.mode !== mode) {
    errors.push(new Error(`Wrong theme state: ${JSON.stringify(state)}`));
  }
  if (state.scrollWidth > state.clientWidth) {
    errors.push(new Error(`${variant}/${mode} horizontally overflows: ${state.scrollWidth} > ${state.clientWidth}`));
  }
}

const names = { A: "faithful", B: "quiet", C: "delineated" };
for (const variant of ["A", "B", "C"]) {
  for (const mode of ["light", "dark"]) {
    await open(desktop, variant, mode);
    await desktop.screenshot({ path: `evidence/kumo-utility-${names[variant]}-${mode}.png`, fullPage: true });
  }
}

for (const mode of ["light", "dark"]) {
  await open(mobile, "A", mode);
  await mobile.screenshot({ path: `evidence/kumo-utility-faithful-${mode}-mobile.png`, fullPage: true });
}

await open(desktop, "A", "light");
await desktop.keyboard.press("ArrowRight");
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("variant") === "B");
await desktop.getByRole("button", { name: "Dark mode" }).click();
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("mode") === "dark");

await browser.close();
if (errors.length > 0) throw new AggregateError(errors, "Prototype browser checks failed");
console.log("Captured 8 screenshots; variant, mode, keyboard, URL, and overflow checks passed.");
