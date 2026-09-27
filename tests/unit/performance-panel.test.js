import { test, expect, vi } from "vitest";
import { PerformancePanel } from "../../src/ui/performance-panel.js";

test("panel counts at most one drawn frame per RAF and disables monitoring on close", () => {
  let callback;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb) => {
      callback = cb;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let frames = 0;
  const viewer = {
    setPerformanceMonitoring: vi.fn(),
    getPerformanceStats: () => ({
      frames,
      cpuMs: 2,
      calls: 28,
      triangles: 5000,
    }),
    getInstancingStats: () => ({
      instancedObjects: 100,
      faceBatches: 6,
      edgeBatches: 3,
      reason: null,
    }),
  };
  const panel = new PerformancePanel(document.body, () => viewer);
  try {
    panel.element.open = true;
    panel.element.dispatchEvent(new Event("toggle"));
    callback(0);
    for (let time = 20; time <= 1000; time += 20) {
      frames += 3;
      callback(time);
    }
    expect(panel.element.querySelector("summary").textContent).toBe("50 FPS");
    expect(panel.element.textContent).toContain("Frame: 20.0 ms");
    expect(panel.element.textContent).toContain("Calls: 28");
    expect(panel.element.textContent).toContain("Instances: 100");
    callback(2000);
    expect(panel.element.textContent).toContain("Idle");
    expect(panel.element.querySelector("summary").textContent).toBe("0 FPS");
    panel.element.open = false;
    panel.element.dispatchEvent(new Event("toggle"));
    expect(viewer.setPerformanceMonitoring).toHaveBeenLastCalledWith(false);
    expect(cancelAnimationFrame).toHaveBeenCalled();
  } finally {
    panel.dispose();
    vi.unstubAllGlobals();
  }
});
