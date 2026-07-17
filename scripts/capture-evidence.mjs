import { execFileSync } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium } from "playwright-core";

const baseUrl = "http://127.0.0.1:4183/prototype/issue-centric";
const frameDirectory = "evidence/frames";
const executableCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/Users/dmmulroy/Library/Caches/ms-playwright/chromium-1200/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Users/dillon/.agent-browser/browsers/chrome-147.0.7727.57/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
].filter((candidate) => candidate !== undefined);

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known local Chromium installation.
    }
  }
  throw new Error("No executable Chromium found; set PLAYWRIGHT_CHROMIUM_EXECUTABLE");
}

const executablePath = await firstExecutable(executableCandidates);
await mkdir("evidence", { recursive: true });
await rm(frameDirectory, { recursive: true, force: true });
await mkdir(frameDirectory, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const desktop = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const pageErrors = [];
desktop.on("pageerror", (error) => pageErrors.push(error));
mobile.on("pageerror", (error) => pageErrors.push(error));

async function openSpecimen(page, variant, mode) {
  await page.goto(`${baseUrl}?variant=${variant}&mode=${mode}`, { waitUntil: "networkidle" });
  await page.locator(".prototype-switcher").waitFor();
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth) {
    pageErrors.push(new Error(`${variant}/${mode} overflows horizontally: ${overflow.scrollWidth}px > ${overflow.clientWidth}px`));
  }
}

const names = {
  A: "utility",
  B: "editorial",
  C: "desktop",
};

for (const variant of ["A", "B", "C"]) {
  for (const mode of ["light", "dark"]) {
    await openSpecimen(desktop, variant, mode);
    await desktop.screenshot({
      path: `evidence/theme-${names[variant]}-${mode}.png`,
      fullPage: true,
    });

    await openSpecimen(mobile, variant, mode);
    await mobile.screenshot({
      path: `evidence/theme-${names[variant]}-${mode}-mobile.png`,
      fullPage: true,
    });
  }
}

let frameNumber = 0;
async function captureFrames(count) {
  for (let index = 0; index < count; index += 1) {
    frameNumber += 1;
    await desktop.screenshot({
      path: `${frameDirectory}/frame-${String(frameNumber).padStart(4, "0")}.png`,
      fullPage: false,
    });
  }
}

await openSpecimen(desktop, "A", "light");
for (const variant of ["A", "B", "C"]) {
  if (variant !== "A") {
    await desktop.getByRole("button", { name: variant, exact: true }).click();
    await desktop.waitForSelector(`.variant-${variant.toLowerCase()}`);
  }
  await captureFrames(12);
  await desktop.locator('[title="Switch to dark mode"]').click();
  await desktop.waitForSelector(".mode-dark");
  await captureFrames(12);
  await desktop.locator('[title="Switch to light mode"]').click();
  await desktop.waitForSelector(".mode-light");
}

await browser.close();

if (pageErrors.length > 0) {
  throw new AggregateError(pageErrors, "Browser errors while capturing prototype evidence");
}

execFileSync("ffmpeg", [
  "-y",
  "-framerate", "12",
  "-i", `${frameDirectory}/frame-%04d.png`,
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "evidence/theme-directions-walkthrough.mp4",
], { stdio: "inherit" });

await rm(frameDirectory, { recursive: true, force: true });
console.log("Captured 12 theme screenshots and a light/dark walkthrough.");
