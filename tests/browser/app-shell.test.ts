import * as Schema from "effect/Schema";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import axe from "axe-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Miniflare } from "miniflare";
import {
  ProjectCollection,
  ProjectResponse,
  WorkspaceResponse,
} from "../../src/contract/http-api.ts";
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
let consoleErrors: Array<string>;
let pageErrors: Array<string>;

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
  const workspace = Schema.decodeUnknownSync(WorkspaceResponse)(await response.json());
  return workspace.id;
}

async function seedProject(workspaceId: string, name: string, key: string): Promise<string> {
  const response = await gateway.dispatchFetch(
    `http://localhost/api/workspaces/${workspaceId}/projects`,
    {
      method: "POST",
      headers: {
        "cf-access-jwt-assertion": assertion,
        "content-type": "application/json",
        "idempotency-key": key,
        origin: "http://localhost",
      },
      body: JSON.stringify({ name }),
    },
  );
  expect(response.status).toBe(201);
  return Schema.decodeUnknownSync(ProjectResponse)(await response.json()).id;
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
  consoleErrors = [];
  pageErrors = [];
  page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
});

afterEach(async () => {
  expect(pageErrors).toEqual([]);
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
    await page.route("**/api", (route) =>
      route.fulfill({
        body: "{}",
        contentType: "application/json",
        status: 200,
      }),
    );
    await page.reload();
    const unavailable = page.getByRole("heading", { name: "Overseer is unavailable" });
    await unavailable.waitFor();
    expect(await page.getByRole("alert").isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Retry" }).isVisible()).toBe(true);
  });

  it("shows a retryable discovery failure while scheduling recovery", async () => {
    let discoveryRequests = 0;
    await page.route("**/api", (route) => {
      discoveryRequests += 1;
      if (discoveryRequests > 1) return route.continue();
      return route.fulfill({
        body: JSON.stringify({
          type: "https://overseer.test/problems/service_unavailable",
          title: "Service unavailable",
          status: 503,
          detail: "Retry the discovery request.",
          code: "service_unavailable",
          request_id: "request_01J00000000000000000000000",
          retryable: true,
        }),
        contentType: "application/problem+json",
        headers: { "retry-after": "0" },
        status: 503,
      });
    });

    await page.goto(gatewayUrl.href);
    await page
      .getByRole("heading", { name: "Overseer is unavailable" })
      .waitFor({ timeout: 1_000 });
    await page.getByRole("heading", { name: "No workspaces yet" }).waitFor({ timeout: 7_000 });

    expect(discoveryRequests).toBe(2);
  });

  it("renders an accessible empty shell without console errors or page errors", async () => {
    await page.goto(new URL("/apiary", gatewayUrl).href);

    const emptyHeading = page.getByRole("heading", { name: "No workspaces yet" });
    await emptyHeading.waitFor();
    expect(await emptyHeading.isVisible()).toBe(true);
    expect(
      await page.getByRole("navigation", { name: "Workspace and Project context" }).isVisible(),
    ).toBe(true);
    expect(await page.getByRole("combobox", { name: "Theme" }).inputValue()).toBe("system");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    await expectNoAccessibilityViolations(page);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  it("uses compact mobile context without horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(gatewayUrl.href);
    await page.getByRole("heading", { name: "No workspaces yet" }).waitFor();

    expect(
      await page.getByRole("navigation", { name: "Workspace and Project context" }).isVisible(),
    ).toBe(false);
    expect(await page.getByText("No Project selected").isVisible()).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
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

    const navigation = page.goto(new URL(`/?workspace_id=${personalId}`, gatewayUrl).href);
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
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({
        body: "{}",
        contentType: "application/json",
        status: 200,
      }),
    );
    await page.getByRole("button", { name: "Refresh Workspaces" }).click();
    await page.getByText("Workspace data may be stale").waitFor();
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(personalId);
    expect(await page.getByRole("heading", { name: "Personal context" }).isVisible()).toBe(true);
    await expectNoAccessibilityViolations(page);

    await page.close();
    page = await context.newPage();
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({
        body: "{}",
        contentType: "application/json",
        status: 200,
      }),
    );
    await page.goto(new URL(`/?workspace_id=${personalId}`, gatewayUrl).href);
    await page.getByRole("heading", { name: "Workspace context unavailable" }).waitFor();
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(personalId);
    await page.unroute("**/api/workspaces");
    await page.getByRole("button", { name: "Retry Workspaces" }).click();
    await page.getByRole("heading", { name: "Personal context" }).waitFor();
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(personalId);
  });

  it("does not select a Workspace without URL-backed selection and exposes desktop selection semantics", async () => {
    const firstId = await seedWorkspace(
      "Missing selection first",
      "browser-missing-selection-first",
    );
    const secondId = await seedWorkspace(
      "Missing selection second",
      "browser-missing-selection-second",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(gatewayUrl.href);
    await page.getByRole("heading", { name: "Selected Workspace unavailable" }).waitFor();

    const workspaceSelector = page.getByRole("combobox", { name: "Workspace" });
    expect(await workspaceSelector.inputValue()).toBe("");
    expect(await workspaceSelector.locator("option:checked").textContent()).toBe(
      "Choose Workspace",
    );
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBeNull();

    await page.setViewportSize({ width: 1280, height: 800 });
    const firstButton = page.getByRole("button", {
      name: "Select Missing selection first Workspace",
    });
    const secondButton = page.getByRole("button", {
      name: "Select Missing selection second Workspace",
    });
    expect(await firstButton.getAttribute("aria-pressed")).toBe("false");
    expect(await secondButton.getAttribute("aria-pressed")).toBe("false");

    await secondButton.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("workspace_id")).toBe(secondId);
    expect(await firstButton.getAttribute("aria-pressed")).toBe("false");
    expect(await secondButton.getAttribute("aria-pressed")).toBe("true");
    expect(firstId).not.toBe(secondId);
  });

  it("keeps the same URL-backed Project context on desktop and mobile", async () => {
    const workspaceId = await seedWorkspace("Project navigation", "browser-project-workspace");
    const firstProjectId = await seedProject(workspaceId, "First Project", "browser-project-first");
    const secondProjectId = await seedProject(
      workspaceId,
      "Second Project",
      "browser-project-second",
    );
    const otherWorkspaceId = await seedWorkspace(
      "Other Workspace",
      "browser-project-other-workspace",
    );
    const otherProjectId = await seedProject(
      otherWorkspaceId,
      "Other Project",
      "browser-project-other",
    );

    await page.goto(
      new URL(`/?workspace_id=${workspaceId}&project_id=${firstProjectId}`, gatewayUrl).href,
    );
    await page.getByRole("heading", { name: "First Project" }).waitFor();
    const secondButton = page.getByRole("button", { name: "Select Second Project Project" });
    await secondButton.focus();
    await secondButton.press("Enter");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("project_id"))
      .toBe(secondProjectId);
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(workspaceId);

    await page.setViewportSize({ width: 390, height: 844 });
    const projectSelector = page.getByRole("combobox", { name: "Project" });
    expect(await projectSelector.inputValue()).toBe(secondProjectId);
    await projectSelector.selectOption(otherProjectId);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("project_id"))
      .toBe(otherProjectId);
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(otherWorkspaceId);
    await page.getByRole("heading", { name: "Other Project" }).waitFor();
    expect(await projectSelector.locator(`option[value="${otherProjectId}"]`).textContent()).toBe(
      "Other Workspace / Other Project",
    );
    await page.reload();
    await page.getByRole("heading", { name: "Other Project" }).waitFor();
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(otherWorkspaceId);
    expect(new URL(page.url()).searchParams.get("project_id")).toBe(otherProjectId);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expectNoAccessibilityViolations(page);
  });

  it("redirects a moved Project to its current Workspace on desktop and mobile", async () => {
    const sourceWorkspaceId = await seedWorkspace(
      "Browser move source",
      "browser-move-source-workspace",
    );
    const targetWorkspaceId = await seedWorkspace(
      "Browser move target",
      "browser-move-target-workspace",
    );
    const projectId = await seedProject(
      sourceWorkspaceId,
      "Browser moved Project",
      "browser-move-project",
    );

    let projectMoved = false;
    let loadedProjects: ProjectCollection | undefined;
    await page.route("**/api/projects", async (route) => {
      if (!projectMoved) {
        const response = await route.fetch();
        loadedProjects = Schema.decodeUnknownSync(ProjectCollection)(await response.json());
        return route.fulfill({ response, body: JSON.stringify(loadedProjects) });
      }
      if (loadedProjects === undefined) throw new Error("Project collection was not loaded");
      return route.fulfill({
        body: JSON.stringify({
          ...loadedProjects,
          items: loadedProjects.items.map((project) =>
            project.id === projectId ? { ...project, workspace_id: targetWorkspaceId } : project,
          ),
        }),
        contentType: "application/json",
        headers: { etag: '"browser-project-moved"' },
        status: 200,
      });
    });

    await page.goto(
      new URL(`/?workspace_id=${sourceWorkspaceId}&project_id=${projectId}`, gatewayUrl).href,
    );
    await page.getByRole("heading", { name: "Browser moved Project" }).waitFor();

    projectMoved = true;
    await page.getByRole("button", { name: "Refresh Projects" }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("workspace_id"))
      .toBe(targetWorkspaceId);
    expect(new URL(page.url()).searchParams.get("project_id")).toBe(projectId);
    expect(await page.getByRole("heading", { name: "Browser moved Project" }).isVisible()).toBe(
      true,
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      new URL(`/?workspace_id=${sourceWorkspaceId}&project_id=${projectId}`, gatewayUrl).href,
    );
    await expect
      .poll(() => new URL(page.url()).searchParams.get("workspace_id"))
      .toBe(targetWorkspaceId);
    const projectSelector = page.getByRole("combobox", { name: "Project" });
    await expect.poll(() => projectSelector.inputValue()).toBe(projectId);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expectNoAccessibilityViolations(page);
  });

  it("disables loading animation when reduced motion is requested", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    let releaseApi: (() => void) | undefined;
    const apiReleased = new Promise<void>((resolve) => {
      releaseApi = resolve;
    });
    await page.route("**/api", async (route) => {
      await apiReleased;
      await route.continue();
    });

    const navigation = page.goto(gatewayUrl.href);
    await page.getByRole("status", { name: "Loading Overseer" }).waitFor();
    expect(
      await page
        .locator(".loading-indicator")
        .evaluate((indicator) => getComputedStyle(indicator).animationName),
    ).toBe("none");
    releaseApi?.();
    await navigation;
  });

  it("keeps stale empty context distinct from a confirmed empty Workspace Registry", async () => {
    const selectedId = "workspace_01J00000000000000000000000";
    let failRefresh = false;
    await page.route("**/api/workspaces", (route) =>
      failRefresh
        ? route.fulfill({
            body: "{}",
            contentType: "application/json",
            status: 200,
          })
        : route.fulfill({
            contentType: "application/json",
            headers: { etag: '"browser-empty-workspaces"' },
            body: JSON.stringify({
              items: [],
              links: { self: { href: "/api/workspaces" } },
            }),
          }),
    );
    await page.goto(new URL(`/?workspace_id=${selectedId}`, gatewayUrl).href);
    await page.getByRole("heading", { name: "No workspaces yet" }).waitFor();

    failRefresh = true;
    await page.getByRole("button", { name: "Refresh Workspaces" }).click();

    await page
      .getByRole("heading", {
        name: "Workspace context could not be refreshed",
      })
      .waitFor();
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(selectedId);
  });

  it("validates cached Workspace pages after an explicit refresh", async () => {
    const workspaceId = await seedWorkspace("Cached Workspace", "browser-cached-workspace");
    await page.goto(new URL(`/?workspace_id=${workspaceId}`, gatewayUrl).href);
    await page.getByRole("heading", { name: "Cached Workspace" }).waitFor();

    let resolveValidator: ((validator: string | undefined) => void) | undefined;
    const validatorReceived = new Promise<string | undefined>((resolve) => {
      resolveValidator = resolve;
    });
    await page.route("**/api/workspaces", (route) => {
      resolveValidator?.(route.request().headers()["if-none-match"]);
      return route.fulfill({ status: 304 });
    });

    await page.getByRole("button", { name: "Refresh Workspaces" }).click();
    expect(await validatorReceived).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(
      await page
        .getByRole("heading", {
          name: "Cached Workspace",
        })
        .isVisible(),
    ).toBe(true);
    expect(await page.getByText("Workspace data may be stale").count()).toBe(0);
  });

  it("loads the URL-selected Workspace beyond the first collection page", async () => {
    for (let index = 0; index < 50; index += 1) {
      await seedWorkspace(
        `A paged Workspace ${index.toString().padStart(2, "0")}`,
        `browser-paged-workspace-${index}`,
      );
    }
    const selectedId = await seedWorkspace(
      "Z Workspace beyond the first page",
      "browser-workspace-beyond-first-page",
    );

    await page.goto(new URL(`/?workspace_id=${selectedId}`, gatewayUrl).href);

    await page
      .getByRole("heading", {
        name: "Z Workspace beyond the first page",
      })
      .waitFor();
    expect(new URL(page.url()).searchParams.get("workspace_id")).toBe(selectedId);
  });

  it("persists light, dark, and system controls and applies each theme before rendering", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(gatewayUrl.href);
    await page.locator("main h1").waitFor();

    const themeControl = page.getByRole("combobox", { name: "Theme" });
    const cases = [
      { preference: "light", resolved: "light" },
      { preference: "dark", resolved: "dark" },
      { preference: "system", resolved: "dark" },
    ] as const;

    for (const themeCase of cases) {
      await themeControl.selectOption(themeCase.preference);
      await page.waitForFunction(
        (resolved) => document.documentElement.dataset.theme === resolved,
        themeCase.resolved,
      );

      let releaseScript: (() => void) | undefined;
      let scriptRequested: (() => void) | undefined;
      const scriptReleased = new Promise<void>((resolve) => {
        releaseScript = resolve;
      });
      const scriptRequestReached = new Promise<void>((resolve) => {
        scriptRequested = resolve;
      });
      await page.route("**/assets/*.js", async (route) => {
        scriptRequested?.();
        await scriptReleased;
        await route.continue();
      });

      const navigation = page.reload();
      await scriptRequestReached;
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(
        themeCase.resolved,
      );
      expect(await page.evaluate(() => document.documentElement.dataset.themeStorageStatus)).toBe(
        "available",
      );
      releaseScript?.();
      await navigation;
      await page.locator("main h1").waitFor();
      expect(await themeControl.inputValue()).toBe(themeCase.preference);
      await page.unroute("**/assets/*.js");
    }

    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await expectNoAccessibilityViolations(page);
  });

  it("reports and replaces an invalid saved theme preference", async () => {
    await page.addInitScript(() => localStorage.setItem("overseer-theme", "sepia"));
    await page.goto(gatewayUrl.href);
    await page.locator("main h1").waitFor();

    expect(await page.evaluate(() => document.documentElement.dataset.themeStorageStatus)).toBe(
      "invalid",
    );
    expect(await page.getByRole("combobox", { name: "Theme" }).inputValue()).toBe("system");
    expect(
      await page
        .getByText("The saved theme preference was invalid. System theme is active.")
        .first()
        .isVisible(),
    ).toBe(true);

    await page.getByRole("combobox", { name: "Theme" }).selectOption("light");
    expect(await page.getByRole("status").count()).toBe(0);
  });

  it("keeps the session theme and reports unavailable browser storage", async () => {
    await page.addInitScript(() => {
      const unavailable = () => {
        throw new DOMException("Storage disabled", "SecurityError");
      };
      Storage.prototype.getItem = unavailable;
      Storage.prototype.setItem = unavailable;
    });
    await page.goto(gatewayUrl.href);
    await page.locator("main h1").waitFor();

    expect(await page.evaluate(() => document.documentElement.dataset.themeStorageStatus)).toBe(
      "unavailable",
    );
    const status = page
      .getByText("Theme storage is unavailable. Your theme remains active for this session.")
      .first();
    expect(await status.isVisible()).toBe(true);

    const themeControl = page.getByRole("combobox", { name: "Theme" });
    await themeControl.selectOption("dark");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    expect(await themeControl.inputValue()).toBe("dark");
    expect(await status.isVisible()).toBe(true);
  });
});
