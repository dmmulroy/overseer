import { execFileSync } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium } from "playwright-core";

const baseUrl = `${process.env.PROTOTYPE_BASE_URL ?? "http://127.0.0.1:4183"}/prototype/issue-discovery`;
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

async function openDirection(page, variant) {
  await page.goto(`${baseUrl}?variant=${variant}`, { waitUntil: "networkidle" });
  await page.locator(".prototype-switcher").waitFor();
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth) {
    pageErrors.push(new Error(`${variant} overflows horizontally: ${overflow.scrollWidth}px > ${overflow.clientWidth}px`));
  }
}

const names = { A: "navigator", B: "index-inspector", C: "focused-route" };
for (const variant of ["A", "B", "C"]) {
  await openDirection(desktop, variant);
  await desktop.screenshot({ path: `evidence/navigation-${names[variant]}-desktop.png`, fullPage: true });
  await openDirection(mobile, variant);
  await mobile.screenshot({ path: `evidence/navigation-${names[variant]}-mobile.png`, fullPage: true });
}

await openDirection(desktop, "A");
await desktop.getByTitle("Open #44; hover or focus prefetched this issue").hover();
await desktop.getByText("#44 prefetched").waitFor();
await desktop.screenshot({ path: "evidence/navigation-prefetch-proof.png", fullPage: false });
await desktop.getByTitle("Open #44; hover or focus prefetched this issue").click();
await desktop.getByText("Opened from prefetch", { exact: true }).waitFor();
await desktop.waitForTimeout(150);
await desktop.screenshot({ path: "evidence/navigation-selection-proof.png", fullPage: false });

await openDirection(mobile, "A");
await mobile.getByTitle("Open #44; hover or focus prefetched this issue").click();
await mobile.getByText("Opened from prefetch", { exact: true }).waitFor();
await mobile.screenshot({ path: "evidence/navigation-mobile-detail-proof.png", fullPage: true });

let frameNumber = 0;
async function captureFrames(count) {
  await desktop.waitForTimeout(100);
  for (let index = 0; index < count; index += 1) {
    frameNumber += 1;
    await desktop.screenshot({
      path: `${frameDirectory}/frame-${String(frameNumber).padStart(4, "0")}.png`,
      fullPage: false,
    });
  }
}

await openDirection(desktop, "A");
await captureFrames(10);
await desktop.getByTitle("Open #44; hover or focus prefetched this issue").hover();
await captureFrames(10);
await desktop.getByTitle("Open #44; hover or focus prefetched this issue").click();
await captureFrames(12);
await desktop.getByRole("button", { name: "B", exact: true }).click();
await captureFrames(10);
await desktop.getByTitle("Switch workspace or project").click();
await desktop.getByRole("button", { name: /Northstar Studio\s+\/\s+Launchpad/ }).click();
await captureFrames(10);
await desktop.getByRole("button", { name: /Label: Any label/ }).click();
await captureFrames(10);
await desktop.getByRole("button", { name: "C", exact: true }).click();
await captureFrames(10);
await desktop.getByRole("button", { name: "Filter", exact: true }).click();
await captureFrames(8);
await desktop.getByTitle("Open #12; hover or focus prefetched this issue").click();
await captureFrames(12);
await desktop.getByRole("button", { name: "← Issues", exact: true }).click();
await captureFrames(8);

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
  "evidence/navigation-walkthrough.mp4",
], { stdio: "inherit" });

await rm(frameDirectory, { recursive: true, force: true });
console.log("Captured six direction screenshots, three interaction proofs, and a walkthrough.");
