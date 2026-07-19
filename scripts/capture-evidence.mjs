import { constants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.PROTOTYPE_URL ?? "http://127.0.0.1:5173/prototype/timeline-contribution";
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/Users/dmmulroy/Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
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

for (const page of [desktop, mobile]) {
  page.on("pageerror", (error) => errors.push(error));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(new Error(`Browser console at ${message.location().url}: ${message.text()}`));
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(new Error(`Browser response ${response.status()}: ${response.url()}`));
  });
}

async function open(page, variant, mode) {
  await page.goto(`${baseUrl}?variant=${variant}&mode=${mode}`, { waitUntil: "networkidle" });
  await page.locator(".prototype-switcher").waitFor();
  await page.evaluate(() => document.fonts.ready);
  const state = await page.evaluate(() => ({
    variant: new URL(location.href).searchParams.get("variant"),
    mode: new URL(location.href).searchParams.get("mode"),
    rootMode: document.documentElement.dataset.mode,
    darkClass: document.documentElement.classList.contains("dark"),
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    background: getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
    buttonSlot: document.querySelector("[data-slot='button']")?.getAttribute("data-slot"),
    textareaSlot: document.querySelector("[data-slot='textarea']")?.getAttribute("data-slot"),
  }));
  if (state.variant !== variant || state.mode !== mode || state.rootMode !== mode || state.darkClass !== (mode === "dark")) {
    errors.push(new Error(`Wrong URL/root state: ${JSON.stringify(state)}`));
  }
  if (state.background.length === 0 || state.buttonSlot !== "button" || state.textareaSlot !== "textarea") {
    errors.push(new Error(`Missing Crisp or application-owned recipe state: ${JSON.stringify(state)}`));
  }
  if (state.scrollWidth > state.clientWidth) {
    errors.push(new Error(`${variant}/${mode} horizontally overflows: ${state.scrollWidth} > ${state.clientWidth}`));
  }
}

const names = { A: "narrative-thread", B: "brief-checkpoints", C: "conversation-ledger" };
for (const variant of ["A", "B", "C"]) {
  for (const mode of ["light", "dark"]) {
    await open(desktop, variant, mode);
    await desktop.screenshot({ path: `evidence/timeline-${names[variant]}-${mode}-desktop.png`, fullPage: true });
    await open(mobile, variant, mode);
    await mobile.screenshot({ path: `evidence/timeline-${names[variant]}-${mode}-mobile.png`, fullPage: true });
  }
}

await open(desktop, "A", "light");
await desktop.getByRole("button", { name: /4 changes/ }).click();
await desktop.locator(".digest-list").waitFor();
await desktop.screenshot({ path: "evidence/interaction-a-expanded-digest.png", fullPage: true });
await desktop.getByRole("button", { name: "Preview" }).click();
await desktop.locator(".compose-preview").waitFor();
await desktop.screenshot({ path: "evidence/interaction-composer-preview.png", fullPage: true });

await open(mobile, "C", "dark");
await mobile.getByRole("button", { name: "Changes 5" }).click();
await mobile.locator(".ledger").waitFor();
await mobile.screenshot({ path: "evidence/interaction-c-mobile-changes.png", fullPage: true });

await open(desktop, "A", "light");
await desktop.keyboard.press("ArrowRight");
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("variant") === "B");
await desktop.getByRole("button", { name: "Show Conversation + ledger" }).click();
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("variant") === "C");
await desktop.getByRole("button", { name: "Dark mode" }).click();
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("mode") === "dark" && document.documentElement.classList.contains("dark"));

await browser.close();
if (errors.length > 0) throw new AggregateError(errors, "Prototype browser checks failed");
console.log("Captured 15 screenshots; desktop/mobile light/dark, URL switching, keyboard, theme, interactions, recipes, console, and overflow checks passed.");
