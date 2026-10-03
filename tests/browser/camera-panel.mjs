import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = process.cwd();
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};
const server = createServer(async (request, response) => {
  const filename = path.resolve(
    root,
    `.${new URL(request.url, "http://localhost").pathname}`,
  );
  if (!filename.startsWith(root + path.sep))
    return response.writeHead(403).end();
  try {
    response.setHeader(
      "Content-Type",
      mime[path.extname(filename)] ?? "application/octet-stream",
    );
    response.end(await readFile(filename));
  } catch {
    response.writeHead(404).end();
  }
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(
    `http://127.0.0.1:${server.address().port}/tests/browser/instancing.html?count=1`,
  );
  await page.waitForFunction(() => window.ready);
  await page.evaluate(async () => {
    const { CameraPanel, PerformancePanel } =
      await import("/dist/three-cad-viewer.esm.js");
    const host = document.createElement("div");
    host.className = "tcv-diagnostics";
    document.body.append(host);
    window.cameraPanel = new CameraPanel(host, () => window.viewer);
    window.performancePanel = new PerformancePanel(host, () => window.viewer);
    window.viewer.display.showHelp(false);
    window.viewer.setOrtho(false);
    window.viewer.setCameraZoom(1.25);
  });
  const panel = page.locator(".tcv-camera");
  const output = panel.locator("textarea");
  assert.equal(await output.isVisible(), false);
  await panel.locator("summary").click();
  await page.waitForFunction(() =>
    document
      .querySelector(".tcv-camera textarea")
      .value.includes("ortho=False"),
  );

  const assertCamera = async () => {
    const { text, camera, ortho } = await page.evaluate(() => ({
      text: document.querySelector(".tcv-camera textarea").value,
      camera: window.viewer.getCameraLocationSettings(),
      ortho: window.viewer.getOrtho(),
    }));
    const copied = {};
    for (const key of ["position", "quaternion", "target"]) {
      copied[key] = text
        .match(new RegExp(`${key}=\\(([^)]+)\\)`))[1]
        .split(",")
        .map(Number);
      copied[key].forEach((n, i) =>
        assert.ok(Math.abs(n - camera[key][i]) < 1e-6, key),
      );
    }
    copied.zoom = Number(text.match(/zoom=([^,]+),/)[1]);
    assert.ok(Math.abs(copied.zoom - camera.zoom) < 1e-8);
    assert.ok(text.includes(`ortho=${ortho ? "True" : "False"},`));
    return copied;
  };
  const original = await assertCamera();
  // The reported values reproduce the same camera after a model reload.
  await page.evaluate((camera) => {
    window.loadFixture();
    window.viewer.setOrtho(false);
    window.viewer.setCameraLocationSettings(
      camera.position,
      camera.quaternion,
      camera.target,
      camera.zoom,
    );
  }, original);
  await page.waitForTimeout(300);
  const restored = await assertCamera();
  for (const key of ["position", "quaternion", "target"])
    restored[key].forEach((n, i) =>
      assert.ok(Math.abs(n - original[key][i]) < 1e-5),
    );
  assert.ok(Math.abs(restored.zoom - original.zoom) < 1e-8);
  // Real pointer movement updates the readout, including the moving pivot.
  const canvas = page.locator("canvas").first();
  const rect = await canvas.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2 + 50,
    { steps: 5 },
  );
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(300);
  const moved = await assertCamera();
  assert.notDeepEqual(moved.target, original.target);
  await output.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("KeyT");
  assert.equal(
    await page.evaluate(() => window.viewer.getTransparent()),
    false,
  );
  await page.locator(".tcv-performance summary").click();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/camera-desktop.png" });
  assert.ok(await page.evaluate(() => window.compareRendering().colors > 10));
  await page.setViewportSize({ width: 390, height: 720 });
  await page.evaluate(() => {
    window.viewer.resizeCadView(350, 220, 500, true);
    window.viewer.display.showToolsPanel(false);
    window.viewer.setOrtho(true);
  });
  await page.waitForTimeout(300);
  await assertCamera();
  assert.ok(await page.evaluate(() => window.compareRendering().colors > 10));
  const cameraBounds = await panel.boundingBox();
  const fpsBounds = await page.locator(".tcv-performance").boundingBox();
  assert.ok(cameraBounds.x >= 0 && cameraBounds.x + cameraBounds.width <= 390);
  assert.ok(
    cameraBounds.y >= 0 && cameraBounds.y + cameraBounds.height <= fpsBounds.y,
  );
  await page.screenshot({ path: "test-results/camera-mobile.png" });
  await panel.locator("summary").click();
  assert.equal(await output.isVisible(), false);
  await page.evaluate(() => {
    window.cameraPanel.dispose();
    window.performancePanel.dispose();
  });
  assert.deepEqual(errors, []);
  console.log(
    "Camera readout, pointer updates, round-trip, projection and desktop/mobile layout passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
