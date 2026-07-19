import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import axe from "axe-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { startGateway } from "../fixtures/gateway.ts";

declare global {
  interface Window {
    axe: { run(): Promise<axe.AxeResults> };
  }
}

const issuer = "https://overseer-browser.cloudflareaccess.com";
const audience = "overseer-browser-audience";
let browser: Browser;
let context: BrowserContext;
let gateway: Miniflare;
let page: Page;
let gatewayUrl: URL;

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(keyPair.publicKey);
  const assertion = await new SignJWT({ email: "owner@example.com", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "browser", typ: "JWT" })
    .setAudience(audience)
    .setIssuer(issuer)
    .setSubject("browser-human")
    .setIssuedAt()
    .setExpirationTime("5 minutes")
    .sign(keyPair.privateKey);
  gateway = await startGateway({
    accessAudience: audience,
    accessIssuer: issuer,
    accessJwks: JSON.stringify({ keys: [{ ...publicJwk, alg: "RS256", kid: "browser" }] }),
    allowedOrigin: "http://localhost",
    assetsDirectory: "dist",
  });
  gatewayUrl = await gateway.ready;
  browser = await chromium.launch();
  context = await browser.newContext({
    extraHTTPHeaders: { "cf-access-jwt-assertion": assertion },
    viewport: { width: 1280, height: 800 },
  });
});

beforeEach(async () => {
  page = await context.newPage();
});

afterEach(async () => {
  await page?.close();
});

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await gateway?.dispose();
});

describe("authenticated application shell", () => {
  it("renders authenticated loading and unavailable states", async () => {
    let releaseApi: (() => void) | undefined;
    const apiReleased = new Promise<void>((resolve) => {
      releaseApi = resolve;
    });
    await page.route("**/api", async (route) => {
      await apiReleased;
      await route.continue();
    });
    await page.goto(gatewayUrl.href);
    const loading = page.getByRole("status", { name: "Loading Overseer" });
    await loading.waitFor();
    expect(await loading.isVisible()).toBe(true);
    releaseApi?.();
    await page.getByRole("heading", { name: "No workspaces yet" }).waitFor();

    await page.unroute("**/api");
    await page.route("**/api", async (route) => {
      await route.continue({
        headers: { ...route.request().headers(), "cf-access-jwt-assertion": "invalid" },
      });
    });
    await page.reload();
    const unavailable = page.getByRole("heading", { name: "Overseer is unavailable" });
    await unavailable.waitFor();
    expect(await page.getByRole("button", { name: "Retry" }).isVisible()).toBe(true);
  });

  it("renders an accessible empty shell through the protected Gateway", async () => {
    await page.goto(gatewayUrl.href);

    const emptyHeading = page.getByRole("heading", { name: "No workspaces yet" });
    await emptyHeading.waitFor();
    expect(await emptyHeading.isVisible()).toBe(true);
    expect(await page.getByRole("navigation", { name: "Workspace and Project context" }).isVisible()).toBe(true);
    expect(await page.getByRole("combobox", { name: "Theme" }).inputValue()).toBe("system");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.addScriptTag({ content: axe.source });
    const accessibility = await page.evaluate(async () => window.axe.run());
    expect(accessibility.violations).toEqual([]);
  });

  it("uses compact mobile context without horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(gatewayUrl.href);
    await page.getByRole("heading", { name: "No workspaces yet" }).waitFor();

    expect(await page.getByRole("navigation", { name: "Workspace and Project context" }).isVisible()).toBe(false);
    expect(await page.getByText("No Project selected").isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.addScriptTag({ content: axe.source });
    const accessibility = await page.evaluate(async () => window.axe.run());
    expect(accessibility.violations).toEqual([]);
  });

  it("applies persisted and live system themes before rendering", async () => {
    await page.addInitScript(() => localStorage.setItem("overseer-theme", "dark"));
    let releaseScript: (() => void) | undefined;
    const scriptReleased = new Promise<void>((resolve) => {
      releaseScript = resolve;
    });
    await page.route("**/assets/*.js", async (route) => {
      await scriptReleased;
      await route.continue();
    });
    const navigation = page.goto(gatewayUrl.href);
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
    releaseScript?.();
    await navigation;
    await page.getByRole("heading", { name: "No workspaces yet" }).waitFor();
    expect(await page.getByRole("combobox", { name: "Theme" }).inputValue()).toBe("dark");
    await page.addScriptTag({ content: axe.source });
    const accessibility = await page.evaluate(async () => window.axe.run());
    expect(accessibility.violations).toEqual([]);

    await page.getByRole("combobox", { name: "Theme" }).selectOption("system");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  });
});
