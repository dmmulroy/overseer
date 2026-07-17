import { execFileSync } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium } from "playwright-core";

const baseUrl = "http://127.0.0.1:4183/prototype/mutation-sync";
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
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const pageErrors = [];
desktop.on("pageerror", (error) => pageErrors.push(error));
mobile.on("pageerror", (error) => pageErrors.push(error));

async function openState(page, variant, state, mode = "light") {
  await page.goto(`${baseUrl}?variant=${variant}&mode=${mode}&state=${state}`, { waitUntil: "networkidle" });
  await page.locator(".prototype-switcher").waitFor();
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth) {
    pageErrors.push(new Error(`${variant}/${mode}/${state} overflows horizontally: ${overflow.scrollWidth}px > ${overflow.clientWidth}px`));
  }
}

async function screenshot(page, path) {
  await page.screenshot({ path, fullPage: true });
}

for (const [variant, name] of [["A", "inline"], ["B", "workspace"], ["C", "timeline"]]) {
  await openState(desktop, variant, "steady");
  await screenshot(desktop, `evidence/direction-${variant.toLowerCase()}-${name}.png`);
  await openState(mobile, variant, "steady");
  await screenshot(mobile, `evidence/direction-${variant.toLowerCase()}-${name}-mobile.png`);
}

const featuredStates = [
  ["A", "conflict", "conflict-inline"],
  ["A", "incoming", "incoming-inline"],
  ["B", "reconnecting", "reconnecting-workspace"],
  ["C", "closed", "closed-timeline"],
  ["A", "confirm-delete", "delete-confirmation"],
  ["B", "deleted", "deleted-restore"],
  ["C", "conflict", "conflict-timeline-dark", "dark"],
];
for (const [variant, state, name, mode = "light"] of featuredStates) {
  await openState(desktop, variant, state, mode);
  await screenshot(desktop, `evidence/${name}.png`);
}

// Exercise every recovery path at both desktop and mobile widths and check overflow.
for (const page of [desktop, mobile]) {
  for (const variant of ["A", "B", "C"]) {
    for (const mode of ["light", "dark"]) {
      for (const state of ["steady", "editing", "conflict", "incoming", "reconnecting", "closed", "confirm-delete", "deleted"]) {
        await openState(page, variant, state, mode);
      }
    }
  }
}

let frameNumber = 0;
async function captureFrames(count = 8) {
  for (let index = 0; index < count; index += 1) {
    frameNumber += 1;
    await desktop.screenshot({ path: `${frameDirectory}/frame-${String(frameNumber).padStart(4, "0")}.png`, fullPage: false });
  }
}
async function chooseScenario(name) {
  await desktop.getByRole("button", { name, exact: true }).first().click();
  await captureFrames();
}

await openState(desktop, "A", "steady");
await captureFrames();
await desktop.getByRole("main").getByRole("button", { name: "Edit", exact: true }).click();
await desktop.locator("#inline-title").fill("Keep every draft safe during reconnect and cache repair");
await captureFrames();
await chooseScenario("Conflict");
await desktop.getByRole("button", { name: "Save my version", exact: true }).click();
await captureFrames();
await chooseScenario("Incoming");
await desktop.getByRole("button", { name: "Keep editing", exact: true }).click();
await captureFrames();
await chooseScenario("Reconnect");
await desktop.getByRole("button", { name: "Retry now", exact: true }).click();
await captureFrames();
await desktop.getByRole("button", { name: "Close", exact: true }).last().click();
await captureFrames();
await desktop.getByRole("button", { name: "Reopen", exact: true }).last().click();
await desktop.locator('[title="More actions: delete issue"]').click();
await captureFrames();
await desktop.getByRole("button", { name: "Delete issue", exact: true }).click();
await captureFrames();
await desktop.getByRole("button", { name: "Restore issue", exact: true }).click();
await captureFrames();

await desktop.getByRole("button", { name: "B", exact: true }).click();
await captureFrames();
await chooseScenario("Conflict");
await chooseScenario("Reconnect");
await desktop.getByRole("button", { name: "Retry now", exact: true }).click();
await captureFrames();

await desktop.getByRole("button", { name: "C", exact: true }).click();
await captureFrames();
await chooseScenario("Incoming");
await chooseScenario("Close / reopen");
await chooseScenario("Delete");
await desktop.getByRole("button", { name: "Delete issue", exact: true }).click();
await captureFrames();
await desktop.getByRole("button", { name: "Restore issue", exact: true }).click();
await captureFrames();

await browser.close();

if (pageErrors.length > 0) {
  throw new AggregateError(pageErrors, "Browser errors while capturing prototype evidence");
}

execFileSync("ffmpeg", [
  "-y",
  "-framerate", "10",
  "-i", `${frameDirectory}/frame-%04d.png`,
  "-c:v", "libx264",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "evidence/mutation-sync-walkthrough.mp4",
], { stdio: "inherit" });

await rm(frameDirectory, { recursive: true, force: true });
console.log("Captured 13 screenshots, responsive state checks, and an interaction walkthrough.");
