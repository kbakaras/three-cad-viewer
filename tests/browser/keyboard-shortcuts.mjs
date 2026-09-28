import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.deepEqual(errors, []);
  console.log(
    "Keyboard shortcuts: Russian layout, Shift, Caps Lock, typing guards and selection filters passed.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
