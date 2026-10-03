import type { Viewer } from "../core/viewer.js";

/** Read-only camera inspector. No sampling or redraws while collapsed. */
export class CameraPanel {
  readonly element = document.createElement("details");
  private readonly output = document.createElement("textarea");
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    host: HTMLElement,
    private readonly getViewer: () => Viewer | null,
  ) {
    this.element.className = "tcv-camera";
    const summary = document.createElement("summary");
    summary.textContent = "Камера";
    this.output.readOnly = true;
    this.output.rows = 10;
    this.output.spellcheck = false;
    this.output.setAttribute("aria-label", "ViewerConfig камеры");
    this.element.append(summary, this.output);
    host.append(this.element);
    this.element.addEventListener("toggle", this.toggle);
  }

  private refresh = (): void => {
    const viewer = this.getViewer();
    let text = "Нет модели";
    if (viewer?.ready) {
      const { position, quaternion, target, zoom } =
        viewer.getCameraLocationSettings();
      const number = (value: number, digits = 6) =>
        Number(value.toFixed(digits));
      const tuple = (values: number[], digits = 6) =>
        `(${values.map((value) => number(value, digits)).join(", ")})`;
      text = [
        "VIEWER = ViewerConfig(",
        `    position=${tuple(position)},`,
        `    quaternion=${tuple(quaternion, 9)},`,
        `    target=${tuple(target)},`,
        `    zoom=${number(zoom, 9)},`,
        `    ortho=${viewer.getOrtho() ? "True" : "False"},`,
        `    orbit_control=${viewer.state.get("control") === "orbit" ? "True" : "False"},`,
        `    up="${viewer.state.get("up")}",`,
        ")",
      ].join("\n");
    }
    // Avoid resetting selection and scroll when the camera has not moved.
    if (this.output.value !== text) this.output.value = text;
  };

  private toggle = (): void => {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.element.open) {
      this.refresh();
      this.timer = setInterval(this.refresh, 250);
    }
  };

  dispose(): void {
    clearInterval(this.timer);
    this.element.removeEventListener("toggle", this.toggle);
    this.element.remove();
  }
}
