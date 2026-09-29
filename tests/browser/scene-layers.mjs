import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = process.cwd();
const server = createServer(async (request, response) => {
  const filename = path.resolve(
    root,
    `.${new URL(request.url, "http://localhost").pathname}`,
  );
  if (!filename.startsWith(root + path.sep))
    return response.writeHead(403).end();
  try {
    const type = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
    };
    response.setHeader(
      "Content-Type",
      type[path.extname(filename)] ?? "application/octet-stream",
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
    viewport: { width: 1100, height: 720 },
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(
    `http://127.0.0.1:${server.address().port}/tests/browser/instancing.html?mode=instanced&count=1`,
  );
  await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const { makeLayeredFurniture } = await import("/tests/fixtures/layers.js");
    window.layerModel = makeLayeredFurniture;
    window.loadModel(makeLayeredFurniture());
  });
  assert.equal(await page.locator(".tcv_layer_list input").count(), 4);
  const initial = await page.evaluate(() => {
    const v = window.viewer;
    v.update(true, false);
    const gl = v.renderer.getContext();
    const pixels = new Uint8Array(
      gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
    );
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 160)
      colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    return {
      colors: colors.size,
      instances: v.getInstancingStats().instancedObjects,
    };
  });
  assert.ok(
    initial.colors > 4,
    "Кадр должен содержать геометрию, а не только фон",
  );
  assert.ok(
    initial.instances > 0,
    "Проверка должна затрагивать GPU instancing",
  );
  const tree = await page.evaluate(() => {
    const tv = window.viewer.treeview;
    tv.expandAll();
    tv.openPath("/Model/Hardware/Bolts/Bolt/Body");
    const kind = tv.getDomNode("/Model/Hardware/Bolts");
    return {
      leaf: tv.isLeaf(tv.findNodeByPath("/Model/Hardware/Bolts")),
      nav: kind.querySelector(".tv-nav-marker").textContent,
      children: kind.querySelector(".tv-children") !== null,
      highlighted: kind.querySelector(".tv-node-label-highlight") !== null,
    };
  });
  assert.deepEqual(tree, {
    leaf: true,
    nav: "",
    children: false,
    highlighted: true,
  });
  await page.locator('[data-path="/Model/Hardware/Bolts"] .tv-icon0').click();
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Hardware/Bolts/Bolt/Body"
      ].getVisibility(),
    ),
    false,
  );
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Hardware/Dowels/Dowel/Body"
      ].getVisibility(),
    ),
    true,
  );
  await page.locator('[data-path="/Model/Hardware/Bolts"] .tv-icon0').click();
  await page.locator('[data-layer="labels"]').uncheck();
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Product/A/P1/Name/Text"
      ].getVisibility(),
    ),
    false,
  );
  await page.evaluate(() =>
    window.viewer.setState("/Model/Product/A/P1", [0, 0]),
  );
  await page.locator('[data-layer="labels"]').check();
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Product/A/P1/Name/Text"
      ].getVisibility(),
    ),
    false,
  );
  await page.locator('[data-layer="facades"]').uncheck();
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Hardware/Bolts/Bolt/Body"
      ].getVisibility(),
    ),
    false,
  );
  await page.locator('[data-layer="facades"]').check();
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Hardware/Bolts/Bolt/Body"
      ].getVisibility(),
    ),
    true,
  );
  await page.evaluate(() => window.viewer.setState("/Model/Product/A", [0, 0]));
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Hardware/Bolts/Bolt/Body"
      ].getVisibility(),
    ),
    false,
  );
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Hardware/Bolts/BoltB/Body"
      ].getVisibility(),
    ),
    true,
  );
  await page.evaluate(() => window.viewer.setState("/Model/Product/A", [1, 1]));
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await page.screenshot({ path: "test-results/layers-desktop.png" });
  await page.setViewportSize({ width: 390, height: 720 });
  await page.evaluate(() => {
    const v = window.viewer;
    v.resizeCadView(350, 220, 550, true);
    v.display.showToolsPanel(true);
  });
  const fits = await page
    .locator(".tcv_layer_list label")
    .evaluateAll((labels) =>
      labels.every((label) => label.scrollWidth <= label.clientWidth + 1),
    );
  assert.ok(fits, "Подписи слоёв должны помещаться на узком экране");
  await page.screenshot({ path: "test-results/layers-mobile.png" });
  console.log("CAD, instancing и размещение слоёв проверены.");
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.evaluate(() => {
    const v = window.viewer;
    v.resizeCadView(848, 220, 520, false);
  });
  await page.evaluate(() => {
    const v = window.viewer;
    v.setTransparent(true);
    v.setLayerVisible("walls", false);
    window.loadModel(window.layerModel());
    v.setTransparent(true);
    v.state.set("studioEnvironment", "studio", false);
    v.setActiveTab("studio");
  });
  await page.waitForFunction(
    () => window.viewer._studioManager.hasComposer,
    null,
    { timeout: 30000 },
  );
  assert.equal(await page.locator(".tcv_cad_layers").isVisible(), true);
  await page.locator('[data-layer="labels"]').uncheck();
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Product/B/P2/Name/Text"
      ].getVisibility(),
    ),
    false,
  );
  await page.locator('[data-layer="hardware"]').uncheck();
  await page.evaluate(async () => {
    const v = window.viewer;
    await v.applySceneDelta({
      remove: [],
      add: [],
      update: [{ id: "/Model/Product/A/P1", name: "Renamed", parts: [] }],
    });
    v.update(true, false);
  });
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Hardware/Bolts/Bolt/Body"
      ].getVisibility(),
    ),
    false,
  );
  await page.locator('[data-layer="labels"]').check();
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups[
        "/Model/Product/B/P2/Name/Text"
      ].getVisibility(),
    ),
    true,
  );
  await page.evaluate(() => window.viewer.setActiveTab("tree"));
  assert.equal(
    await page.evaluate(() =>
      window.viewer.nestedGroup.groups["/Model/Walls/Body"].getVisibility(),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Слои: CAD, instancing, прозрачность, Studio, обновления и узкий экран проверены.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
