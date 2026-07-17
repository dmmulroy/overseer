import { execFileSync } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium } from "playwright-core";

const baseUrl = "http://127.0.0.1:4183/prototype/issue-detail";
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
await rm("evidence", { recursive: true, force: true });
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
  A: "control-strip",
  B: "steering-rail",
  C: "work-map",
};

for (const variant of ["A", "B", "C"]) {
  for (const mode of ["light", "dark"]) {
    await openSpecimen(desktop, variant, mode);
    await desktop.screenshot({
      path: `evidence/detail-${names[variant]}-${mode}.png`,
      fullPage: true,
    });

    await openSpecimen(mobile, variant, mode);
    await mobile.screenshot({
      path: `evidence/detail-${names[variant]}-${mode}-mobile.png`,
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
await captureFrames(12);
await desktop.getByRole("button", { name: "Claim issue", exact: true }).click();
await desktop.getByText("claimed by you", { exact: true }).first().waitFor();
await captureFrames(12);
await desktop.getByRole("button", { name: "Close issue", exact: true }).click();
await desktop.getByText("Closed", { exact: true }).first().waitFor();
await captureFrames(12);

await desktop.getByRole("button", { name: "B", exact: true }).click();
await desktop.locator(".detail--steering-rail").waitFor();
await captureFrames(12);
await desktop.getByRole("button", { name: "C", exact: true }).click();
await desktop.locator(".detail--work-map").waitFor();
await captureFrames(12);
await desktop.locator('[title="Switch to dark mode"]').click();
await desktop.locator(".mode-dark").waitFor();
await captureFrames(12);

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
  "evidence/issue-detail-steering-walkthrough.mp4",
], { stdio: "inherit" });

await rm(frameDirectory, { recursive: true, force: true });
console.log("Captured 12 issue-detail screenshots and an interaction walkthrough.");
