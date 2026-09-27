import { describe, test, expect, vi } from "vitest";
import { setupViewer, cleanup } from "../helpers/setup.js";
import { makeFurniture } from "../fixtures/furniture.js";

describe("Performance counters", () => {
  test("opt-in, full-update counts, clear/reload and renderer state restoration", () => {
    const ctx = setupViewer();
    const v = ctx.viewer;
    try {
      v.render(makeFurniture(12), ctx.renderOptions, ctx.viewerOptions);
      const info = {
        autoReset: true,
        render: { calls: 100, triangles: 200, lines: 50 },
        reset: vi.fn(() => {
          info.render = { calls: 0, triangles: 0, lines: 0 };
        }),
      };
      v.renderer.info = info;
      const frame = vi.spyOn(v, "updateFrame").mockImplementation(() => {
        expect(info.autoReset).toBe(false);
        info.render.calls += 7;
        info.render.triangles += 25;
        info.render.lines += 3;
      });
      v.setPerformanceMonitoring(true);
      v.update(true, false);
      expect(v.getPerformanceStats()).toMatchObject({
        frames: 1,
        calls: 7,
        triangles: 25,
        lines: 3,
      });
      expect(info.autoReset).toBe(true);
      expect(info.reset).toHaveBeenCalledTimes(1);
      info.autoReset = false;
      v.update(true, false);
      expect(v.getPerformanceStats().frames).toBe(2);
      expect(info.reset).toHaveBeenCalledTimes(1);
      expect(info.render.calls).toBe(7);
      frame.mockImplementation(() => {
        throw new Error("render failed");
      });
      info.autoReset = true;
      expect(() => v.update(true)).toThrow("render failed");
      expect(info.autoReset).toBe(true);
      frame.mockImplementation(() => {});
      v.setPerformanceMonitoring(false);
      v.update(true);
      expect(v.getPerformanceStats().frames).toBe(2);
      frame.mockRestore();
      v.clear();
      v.setPerformanceMonitoring(true);
      v.update(true);
      expect(v.getPerformanceStats().frames).toBe(2);
      v.render(makeFurniture(12), ctx.renderOptions, ctx.viewerOptions);
      expect(v.getPerformanceStats().frames).toBeGreaterThan(2);
    } finally {
      cleanup(ctx);
    }
  });
});
