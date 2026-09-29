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
  if (!filename.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
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
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(
    `http://127.0.0.1:${server.address().port}/tests/browser/instancing.html?mode=instanced&count=1`,
  );
  await page.waitForFunction(() => window.ready, null, { timeout: 30000 });

  const result = await page.evaluate(() => {
    const viewer = window.viewer;
    const press = (options, target = viewer.display.container) => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...options,
        }),
      );
    };
    const states = [];
    const capture = () =>
      states.push({
        transparent: viewer.state.get("transparent"),
        tab: viewer.state.get("activeTab"),
        grid: [...viewer.state.get("grid")],
      });

    viewer.display.container.focus();
    press({ code: "KeyT", key: "е" });
    capture();
    press({ code: "KeyT", key: "Е", modifierCapsLock: true });
    capture();
    viewer.setActiveTab("clip");
    press({ code: "KeyT", key: "Е", shiftKey: true });
    capture();
    press({ code: "KeyG", key: "п" });
    capture();
    press({ code: "KeyG", key: "П", shiftKey: true });
    capture();
    press({ code: "KeyG", key: "П", shiftKey: true });
    capture();

    const editor = document.createElement("div");
    editor.contentEditable = "true";
    viewer.display.container.appendChild(editor);
    press({ code: "KeyT", key: "е" }, editor);
    press({ code: "KeyT", key: "е", isComposing: true });
    for (const modifier of ["ctrlKey", "altKey", "metaKey"]) {
      press({ code: "KeyT", key: "е", [modifier]: true });
    }
    capture();
    editor.remove();

    press({ code: "KeyD", key: "В", shiftKey: true });
    press({ code: "KeyV", key: "м" });
    const vertex = viewer.display.filterDropdown.value.innerText;
    press({ code: "KeyF", key: "а" });
    const face = viewer.display.filterDropdown.value.innerText;
    return { states, filters: [vertex, face] };
  });

  assert.equal(result.states[0].transparent, true);
  assert.equal(
    result.states[1].transparent,
    false,
    "Caps Lock must not select Shift+T",
  );
  assert.equal(result.states[2].transparent, false);
  assert.equal(result.states[2].tab, "tree");
  assert.deepEqual(result.states[3].grid, [true, true, true]);
  assert.deepEqual(result.states[4].grid, [true, false, false]);
  assert.deepEqual(result.states[5].grid, [false, false, false]);
  assert.deepEqual(
    result.states[6],
    result.states[5],
    "Typing and modifiers must not run commands",
  );
  assert.deepEqual(result.filters, ["Vertex", "Face"]);

  await page.evaluate(async () => {
    const { makeLayeredFurniture } = await import("/tests/fixtures/layers.js");
    window.loadModel(makeLayeredFurniture());
    const v = window.viewer;
    v.display.showHelp(false);
    v.display.container.focus();
    v.togglePanelSelection("/Model/Product/A/P1");
    window.baseStates = v.getStates();
    window.baseCamera = v.getCameraLocationSettings();
  });
  const panelState = () =>
    page.evaluate(() => {
      const v = window.viewer;
      return {
        p1: v.nestedGroup.groups["/Model/Product/A/P1/Body"].getVisibility(),
        p2: v.nestedGroup.groups["/Model/Product/B/P2/Body"].getVisibility(),
        wall: v.nestedGroup.groups["/Model/Walls/Body"].getVisibility(),
        selected: v.getSelectedPanels(),
        unchanged:
          JSON.stringify(v.getStates()) === JSON.stringify(window.baseStates),
        cameraUnchanged:
          JSON.stringify(v.getCameraLocationSettings()) ===
          JSON.stringify(window.baseCamera),
      };
    });
  await page.keyboard.press("Alt+KeyI");
  assert.deepEqual(await panelState(), {
    p1: false,
    p2: true,
    wall: true,
    selected: [],
    unchanged: true,
    cameraUnchanged: true,
  });
  const indicator = page.locator(".tcv_panel_filter");
  const status = page.locator(".tcv_panel_filter_status");
  const reset = page.getByRole("button", { name: "Снять временный фильтр" });
  assert.equal(await indicator.isVisible(), true);
  assert.equal(await status.textContent(), "Временно скрыто: 1");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/panel-filter-desktop.png" });
  await page.keyboard.press("KeyO");
  assert.equal((await panelState()).p1, false);
  await page.keyboard.press("KeyI");
  assert.equal((await panelState()).p1, true);
  assert.equal((await panelState()).p2, true);
  assert.equal(await indicator.isVisible(), false);
  await page.evaluate(() =>
    window.viewer.togglePanelSelection("/Model/Product/A/P1"),
  );
  await page.keyboard.press("KeyI");
  assert.equal((await panelState()).p2, false);
  assert.equal(await status.textContent(), "Временно скрыто: 1");
  await page.evaluate(() =>
    window.viewer.display.container.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyI",
        key: "ш",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.equal((await panelState()).p1, false);
  assert.equal((await panelState()).p2, false);
  assert.equal(await status.textContent(), "Временно скрыто: 2");
  assert.deepEqual((await panelState()).selected, []);
  await page.keyboard.press("Alt+KeyI");
  assert.equal((await panelState()).p1, false);
  assert.equal((await panelState()).p2, false);
  assert.equal(await status.textContent(), "Временно скрыто: 2");

  await page.evaluate(() => window.viewer.treeview.expandAll());
  const panelCheckbox = page.locator(
    '[data-path="/Model/Product/A/P1"] > .tv-node-content > .tv-icon0',
  );
  await panelCheckbox.click();
  assert.equal((await panelState()).p1, false);
  assert.equal(await status.textContent(), "Временно скрыто: 2");
  await panelCheckbox.click();
  assert.equal((await panelState()).p1, true);
  assert.equal((await panelState()).p2, false);
  assert.equal(await status.textContent(), "Временно скрыто: 1");
  await page.evaluate(() =>
    window.viewer.togglePanelSelection("/Model/Product/A/P1"),
  );
  await page.keyboard.press("Alt+KeyI");
  assert.equal((await panelState()).p1, false);
  assert.equal((await panelState()).p2, false);
  assert.equal(await status.textContent(), "Временно скрыто: 2");
  await page.keyboard.press("Escape");
  const emptySelection = await panelState();
  await page.keyboard.press("Alt+KeyI");
  assert.deepEqual(
    await panelState(),
    emptySelection,
    "Alt+i при пустом выделении не меняет активный фильтр",
  );
  assert.equal(await indicator.isVisible(), true);
  await reset.click();
  assert.equal(await indicator.isVisible(), false);
  assert.deepEqual(await panelState(), {
    ...emptySelection,
    p1: true,
    p2: true,
  });
  await page.evaluate(() => {
    const v = window.viewer;
    v.togglePanelSelection("/Model/Product/A/P1");
    v.togglePanelIsolation();
    v.clearPanelSelection();
    v.display.container.focus();
  });
  await page.keyboard.press("KeyI");
  assert.equal((await panelState()).p1, true);
  assert.equal((await panelState()).p2, true);
  assert.equal(await indicator.isVisible(), false);

  await page.setViewportSize({ width: 390, height: 720 });
  await page.evaluate(() => {
    const v = window.viewer;
    v.resizeCadView(350, 220, 550, true);
    v.display.showToolsPanel(true);
    v.togglePanelSelection("/Model/Product/A/P1");
    v.hideSelectedPanels();
  });
  assert.equal(await indicator.isVisible(), true);
  const bounds = await indicator.boundingBox();
  const buttonBounds = await reset.boundingBox();
  const statusBounds = await status.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.ok(statusBounds.x + statusBounds.width <= buttonBounds.x);
  assert.ok(buttonBounds.y >= bounds.y);
  assert.ok(buttonBounds.y + buttonBounds.height <= bounds.y + bounds.height);
  await page.screenshot({ path: "test-results/panel-filter-mobile.png" });
  await reset.click();
  assert.equal(await indicator.isVisible(), false);
  assert.equal((await panelState()).p1, true);
  assert.deepEqual((await panelState()).selected, []);
  assert.deepEqual(errors, []);
  console.log(
    "Keyboard shortcuts, cumulative temporary visibility, tree override, indicator and UI reset (desktop/mobile) passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
