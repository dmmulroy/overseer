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

const variantProofs = [
  ["A", "variant-a-workbench", true],
  ["B", "variant-b-paper-trail", true],
  ["C", "variant-c-ops-console", false],
  ["D", "variant-d-solo-split", false],
  ["E", "variant-e-blueprint", false],
  ["F", "variant-f-index", false],
  ["G", "variant-g-dispatch", false],
  ["H", "variant-h-ledger", false],
  ["I", "variant-i-orbit", false],
  ["J", "variant-j-notebook", false],
  ["K", "variant-k-dock", false],
  ["L", "variant-l-signal", false],
  ["M", "variant-m-quiet", false],
];

for (const [variant, name, fullPage] of variantProofs) {
  await openVariant(variant);
  await still(name, fullPage);
}

await openVariant("D");
await frames(8);
for (const variant of ["E", "F", "G", "H", "I", "J", "K", "L", "M"]) {
  await page.getByRole("button", { name: variant, exact: true }).click();
  await page.waitForSelector(`.variant-${variant.toLowerCase()}`);
  await frames(8);
}

await openVariant("A");
await page.getByRole("button", { name: "Test conflict", exact: true }).click();
await still("conflict-state", false);
await frames(8);

await openVariant("C");
await page.getByRole("button", { name: "Delete", exact: true }).click();
await page.getByRole("dialog", { name: "Delete Issue" }).waitFor();
await still("delete-confirmation", false);
await frames(8);

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
console.log(`Captured ${frameNumber} browser frames and ${variantProofs.length + 2} proof screenshots.`);
