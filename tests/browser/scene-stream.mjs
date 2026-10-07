import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const url = process.env.VIEWER_URL ?? "http://127.0.0.1:3941/viewer";
const wsUrl = url.replace(/^http/, "ws").replace(/\/viewer\/?$/, "");
const source = JSON.parse(
  await readFile(process.env.TEST_BREP ?? "/tmp/office.brep.json", "utf8"),
);
source.config = {
  ...source.config,
  up: "Z",
  reset_camera: "reset",
  axes: true,
  axes0: true,
  grid: [true, false, false],
};

async function request(prefix, data) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const response = new Promise((resolve, reject) => {
    ws.onmessage = async (event) => {
      const text =
        typeof event.data === "string" ? event.data : await event.data.text();
      resolve(JSON.parse(text));
    };
    ws.onerror = reject;
  });
  ws.send(prefix + ":" + JSON.stringify(data));
  const result = await response;
  ws.close();
  return result;
}

async function send(packet) {
  const ack = await request("E", packet);
  assert.ok(ack.ok, ack.error);
  return ack.revision;
}

async function applied(revision) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const status = await request("C", "status");
    if (status.text.scene_metrics?.revision === revision) {
      console.log("Displayed", revision, status.text.scene_metrics.browser_ms);
      return status.text.scene_metrics;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Revision ${revision} was not displayed`);
}

function leaves(tree) {
  return tree.parts ? tree.parts.flatMap(leaves) : [tree];
}

const launch = () =>
  chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
let browser = await launch();

async function pixels(page) {
  return page.evaluate(() => {
    const v = window.viewer;
    v.update(true, false);
    const gl = v.renderer.getContext();
    const buffer = new Uint8Array(
      gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
    );
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      buffer,
    );
    const colors = new Set();
    for (let i = 0; i < buffer.length; i += 16)
      colors.add(`${buffer[i]},${buffer[i + 1]},${buffer[i + 2]}`);
    return {
      colors: colors.size,
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
    };
  });
}
const errors = [];
try {
  for (let attempt = 0; ; attempt++) {
    try {
      await request("C", "config");
      break;
    } catch (error) {
      if (attempt >= 60) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  // A model sent before registration must survive opening and reloading the page.
  const first = await send(source);
  let page = await browser.newPage({
    viewport: { width: 1100, height: 760 },
  });
  page.on("pageerror", (e) => {
    errors.push(String(e));
    console.error(e);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) {
      errors.push(m.text());
      console.error(m.text());
    }
  });
  await page.goto(url, { waitUntil: "commit" });
  await applied(first);
  await page.waitForTimeout(1000);
  await page.reload({ waitUntil: "commit", timeout: 60000 });
  await applied(first);
  await page.waitForFunction(() => window.viewer?.shapes?.name === "Модель");
  if (process.argv.includes("--pixels-only")) {
    for (const width of [1100, 500]) {
      await page.setViewportSize({ width, height: 740 });
      await page.waitForTimeout(300);
      const canvas = await pixels(page);
      assert.ok(canvas.colors > 30, "Canvas must contain visible geometry");
      assert.ok(canvas.width <= width, "Canvas must fit viewport");
      await page.screenshot({ path: `/tmp/office-pixels-${width}.png` });
      console.log("Pixels", canvas);
    }
    assert.deepEqual(errors, []);
    await browser.close();
    process.exit(0);
  }
  source.config.reset_camera = "keep";
  const top = leaves(source.tree).find(
    (n) => n.name === "Тело" && n.kind === "solid",
  );
  assert.ok(top, "Panel body must exist");
  const inspect = () =>
    page.evaluate((id) => {
      const v = window.viewer;
      const g = v.nestedGroup.groups[id];
      return {
        target: v.controls.getTarget().toArray(),
        position: v.camera.getCamera().position.toArray(),
        nodes: Object.keys(v.nestedGroup.groups).length,
        color: g.front.material.color.getHexString(),
        studio: v.isStudioActive,
        marker: !!v._pivotMarkerDepth,
        visible: g.front.visible && g.front.material.visible,
      };
    }, top.id);
  await page.evaluate((id) => {
    window.original = window.viewer.nestedGroup.groups[id];
    window.other = Object.values(window.viewer.nestedGroup.groups).find(
      (g) => g !== window.original && g.front,
    );
  }, top.id);
  const initial = await inspect();
  let revision = await send(source);
  const unchanged = await applied(revision);
  assert.equal(unchanged.cache_misses, 0);
  assert.ok(
    await page.evaluate(
      (id) => window.original === window.viewer.nestedGroup.groups[id],
      top.id,
    ),
  );
  const modified = structuredClone(source);
  const changed = leaves(modified.tree).find((n) => n.id === top.id);
  changed.color = "#ff0022";
  changed.loc[0][0] += 10;
  revision = await send(modified);
  const properties = await applied(revision);
  assert.equal(properties.cache_misses, 0);
  assert.ok(
    await page.evaluate(
      (id) => window.original === window.viewer.nestedGroup.groups[id],
      top.id,
    ),
  );
  assert.equal((await inspect()).color, "ff0022");
  assert.deepEqual((await inspect()).target, initial.target);
  assert.deepEqual((await inspect()).position, initial.position);

  await page.evaluate(() => {
    window.viewer.setStudioAOIntensity(0);
    window.viewer.setStudioShadowIntensity(0);
    window.viewer.setStudioEnvironment("none");
    window.viewer.setActiveTab("studio");
  });
  await page.waitForFunction(() => window.viewer._studioManager.hasComposer);
  const studioPacket = structuredClone(modified);
  leaves(studioPacket.tree).find((n) => n.id === top.id).color = "#22ff00";
  revision = await send(studioPacket);
  await applied(revision);
  assert.ok((await inspect()).studio);
  assert.equal((await inspect()).color, "22ff00");
  assert.ok((await inspect()).marker);
  await page.screenshot({
    path: "/tmp/office-studio-delta.png",
    timeout: 120000,
  });
  await page.evaluate(() => window.viewer.setActiveTab("tree"));
  await page.evaluate(() => window.viewer.setTransparent(true));
  revision = await send(modified);
  await applied(revision);
  assert.ok(await page.evaluate(() => window.viewer.state.get("transparent")));
  assert.ok((await inspect()).marker);
  await page.evaluate(() => window.viewer.setTransparent(false));

  // Geometry replacement must retain every unrelated ObjectGroup.
  const replacement = structuredClone(modified);
  const wall = leaves(replacement.tree).find(
    (n) => n.kind === "solid" && decodeURIComponent(n.id).includes("/Стены/"),
  );
  assert.ok(wall, "Wall body must exist");
  leaves(replacement.tree).find((n) => n.id === top.id).geometry =
    wall.geometry;
  revision = await send(replacement);
  await applied(revision);
  assert.ok(
    await page.evaluate(() =>
      Object.values(window.viewer.nestedGroup.groups).includes(window.other),
    ),
  );

  // Restore, then exercise the actual middle-button camera-follow patch.
  {
    const next = await send(modified);
    await applied(next);
    // A new page reconnects and restores the scene through a full snapshot.
    await browser.close();
    browser = await launch();
    page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: "commit" });
    await applied(next);
    await page.waitForFunction(() => window.viewer?.shapes?.name === "Модель");
    const before = await inspect();
    console.log("Checking Orbit controls and pixels");
    const canvas = await pixels(page);
    assert.ok(canvas.colors > 30, "model must not be blank");
    await page.mouse.move(650, 360);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(650, 400, { steps: 8 });
    await page.mouse.up({ button: "middle" });
    const after = await inspect();
    assert.notDeepEqual(
      after.target,
      before.target,
      "target must move",
    );
    assert.notDeepEqual(
      after.position,
      before.position,
      "camera must follow",
    );
    await page.screenshot({ path: "/tmp/office-orbit-delta.png" });
  }
  await page.setViewportSize({ width: 500, height: 740 });
  await page.waitForTimeout(300);
  const mobile = await pixels(page);
  assert.ok(mobile.colors > 30, "Mobile canvas must contain visible geometry");
  assert.ok(mobile.width <= 500, "Mobile canvas must fit viewport");
  await page.screenshot({ path: "/tmp/office-mobile-delta.png" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        unchanged,
        properties,
        screenshots: "/tmp/office-*-delta.png",
        nodes: initial.nodes,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
