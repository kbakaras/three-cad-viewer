import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const resultsDir = path.join(root, "test-results");
await mkdir(resultsDir, { recursive: true });
if (process.env.TEST_MODEL)
  await readFile(path.resolve(process.env.TEST_MODEL));
const baselineRef =
  process.env.BASELINE_REF ?? "58fd979f8c9685c0c2d7455a5363135bc35143ab";
if (!process.env.SKIP_BASELINE_BUILD) {
  const directory = path.join(resultsDir, "baseline");
  await mkdir(directory, { recursive: true });
  const archive = execFileSync(
    "git",
    [
      "archive",
      baselineRef,
      "src",
      "css",
      "icons",
      "scripts",
      "tsconfig.json",
      "rollup.config.mjs",
      "package.json",
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  execFileSync("tar", ["-x", "-C", directory], { input: archive });
  await symlink(
    path.join(root, "node_modules"),
    path.join(directory, "node_modules"),
  ).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  execFileSync("npm", ["run", "build"], { cwd: directory, stdio: "inherit" });
}
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  if (req.url === "/external-model.json" && process.env.TEST_MODEL) {
    res.setHeader("Content-Type", "application/json");
    res.end(await readFile(path.resolve(process.env.TEST_MODEL)));
    return;
  }
  const filename = path.resolve(
    root,
    `.${new URL(req.url, "http://localhost").pathname}`,
  );
  if (!filename.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      mime[path.extname(filename)] ?? "application/octet-stream",
    );
    res.end(await readFile(filename));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/tests/browser/instancing.html`;
let browser;
const report = {
  baselineRef,
  timestamp: new Date().toISOString(),
  measurements: [],
  visual: [],
};
try {
  browser = await chromium.launch({
    headless: process.env.HEADED !== "1",
    args:
      process.env.SOFTWARE_GL === "0"
        ? []
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 1100, height: 680 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404"))
      errors.push(message.text());
  });
  const open = async (mode, count, model = false) => {
    await page.evaluate(() => window.viewer?.dispose());
    await page.goto(
      `${url}?${new URLSearchParams({ mode, count, ...(model ? { model: "1" } : {}) })}`,
      { waitUntil: "commit", timeout: 180000 },
    );
    await page.waitForFunction(() => window.ready, null, { timeout: 180000 });
  };
  for (const count of (process.env.COUNTS ?? "100,1000,3000")
    .split(",")
    .map(Number)) {
    for (const mode of (
      process.env.MODES ?? "baseline,stencil,instanced"
    ).split(",")) {
      await open(mode, count);
      const result = await page.evaluate(
        (samples) => window.measureRotation(samples),
        Number(process.env.SAMPLES ?? 60),
      );
      report.measurements.push(result);
      console.log(JSON.stringify(result));
      await writeFile(
        path.join(resultsDir, "instancing.json"),
        JSON.stringify(report, null, 2),
      );
    }
    const results = report.measurements.filter((r) => r.count === count);
    const baseline = results.find((r) => r.mode === "baseline");
    const stencil = results.find((r) => r.mode === "stencil");
    const instanced = results.find((r) => r.mode === "instanced");
    if (stencil && instanced)
      assert.ok(
        stencil.calls > instanced.calls * 10,
        "Repeated hardware should reduce full-frame calls by at least 10x",
      );
    if (baseline && stencil)
      assert.ok(
        baseline.calls > stencil.calls,
        "Inactive stencil passes should disappear",
      );
  }
  if (process.env.TEST_MODEL) {
    report.model = [];
    for (const mode of ["baseline", "stencil", "instanced"]) {
      await open(mode, 100, true);
      const result = await page.evaluate(
        (samples) => window.measureRotation(samples),
        Number(process.env.SAMPLES ?? 60),
      );
      report.model.push(result);
      console.log("Model", JSON.stringify(result));
    }
    report.modelVisual = await page.evaluate(() => window.compareRendering());
    assert.ok(report.modelVisual.changedFraction < 0.003);
    await page.screenshot({
      path: path.join(resultsDir, "model-instanced.png"),
    });
  }
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 680 });
    await open("instanced", 100);
    for (const extras of [false, true]) {
      const result = await page.evaluate((extras) => {
        window.loadFixture(100, extras);
        return window.compareRendering();
      }, extras);
      report.visual.push({ width, extras, ...result });
      console.log("Visual", JSON.stringify(report.visual.at(-1)));
      assert.ok(result.colors > 30, "Canvas must contain visible geometry");
      assert.ok(
        result.changedFraction < 0.003,
        "Instancing should preserve the rendered image",
      );
      await page.screenshot({
        path: path.join(resultsDir, `instancing-${width}-${extras}.png`),
      });
    }
    const before = await page.evaluate(() =>
      window.viewer.camera.getPosition().toArray(),
    );
    const canvas = page.locator("canvas").first();
    const bounds = await canvas.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width * 0.5,
      bounds.y + bounds.height * 0.5,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width * 0.65,
      bounds.y + bounds.height * 0.6,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await page.evaluate(() =>
      window.viewer.camera.getPosition().toArray(),
    );
    assert.notDeepEqual(before, after, "Pointer drag must rotate the view");
    const lifecycle = await page.evaluate(() => {
      const v = window.viewer;
      v.setLocalClipping(true);
      const clipping = v.getInstancingStats().reason;
      v.setLocalClipping(false);
      v.setTransparent(true);
      const transparent = v.getInstancingStats().reason;
      v.setTransparent(false);
      const memories = [];
      for (let i = 0; i < 4; i++) {
        window.loadFixture(100);
        v.update(true, false);
        memories.push(v.renderer.info.memory.geometries);
      }
      return { clipping, transparent, memories, stats: v.getInstancingStats() };
    });
    assert.equal(lifecycle.clipping, "clipping");
    assert.equal(lifecycle.transparent, "transparent");
    assert.equal(lifecycle.stats.instancedObjects, 100);
    assert.equal(
      lifecycle.memories[0],
      lifecycle.memories.at(-1),
      "Reload must not leak geometries",
    );
    report.visual.at(-1).lifecycle = lifecycle;
    await page.evaluate(async () => {
      const { PerformancePanel } =
        await import("/dist/three-cad-viewer.esm.js");
      window.performancePanel = new PerformancePanel(
        document.body,
        () => window.viewer,
      );
    });
    const panel = page.locator(".tcv-performance");
    await panel.locator("summary").click();
    await page.waitForTimeout(100);
    const measured = await page.evaluate(async () => {
      const rotation = await window.measureRotation(70);
      return { rotation, stats: window.viewer.getPerformanceStats() };
    });
    assert.equal(measured.stats.calls, measured.rotation.calls);
    assert.equal(measured.stats.triangles, measured.rotation.triangles);
    assert.ok(measured.stats.frames >= 70);
    assert.ok(measured.stats.cpuMs > 0);
    assert.match(await panel.textContent(), /Calls: [1-9]/);
    const panelBounds = await panel.boundingBox();
    assert.ok(panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= width);
    assert.ok(panelBounds.y >= 0 && panelBounds.y + panelBounds.height <= 680);
    await page.screenshot({
      path: path.join(resultsDir, `performance-${width}.png`),
    });
    await panel.locator("summary").click();
    await page.waitForTimeout(100);
    const stopped = await page.evaluate(() => {
      const v = window.viewer;
      const before = v.getPerformanceStats().frames;
      v.update(true, false);
      return v.getPerformanceStats().frames === before;
    });
    assert.ok(stopped, "Collapsed panel must stop collecting metrics");
    await page.evaluate(() => window.performancePanel.dispose());
  }
  assert.deepEqual(errors, [], "No browser or shader errors");
} finally {
  await writeFile(
    path.join(resultsDir, "instancing.json"),
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
