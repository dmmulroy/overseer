import { constants } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.PROTOTYPE_URL ?? "http://127.0.0.1:5173/prototype/utility-foundation";
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
  await page.locator(".token-row code").first().waitFor();
  const state = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    mode: document.documentElement.dataset.mode,
    darkClass: document.documentElement.classList.contains("dark"),
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    tokens: ["--background", "--primary", "--success", "--warning", "--info"].map((token) =>
      getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    ),
  }));
  if (state.theme !== `overseer-utility-${variant.toLowerCase()}` || state.mode !== mode || state.darkClass !== (mode === "dark")) {
    errors.push(new Error(`Wrong root theme state: ${JSON.stringify(state)}`));
  }
  if (state.tokens.some((token) => token.length === 0)) {
    errors.push(new Error(`${variant}/${mode} has an empty semantic token: ${JSON.stringify(state.tokens)}`));
  }
  if (state.scrollWidth > state.clientWidth) {
    errors.push(new Error(`${variant}/${mode} horizontally overflows: ${state.scrollWidth} > ${state.clientWidth}`));
  }
}

const names = { A: "balanced", B: "crisp", C: "roomy" };
for (const variant of ["A", "B", "C"]) {
  for (const mode of ["light", "dark"]) {
    await open(desktop, variant, mode);
    await desktop.screenshot({ path: `evidence/utility-foundation-${names[variant]}-${mode}.png`, fullPage: true });
  }
}

for (const mode of ["light", "dark"]) {
  await open(mobile, "A", mode);
  await mobile.screenshot({ path: `evidence/utility-foundation-balanced-${mode}-mobile.png`, fullPage: true });
}

const expectedRecipes = {
  A: { height: "28px", radius: "6px" },
  B: { height: "28px", radius: "4px" },
  C: { height: "30px", radius: "8px" },
};
for (const variant of ["A", "B", "C"]) {
  await open(desktop, variant, "light");
  const controls = await desktop.evaluate(() => {
    const newIssue = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("New issue"));
    const filter = document.querySelector('input[aria-label="Filter issues"]');
    if (!(newIssue instanceof HTMLButtonElement) || !(filter instanceof HTMLInputElement)) return null;
    const buttonStyle = getComputedStyle(newIssue);
    const inputStyle = getComputedStyle(filter);
    return {
      buttonSlot: newIssue.dataset.slot,
      inputSlot: filter.dataset.slot,
      buttonHeight: buttonStyle.height,
      inputHeight: inputStyle.height,
      buttonRadius: buttonStyle.borderRadius,
      inputRadius: inputStyle.borderRadius,
      buttonFontFamily: buttonStyle.fontFamily,
      buttonFontSize: buttonStyle.fontSize,
      inputFontSize: inputStyle.fontSize,
    };
  });
  const expected = expectedRecipes[variant];
  if (
    controls === null
    || controls.buttonSlot !== "button"
    || controls.inputSlot !== "input"
    || controls.buttonHeight !== expected.height
    || controls.inputHeight !== expected.height
    || controls.buttonRadius !== expected.radius
    || controls.inputRadius !== expected.radius
    || !controls.buttonFontFamily.includes("Geist Variable")
    || controls.buttonFontSize !== "13px"
    || controls.inputFontSize !== "13px"
  ) {
    errors.push(new Error(`${variant} Base UI/shadcn control recipe regressed: ${JSON.stringify(controls)}`));
  }
}

await open(desktop, "A", "light");
await desktop.keyboard.press("ArrowRight");
await desktop.waitForFunction(() => new URL(location.href).searchParams.get("variant") === "B");
await desktop.getByRole("button", { name: "Dark mode" }).click();
await desktop.waitForFunction(() =>
  new URL(location.href).searchParams.get("mode") === "dark" && document.documentElement.classList.contains("dark"),
);

await browser.close();
if (errors.length > 0) throw new AggregateError(errors, "Prototype browser checks failed");
console.log("Captured 8 screenshots; Base UI/shadcn recipes, root state, keyboard, URL, console, and overflow checks passed.");
