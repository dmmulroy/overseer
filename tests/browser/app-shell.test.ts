import * as Schema from "effect/Schema";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import axe from "axe-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { WorkspaceRepresentation } from "../../src/contract/http-api.ts";
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
let assertion: string;

async function expectNoAccessibilityViolations(target: Page): Promise<void> {
  await target.addScriptTag({ content: axe.source });
  const accessibility = await target.evaluate(async () => window.axe.run());
  expect(accessibility.violations).toEqual([]);
}

async function seedWorkspace(name: string, key: string): Promise<string> {
  const response = await gateway.dispatchFetch("http://localhost/api/workspaces", {
    method: "POST",
    headers: {
      "cf-access-jwt-assertion": assertion,
      "content-type": "application/json",
      "idempotency-key": key,
      origin: "http://localhost",
    },
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  const workspace = Schema.decodeUnknownSync(WorkspaceRepresentation)(
    await response.json(),
  );
  return workspace.id;
}

beforeAll(async () => {
  const keyPair = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(keyPair.publicKey);
  assertion = await new SignJWT({ email: "owner@example.com", type: "app" })
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

  it("renders an accessible empty shell outside the exact API namespace", async () => {
    await page.goto(new URL("/apiary", gatewayUrl).href);

    const emptyHeading = page.getByRole("heading", { name: "No workspaces yet" });
    await emptyHeading.waitFor();
    expect(await emptyHeading.isVisible()).toBe(true);
    expect(await page.getByRole("navigation", { name: "Workspace and Project context" }).isVisible()).toBe(true);
    expect(await page.getByRole("combobox", { name: "Theme" }).inputValue()).toBe("system");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await expectNoAccessibilityViolations(page);
  });

  it("uses compact mobile context without horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(gatewayUrl.href);
    await page.getByRole("heading", { name: "No workspaces yet" }).waitFor();

    expect(await page.getByRole("navigation", { name: "Workspace and Project context" }).isVisible()).toBe(false);
    expect(await page.getByText("No Project selected").isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAccessibilityViolations(page);
  });

  it("keeps URL-backed Workspace context through pointer, keyboard, stale, and unavailable states", async () => {
    const personalId = await seedWorkspace("Personal context", "browser-workspace-personal");
    const overseerId = await seedWorkspace("Overseer context", "browser-workspace-overseer");
    let releaseWorkspaces: (() => void) | undefined;
    const workspacesReleased = new Promise<void>((resolve) => {
      releaseWorkspaces = resolve;
    });
    await page.route("**/api/workspaces", async (route) => {
      await workspacesReleased;
      await route.continue();
    });

    const navigation = page.goto(
      new URL(`/?workspace_id=${personalId}`, gatewayUrl).href,
    );
    await page.getByRole("status", { name: "Loading Workspace context" }).waitFor();
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(personalId);
    releaseWorkspaces?.();
    await navigation;
    await page.getByRole("heading", { name: "Personal context" }).waitFor();

    await page.getByRole("button", { name: "Select Overseer context Workspace" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("workspace_id")).toBe(overseerId);
    await page.getByRole("heading", { name: "Overseer context" }).waitFor();
    await page.locator(".context-rail .brand").click();
    await expect.poll(() => new URL(page.url()).searchParams.get("workspace_id")).toBe(overseerId);

    const personalButton = page.getByRole("button", { name: "Select Personal context Workspace" });
    await personalButton.focus();
    await personalButton.press("Enter");
    await expect.poll(() => new URL(page.url()).searchParams.get("workspace_id")).toBe(personalId);

    await page.setViewportSize({ width: 390, height: 844 });
    const workspaceSelector = page.getByRole("combobox", { name: "Workspace" });
    expect(await workspaceSelector.inputValue()).toBe(personalId);

    await page.unroute("**/api/workspaces");
    await page.route("**/api/workspaces", (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: "Refresh Workspaces" }).click();
    await page.getByText("Workspace data may be stale").waitFor();
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(personalId);
    expect(await page.getByRole("heading", { name: "Personal context" }).isVisible()).toBe(true);
    await expectNoAccessibilityViolations(page);

    await page.close();
    page = await context.newPage();
    await page.route("**/api/workspaces", (route) => route.abort("internetdisconnected"));
    await page.goto(new URL(`/?workspace_id=${personalId}`, gatewayUrl).href);
    await page.getByRole("heading", { name: "Workspace context unavailable" }).waitFor();
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(personalId);
    await page.unroute("**/api/workspaces");
    await page.getByRole("button", { name: "Retry Workspaces" }).click();
    await page.getByRole("heading", { name: "Personal context" }).waitFor();
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(personalId);
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
    await page.locator("main h1").filter({ hasText: /No workspaces yet|Overseer context/ }).waitFor();
    expect(await page.getByRole("combobox", { name: "Theme" }).inputValue()).toBe("dark");
    await expectNoAccessibilityViolations(page);

    await page.getByRole("combobox", { name: "Theme" }).selectOption("system");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  });
});
