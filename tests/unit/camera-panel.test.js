import { test, expect, vi } from "vitest";
import { CameraPanel } from "../../src/ui/camera-panel.js";

test("camera inspector tracks current viewer only while open and preserves text selection", () => {
  vi.useFakeTimers();
  let viewer = null;
  const panel = new CameraPanel(document.body, () => viewer);
  const output = panel.element.querySelector("textarea");
  const toggle = (open) => {
    panel.element.open = open;
    panel.element.dispatchEvent(new Event("toggle"));
  };
  try {
    expect(panel.element.open).toBe(false);
    toggle(true);
    expect(output.value).toBe("Нет модели");
    viewer = {
      ready: false,
      getCameraLocationSettings: vi.fn(() => ({
        position: [1, -2, 3],
        quaternion: [0, 0, 0, 1],
        target: [4, 5, 6],
        zoom: 1.25,
      })),
      getOrtho: () => false,
      state: { get: (key) => ({ control: "orbit", up: "Z" })[key] },
    };
    vi.advanceTimersByTime(250);
    expect(viewer.getCameraLocationSettings).not.toHaveBeenCalled();
    viewer.ready = true;
    vi.advanceTimersByTime(250);
    expect(output.value).toContain("position=(1, -2, 3)");
    expect(output.value).toContain("quaternion=(0, 0, 0, 1)");
    expect(output.value).toContain("target=(4, 5, 6)");
    expect(output.value).toContain("zoom=1.25");
    expect(output.value).toContain("ortho=False");
    expect(output.value).toContain("orbit_control=True");
    output.setSelectionRange(0, 10);
    vi.advanceTimersByTime(250);
    expect(output.selectionEnd).toBe(10);
    toggle(false);
    viewer.getCameraLocationSettings.mockClear();
    vi.advanceTimersByTime(1000);
    expect(viewer.getCameraLocationSettings).not.toHaveBeenCalled();
    viewer = { ...viewer, getOrtho: () => true };
    toggle(true);
    expect(output.value).toContain("ortho=True");
    panel.dispose();
    viewer.getCameraLocationSettings.mockClear();
    vi.advanceTimersByTime(1000);
    expect(viewer.getCameraLocationSettings).not.toHaveBeenCalled();
    expect(panel.element.isConnected).toBe(false);
  } finally {
    panel.dispose();
    vi.useRealTimers();
  }
});
