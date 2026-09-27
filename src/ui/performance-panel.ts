import type { Viewer } from "../core/viewer.js";

/** Optional diagnostics. Sampling never requests a viewer redraw. */
export class PerformancePanel {
  readonly element = document.createElement("details");
  private readonly summary = document.createElement("summary");
  private readonly output = document.createElement("pre");
  private viewer: Viewer | null = null;
  private request = 0;
  private start = 0;
  private previousTime = 0;
  private previousFrame = 0;
  private previousDrawn = false;
  private frames = 0;
  private intervals: number[] = [];
  private cpu: number[] = [];

  constructor(
    host: HTMLElement,
    private readonly getViewer: () => Viewer | null,
  ) {
    this.element.className = "tcv-performance";
    this.summary.textContent = "FPS";
    this.summary.title = "Rendering performance";
    this.output.textContent = "Waiting for frames";
    this.element.append(this.summary, this.output);
    host.append(this.element);
    this.element.addEventListener("toggle", this.toggle);
    document.addEventListener("visibilitychange", this.visibilityChanged);
  }

  private visibilityChanged = (): void => {
    this.reset(performance.now());
    this.previousDrawn = false;
    this.previousFrame = this.viewer?.getPerformanceStats().frames ?? 0;
  };

  private reset(time: number): void {
    this.start = time;
    this.frames = 0;
    this.intervals = [];
    this.cpu = [];
  }

  private toggle = (): void => {
    cancelAnimationFrame(this.request);
    this.viewer?.setPerformanceMonitoring(false);
    this.viewer = null;
    this.summary.textContent = "FPS";
    this.output.textContent = "Waiting for frames";
    this.previousTime = 0;
    this.previousDrawn = false;
    if (this.element.open) {
      this.reset(performance.now());
      this.request = requestAnimationFrame(this.sample);
    }
  };

  private sample = (time: number): void => {
    const viewer = this.getViewer();
    if (viewer !== this.viewer) {
      this.viewer?.setPerformanceMonitoring(false);
      this.viewer = viewer;
      viewer?.setPerformanceMonitoring(true);
      this.previousFrame = viewer?.getPerformanceStats().frames ?? 0;
      this.previousDrawn = false;
      this.reset(time);
    }
    const stats = viewer?.getPerformanceStats();
    const drawn = !!stats && stats.frames !== this.previousFrame;
    if (drawn && stats) {
      this.frames++;
      this.cpu.push(stats.cpuMs);
      if (this.previousDrawn) this.intervals.push(time - this.previousTime);
      this.previousFrame = stats.frames;
    }
    this.previousDrawn = drawn;
    this.previousTime = time;
    const elapsed = time - this.start;
    if (elapsed >= 1000) {
      const fps = (this.frames * 1000) / elapsed;
      this.summary.textContent = `${fps.toFixed(0)} FPS`;
      if (stats && viewer && this.frames) {
        const mean = (values: number[]) =>
          values.reduce((a, b) => a + b, 0) / values.length;
        const intervals = this.intervals.sort((a, b) => a - b);
        const p95 = intervals[Math.ceil(intervals.length * 0.95) - 1];
        const instancing = viewer.getInstancingStats();
        this.output.textContent = [
          `Frame: ${intervals.length ? mean(intervals).toFixed(1) : "--"} ms`,
          `P95:   ${p95?.toFixed(1) ?? "--"} ms`,
          `CPU:   ${mean(this.cpu).toFixed(1)} ms`,
          `Calls: ${stats.calls.toLocaleString("en-US")}`,
          `Triangles: ${stats.triangles.toLocaleString("en-US")}`,
          `Instances: ${instancing.instancedObjects}`,
          `Batches: ${instancing.faceBatches} faces / ${instancing.edgeBatches} edges`,
          `Instancing: ${instancing.reason ?? "active"}`,
        ].join("\n");
      } else {
        this.output.textContent = viewer ? "Idle" : "No model";
      }
      this.reset(time);
    }
    this.request = requestAnimationFrame(this.sample);
  };

  dispose(): void {
    cancelAnimationFrame(this.request);
    this.viewer?.setPerformanceMonitoring(false);
    this.element.removeEventListener("toggle", this.toggle);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.element.remove();
  }
}
