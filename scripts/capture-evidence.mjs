import { execFileSync } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium } from "playwright-core";

const baseUrl = process.env.EVIDENCE_BASE_URL ?? "http://127.0.0.1:4183/prototype/timeline-contribution";
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
const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const pageErrors = [];
desktop.on("pageerror", (error) => pageErrors.push(error));
mobile.on("pageerror", (error) => pageErrors.push(error));

async function openVariant(page, variant) {
  await page.goto(`${baseUrl}?variant=${variant}`, { waitUntil: "networkidle" });
  await page.locator(`.variant-${variant.toLowerCase()}`).waitFor();
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth) {
    pageErrors.push(new Error(`${variant} overflows horizontally: ${overflow.scrollWidth}px > ${overflow.clientWidth}px`));
  }
}

const names = { A: "thread-digests", B: "brief-work-log", C: "focused-channels" };
for (const variant of ["A", "B", "C"]) {
  await openVariant(desktop, variant);
  await desktop.screenshot({ path: `evidence/timeline-${names[variant]}-desktop.png`, fullPage: true });
  await openVariant(mobile, variant);
  await mobile.screenshot({ path: `evidence/timeline-${names[variant]}-mobile.png`, fullPage: true });
}

await openVariant(desktop, "A");
await desktop.locator(".digest-toggle").click();
await desktop.locator(".digest-events").waitFor();
await desktop.screenshot({ path: "evidence/interaction-a-expanded-digest.png", fullPage: true });

await openVariant(desktop, "B");
await desktop.getByRole("button", { name: "Preview", exact: true }).click();
await desktop.locator(".comment-preview").waitFor();
await desktop.screenshot({ path: "evidence/interaction-b-markdown-preview.png", fullPage: true });

await openVariant(desktop, "C");
await desktop.getByRole("button", { name: "Changes 6", exact: true }).click();
await desktop.locator(".changes-channel").waitFor();
await desktop.screenshot({ path: "evidence/interaction-c-changes-channel.png", fullPage: true });
await desktop.getByRole("button", { name: "Files 3", exact: true }).click();
await desktop.locator(".files-channel").waitFor();
await desktop.screenshot({ path: "evidence/interaction-c-files-channel.png", fullPage: true });

let frameNumber = 0;
async function captureFrames(count) {
  for (let index = 0; index < count; index += 1) {
    frameNumber += 1;
    await desktop.screenshot({ path: `${frameDirectory}/frame-${String(frameNumber).padStart(4, "0")}.png` });
  }
}

await openVariant(desktop, "A");
await captureFrames(10);
await desktop.locator(".digest-toggle").click();
await captureFrames(14);
await desktop.getByTitle("Next variant").click();
await desktop.evaluate(() => window.scrollTo(0, 0));
await captureFrames(14);
await desktop.getByRole("button", { name: "Preview", exact: true }).click();
await captureFrames(12);
await desktop.getByTitle("Next variant").click();
await desktop.evaluate(() => window.scrollTo(0, 0));
await captureFrames(14);
await desktop.getByRole("button", { name: "Changes 6", exact: true }).click();
await captureFrames(14);
await desktop.getByRole("button", { name: "Files 3", exact: true }).click();
await captureFrames(14);

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
  "evidence/timeline-interactions-walkthrough.mp4",
], { stdio: "inherit" });

await rm(frameDirectory, { recursive: true, force: true });
console.log("Captured 6 comparison screenshots, 4 interaction proofs, and a walkthrough video.");
