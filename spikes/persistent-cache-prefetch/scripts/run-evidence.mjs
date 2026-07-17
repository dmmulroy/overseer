import { writeFile } from "node:fs/promises";
import process from "node:process";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const chromePaths = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "/usr/bin/google-chrome",
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};
const executablePath = process.env.CHROME_PATH ?? chromePaths[process.platform];
if (executablePath === undefined) {
  throw new Error("Set CHROME_PATH to a Chromium-compatible browser executable");
}

const server = await createServer({
  configFile: "vite.config.ts",
  logLevel: "error",
});
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--disable-background-timer-throttling"],
});

const failures = [];
try {
  await server.listen();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on("console", (message) => {
    console.log(`browser ${message.type()}: ${message.text()}`);
    if (message.type() === "error") {
      failures.push(`browser console: ${message.text()}`);
    }
  });
  await page.goto("http://127.0.0.1:4178", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    document.documentElement.dataset.spikeReady === "true"
    || document.documentElement.dataset.spikeFailed === "true");
  if (await page.evaluate(() => document.documentElement.dataset.spikeFailed === "true")) {
    throw new Error(await page.locator("body").innerText());
  }

  const migration = await page.evaluate(() => window.__overseerSpike.migrationEvidence);

  await page.evaluate(() => window.__overseerSpike.waitForCompleted(1));
  const prefetchHit = await page.evaluate(async () => {
    window.__overseerSpike.clearNetworkLog();
    const paintMs = await window.__overseerSpike.clickIssue(1);
    return { paintMs, log: window.__overseerSpike.networkLog() };
  });

  const rowTwo = page.locator('[data-issue-number="2"]');
  const box = await rowTwo.boundingBox();
  if (box === null) {
    throw new Error("Issue 2 row has no bounding box");
  }
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  const selectedOnPointerDown = await page.evaluate(() => window.__overseerSpike.selectedIssue());
  await page.mouse.up();
  await page.waitForFunction(() => window.__overseerSpike.selectedIssue() === 2);

  const cachedRoutes = await page.evaluate(() =>
    window.__overseerSpike.measureCachedRoutePaint(
      Array.from({ length: 30 }, (_, index) => 201 + index),
    ));

  await page.evaluate(() => window.__overseerSpike.setNetwork(
    { saveData: false, effectiveType: "4g" },
    500,
  ));
  const cancellation = await page.evaluate(() => window.__overseerSpike.cancellationProbe(160));

  await page.evaluate(() => window.__overseerSpike.setNetwork(
    { saveData: false, effectiveType: "4g" },
    120,
  ));
  const deduplication = await page.evaluate(() => window.__overseerSpike.deduplicationProbe(161));

  await page.evaluate(() => window.__overseerSpike.setNetwork(
    { saveData: false, effectiveType: "4g" },
    500,
  ));
  const baseline = await page.evaluate(() => window.__overseerSpike.activeLatency(170, []));
  const withBackground = await page.evaluate(() =>
    window.__overseerSpike.activeLatency(171, [172, 173, 174, 175]));

  const saveData = await page.evaluate(() => window.__overseerSpike.constrainedProbe(
    { saveData: true, effectiveType: "4g" },
    [180],
  ));
  const twoG = await page.evaluate(() => window.__overseerSpike.constrainedProbe(
    { saveData: false, effectiveType: "2g" },
    [181],
  ));
  const threeG = await page.evaluate(() => window.__overseerSpike.constrainedProbe(
    { saveData: false, effectiveType: "3g" },
    [182, 183],
  ));

  const reconnect = await page.evaluate(() => window.__overseerSpike.reconnectGapProbe());
  const quota = await page.evaluate(() => window.__overseerSpike.quotaProbe());
  await page.waitForTimeout(100);
  const webVitals = await page.evaluate(() => window.__overseerSpike.webVitals());
  const corruptionRecovery = await page.evaluate(() =>
    window.__overseerSpike.corruptionRecoveryProbe());

  const started = (records) => records.filter((record) => record.event === "started");
  const gates = {
    canonicalRebuildAndDraftMigration:
      migration.canonicalV1Discarded
      && migration.draftV1Migrated
      && migration.persistedSnapshotsRestored === 40,
    canonicalCorruptionRecovery:
      corruptionRecovery.result.recovered
      && corruptionRecovery.result.restoredSnapshots === 0
      && corruptionRecovery.draftPreserved,
    cachedRoutePaintP95: cachedRoutes.p95Ms < 100 && cachedRoutes.networkStarts === 0,
    prefetchHitHasNoBlockingRead: prefetchHit.paintMs < 100 && started(prefetchHit.log).length === 0,
    semanticClickNavigation: selectedOnPointerDown === 1,
    requestCancellation:
      cancellation.some((record) => record.issueNumber === 160 && record.event === "aborted"),
    requestDeduplication: started(deduplication).filter((record) => record.issueNumber === 161).length === 1,
    activeRequestNotDelayed:
      withBackground.durationMs <= baseline.durationMs + 50
      && started(withBackground.log).some((record) =>
        record.issueNumber === 171 && record.priority === "active"),
    constrainedNetworkPolicy:
      started(saveData).length === 0
      && started(twoG).length === 0
      && started(threeG).length === 1,
    reconnectGapReplayed:
      reconnect.result._tag === "Replayed"
      && reconnect.persistedCursor === 13
      && reconnect.loadSnapshotCalls === 0,
    quotaAwareEvictionPreservesDrafts:
      quota.eviction.evictedQueries + quota.eviction.evictedTimelinePages > 0
      && quota.after.queries + quota.after.timelinePages < quota.before.queries + quota.before.timelinePages
      && quota.draftPreserved,
    goodCoreWebVitals:
      webVitals.lcpMs <= 2_500
      && webVitals.cls <= 0.1
      && webVitals.inpMs <= 200,
  };

  const evidence = {
    generatedAt: new Date().toISOString(),
    runtime: {
      browser: await browser.version(),
      viewport: "1280x820",
      projectIssues: 400,
      cachedRouteSamples: cachedRoutes.samples.length,
    },
    budgets: {
      cachedRoutePaintP95Ms: 100,
      inpMs: 200,
      lcpMs: 2_500,
      cls: 0.1,
    },
    measurements: {
      cachedRoutePaintP95Ms: cachedRoutes.p95Ms,
      cachedRoutePaintMaxMs: Math.max(...cachedRoutes.samples),
      prefetchHitPaintMs: prefetchHit.paintMs,
      prefetchHitNetworkStarts: started(prefetchHit.log).length,
      activeBaselineMs: baseline.durationMs,
      activeWithBackgroundMs: withBackground.durationMs,
      lcpMs: webVitals.lcpMs,
      cls: webVitals.cls,
      inpMs: webVitals.inpMs,
    },
    exercised: {
      migration,
      cancellation,
      deduplication,
      constrained: { saveData, twoG, threeG },
      reconnect,
      quota,
      corruptionRecovery,
    },
    gates,
  };

  await writeFile("evidence/latest.json", `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ gates, measurements: evidence.measurements }, null, 2));

  for (const [name, passed] of Object.entries(gates)) {
    if (!passed) {
      failures.push(`gate failed: ${name}`);
    }
  }
  await page.evaluate(() => window.__overseerSpike.dispose());
} finally {
  await browser.close();
  await server.close();
}

if (failures.length > 0) {
  throw new Error(failures.join("\n"));
}
