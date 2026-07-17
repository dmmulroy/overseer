import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = "http://127.0.0.1:4183/prototype/issue-centric";
const executablePath = "/Users/dillon/.agent-browser/browsers/chrome-147.0.7727.57/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const frameDirectory = "evidence/frames";

await mkdir("evidence", { recursive: true });
await rm(frameDirectory, { recursive: true, force: true });
await mkdir(frameDirectory, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error));

async function openVariant(variant) {
  await page.goto(`${baseUrl}?variant=${variant}`, { waitUntil: "networkidle" });
  await page.locator(".prototype-switcher").waitFor();
}

async function still(name, fullPage = true) {
  await page.screenshot({ path: `evidence/${name}.png`, fullPage });
}

let frameNumber = 0;
async function frames(count) {
  for (let index = 0; index < count; index += 1) {
    frameNumber += 1;
    await page.screenshot({
      path: `${frameDirectory}/frame-${String(frameNumber).padStart(4, "0")}.png`,
      fullPage: false,
    });
  }
}

await openVariant("A");
await still("variant-a-workbench");
await openVariant("B");
await still("variant-b-paper-trail");
await openVariant("C");
await still("variant-c-ops-console", false);

await openVariant("A");
await frames(12);

await page.getByRole("button", { name: "Test conflict", exact: true }).click();
await still("conflict-state", false);
await frames(12);
await page.getByRole("button", { name: "Use current", exact: true }).click();
await frames(4);

await page.getByRole("button", { name: "B", exact: true }).click();
await page.waitForSelector(".variant-b");
await frames(12);

await page.getByRole("button", { name: "C", exact: true }).click();
await page.waitForSelector(".variant-c");
await frames(12);

await page.getByRole("button", { name: "Live", exact: false }).click();
await frames(8);
await page.getByRole("button", { name: "Delete", exact: true }).click();
await page.getByRole("dialog", { name: "Delete Issue" }).waitFor();
await still("delete-confirmation", false);
await frames(8);
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await frames(4);

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
  "evidence/issue-interface-walkthrough.mp4",
], { stdio: "inherit" });

await rm(frameDirectory, { recursive: true, force: true });
console.log(`Captured ${frameNumber} browser frames and five proof screenshots.`);
