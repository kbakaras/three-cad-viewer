import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const python = process.env.BENCHMARK_PYTHON;
if (!python)
  throw new Error("Set BENCHMARK_PYTHON to the furniture .venv/bin/python");
const url = new URL(process.env.VIEWER_URL ?? "http://127.0.0.1:3941/viewer");
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 760 },
  });
  page.on("pageerror", (error) => console.error(error));
  await page.goto(url.href, { waitUntil: "commit" });
  await page.waitForFunction(() => window.viewer?.shapes);
  const execution = promisify(execFile)(
    python,
    [
      "-m",
      "office.benchmark",
      "--host",
      url.hostname,
      "--port",
      url.port,
      "--samples",
      process.env.SAMPLES ?? "7",
      "--output",
      process.env.BENCHMARK_OUTPUT ?? "/tmp/office-benchmark.json",
      ...process.argv.slice(2),
    ],
    { timeout: 600000, maxBuffer: 2 * 1024 * 1024 },
  );
  execution.child.stderr.on("data", (data) => process.stderr.write(data));
  page.on("crash", () => execution.child.kill());
  const { stdout } = await execution;
  process.stdout.write(stdout);
} finally {
  await browser.close();
}
