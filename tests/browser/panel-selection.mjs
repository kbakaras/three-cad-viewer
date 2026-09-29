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
    response.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
      }[path.extname(filename)] ?? "application/octet-stream",
    );
    response.end(await readFile(filename));
  } catch {
    response.writeHead(404).end();
  }
});

let browser;
const p1 = "/Model/Product/A/P1",
  p2 = "/Model/Product/B/P2";
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
    const THREE = await import("three");
    window.selectionModel = () => {
      const model = makeLayeredFurniture();
      const panel = model.parts[0].parts[0].parts[0];
      const edge = structuredClone(panel.parts[0]);
      edge.id = `${panel.id}/Edge`;
      edge.name = "Кромка";
      edge.loc[0][0] += 8;
      panel.parts.push(edge);
      return model;
    };
    window.loadModel(window.selectionModel());
    const v = window.viewer;
    v.display.showHelp(false);
    v.display.setView("front");
    window.selectionPoint = (id) => {
      v.update(true, false);
      const group = v.nestedGroup.groups[id];
      const mesh = group.front ?? group;
      const center = new THREE.Box3()
        .setFromObject(mesh)
        .getCenter(new THREE.Vector3());
      center.project(v.camera.getCamera());
      const rect = v.renderer.domElement.getBoundingClientRect();
      return {
        x: rect.x + ((center.x + 1) * rect.width) / 2,
        y: rect.y + ((1 - center.y) * rect.height) / 2,
      };
    };
    window.selectionPixels = () => {
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
      let blue = 0;
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          pixels[i + 2] > pixels[i] + 60 &&
          pixels[i + 2] > pixels[i + 1] + 20
        )
          blue++;
        if (i % 160 === 0)
          colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      }
      return { blue, colors: colors.size };
    };
  });
  const selected = () => page.evaluate(() => window.viewer.getSelectedPanels());
  const visible = (id) =>
    page.evaluate(
      (id) => window.viewer.nestedGroup.groups[id].getVisibility(),
      id,
    );
  const click = async (id, ctrl = true) => {
    const point = await page.evaluate((id) => window.selectionPoint(id), id);
    if (ctrl) await page.keyboard.down("Control");
    await page.mouse.click(point.x, point.y);
    if (ctrl) await page.keyboard.up("Control");
  };
  const key = (code, key, extra = {}) =>
    page.evaluate(
      ({ code, key, extra }) => {
        window.viewer.display.container.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            code,
            key,
            ...extra,
          }),
        );
      },
      { code, key, extra },
    );

  const before = await page.evaluate(() => window.selectionPixels());
  await click(`${p1}/Body`);
  assert.deepEqual(await selected(), [p1]);
  const after = await page.evaluate(() => window.selectionPixels());
  assert.ok(
    after.colors > 4 && after.blue > before.blue + 100,
    "Выделение должно быть видно в пикселях кадра",
  );
  assert.ok(
    await page.evaluate(
      () => window.viewer.getInstancingStats().instancedObjects > 0,
    ),
  );
  assert.equal(
    await page.evaluate(
      (id) => window.viewer.nestedGroup.groups[id].isGroupSelected,
      `${p1}/Edge`,
    ),
    true,
  );
  await click(`${p2}/Body`);
  assert.deepEqual(await selected(), [p1, p2]);
  await click(`${p1}/Body`, false);
  assert.deepEqual(await selected(), [p1, p2]);
  await click(`${p1}/Edge`);
  assert.deepEqual(await selected(), [p2]);
  await page.keyboard.press("KeyI");
  assert.equal(await visible(`${p1}/Body`), false);
  assert.equal(await visible(`${p1}/Name/Text`), false);
  assert.equal(await visible("/Model/Hardware/Dowels/Dowel/Body"), false);
  assert.equal(await visible("/Model/Hardware/Bolts/Bolt/Body"), true);
  assert.equal(await visible("/Model/Walls/Body"), true);
  await key("KeyI", "ш", { repeat: true });
  assert.equal(await visible(`${p1}/Body`), false);
  await key("KeyI", "ш");
  assert.equal(await visible(`${p1}/Body`), true);
  assert.equal(await visible(`${p2}/Body`), true);
  await key("KeyI", "ш");
  assert.equal(await visible(`${p1}/Body`), false);
  await page.keyboard.press("Escape");
  assert.deepEqual(await selected(), []);
  assert.equal(await visible(`${p1}/Body`), false);
  await key("KeyI", "ш");
  assert.equal(await visible(`${p1}/Body`), true);

  const point = await page.evaluate(
    (id) => window.selectionPoint(id),
    `${p1}/Body`,
  );
  await page.keyboard.down("Control");
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y + 25, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Control");
  assert.deepEqual(await selected(), []);
  await page.evaluate(() => window.viewer.display.setView("front"));
  await click(`${p1}/Name/Text`);
  assert.deepEqual(await selected(), [p1]);
  await page.evaluate(() => {
    const v = window.viewer;
    v.setTransparent(true);
    v.display.setTool("distance", true);
  });
  await click(`${p2}/Body`);
  assert.deepEqual(await selected(), [p1, p2]);
  assert.equal(
    await page.evaluate(() => window.viewer.nestedGroup.selection().length),
    0,
  );
  await click(`${p2}/Body`);
  await page.evaluate(() => window.viewer.display.setTool("distance", false));
  assert.ok(
    (await page.evaluate(() => window.selectionPixels())).blue >
      before.blue + 50,
  );

  await mkdir(path.join(root, "test-results"), { recursive: true });
  await page.screenshot({
    path: "test-results/panel-selection-transparent.png",
  });
  await page.evaluate(() => {
    const v = window.viewer;
    v.setTransparent(false);
    v.state.set("studioEnvironment", "studio", false);
    v.setActiveTab("studio");
  });
  await page.waitForFunction(
    () => window.viewer._studioManager.hasComposer,
    null,
    { timeout: 30000 },
  );
  const studio = await page.evaluate(() => window.selectionPixels());
  assert.ok(
    studio.colors > 4 && studio.blue > 50,
    "Подсветка должна рисоваться в Studio",
  );
  await page.screenshot({ path: "test-results/panel-selection-studio.png" });
  await key("KeyI", "ш");
  assert.equal(await visible(`${p2}/Body`), false);
  await key("KeyI", "ш");
  assert.equal(await visible(`${p2}/Body`), true);
  await page.evaluate(async () => {
    const v = window.viewer;
    await v.applySceneDelta({
      remove: [],
      add: [],
      update: [
        {
          id: "/Model/Product/A/P1",
          name: "Переименованная панель",
          parts: [],
          selection_root: true,
        },
      ],
    });
  });
  assert.deepEqual(await selected(), [p1]);
  await page.evaluate(() => window.viewer.setActiveTab("tree"));
  await page.evaluate(() => window.loadModel(window.selectionModel()));
  assert.deepEqual(await selected(), [p1]);
  const states = await page.evaluate(() => window.viewer.getStates());
  await page.keyboard.press("Alt+KeyI");
  assert.equal(await visible(`${p1}/Body`), false);
  assert.deepEqual(await selected(), []);
  assert.equal(await visible(`${p2}/Body`), true);
  assert.deepEqual(
    await page.evaluate(() => window.viewer.getStates()),
    states,
  );
  await key("KeyI", "ш", { altKey: true });
  assert.equal(await visible(`${p1}/Body`), false);
  await page.evaluate(() => window.viewer.clearPanelFilter());
  assert.equal(await visible(`${p1}/Body`), true);
  assert.deepEqual(errors, []);
  console.log(
    "Выделение панелей: Ctrl+click, перетаскивание, i/Alt+i/Esc, слои, фурнитура, CAD, прозрачность, Studio и обновления проверены.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
