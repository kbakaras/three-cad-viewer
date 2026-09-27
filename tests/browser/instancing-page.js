import * as THREE from "three";
import { makeFurniture } from "../fixtures/furniture.js";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "instanced";
const count = Number(params.get("count") ?? 100);
const { Viewer, Display } = await import(
  mode === "baseline"
    ? "/test-results/baseline/dist/three-cad-viewer.esm.js"
    : "/dist/three-cad-viewer.esm.js"
);
const compact = innerWidth < 600;
const treeWidth = 220;
const displayOptions = {
  cadWidth: innerWidth - (compact ? 0 : treeWidth) - 32,
  height: 520,
  treeWidth,
  theme: "light",
  pinning: false,
  glass: compact,
  tools: true,
  keymap: { shift: "shiftKey", ctrl: "ctrlKey", meta: "metaKey" },
  newTreeBehavior: true,
  measureTools: true,
  selectTool: true,
  explodeTool: true,
  zebraTool: true,
  studioTool: true,
};
const viewer = new Viewer(
  new Display(document.querySelector("#viewer"), displayOptions),
  displayOptions,
  () => {},
);
const renderOptions = {
  ambientIntensity: 1,
  directIntensity: 1.1,
  metalness: 0.3,
  roughness: 0.65,
  edgeColor: 0x707070,
  defaultOpacity: 0.5,
  normalLen: 0,
  gpuInstancing: mode === "instanced",
};
const viewerOptions = {
  ortho: true,
  up: "Z",
  ticks: 5,
  transparent: false,
  blackEdges: false,
  axes: false,
  axes0: false,
  grid: [false, false, false],
  timeit: false,
  clipIntersection: false,
  clipPlaneHelpers: false,
  rotateSpeed: 1,
  zoomSpeed: 0.5,
  panSpeed: 0.5,
  collapse: 1,
};
window.loadModel = (model) => {
  viewer.clear();
  viewer.render(model, renderOptions, viewerOptions);
  if (compact) viewer.display.showToolsPanel(false);
};
window.loadFixture = (n = count, extras = false) =>
  window.loadModel(makeFurniture(n, { encoded: true, extras }));
if (params.has("model"))
  window.loadModel(await (await fetch("/external-model.json")).json());
else window.loadFixture();
window.viewer = viewer;
const renderer = viewer.renderer;
renderer.info.autoReset = false;

function frame() {
  renderer.info.reset();
  viewer.update(true, false);
  return { ...renderer.info.render };
}
function pixels() {
  frame();
  frame();
  const gl = renderer.getContext();
  const data = new Uint8Array(
    gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
  );
  gl.readPixels(
    0,
    0,
    gl.drawingBufferWidth,
    gl.drawingBufferHeight,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data,
  );
  return data;
}
window.compareRendering = () => {
  viewer.setGpuInstancing(false);
  const before = pixels();
  viewer.setGpuInstancing(true);
  const after = pixels();
  let changed = 0,
    error = 0;
  const colors = new Set();
  for (let i = 0; i < before.length; i += 4) {
    const delta = Math.max(
      ...[0, 1, 2].map((c) => Math.abs(before[i + c] - after[i + c])),
    );
    if (delta > 16) changed++;
    error += [0, 1, 2].reduce(
      (sum, c) => sum + Math.abs(before[i + c] - after[i + c]),
      0,
    );
    if (i % 40 === 0) colors.add(`${after[i]},${after[i + 1]},${after[i + 2]}`);
  }
  return {
    changedFraction: changed / (before.length / 4),
    meanError: error / ((before.length / 4) * 3),
    colors: colors.size,
    stats: viewer.getInstancingStats(),
  };
};
window.measureRotation = async (samples = 60) => {
  const camera = viewer.camera.getCamera();
  const target = viewer.controls.getTarget();
  const offset = camera.position.clone().sub(target);
  const axis = new THREE.Vector3(0, 0, 1);
  const cpu = [],
    intervals = [];
  let last = 0,
    totals;
  for (let i = -6; i < samples; i++) {
    const now = await new Promise(requestAnimationFrame);
    camera.position
      .copy(offset)
      .applyAxisAngle(axis, (i + 6) * 0.007)
      .add(target);
    camera.lookAt(target);
    const start = performance.now();
    totals = frame();
    if (i >= 0) {
      cpu.push(performance.now() - start);
      intervals.push(now - last);
    }
    last = now;
  }
  const summarize = (values) => {
    values.sort((a, b) => a - b);
    return {
      median: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
    };
  };
  const gl = renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    mode,
    count: params.has("model") ? null : count,
    partCount: Object.values(viewer.nestedGroup.groups).filter(
      (g) => g.isObjectGroup,
    ).length,
    samples,
    calls: totals.calls,
    triangles: totals.triangles,
    cpuMs: summarize(cpu),
    frameMs: summarize(intervals),
    gpu: debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
    stats: viewer.getInstancingStats?.() ?? null,
    memory: { ...renderer.info.memory },
  };
};
document.querySelector("#count").value = String(count);
document.querySelector("#mode").value = mode;
for (const id of ["count", "mode"])
  document.querySelector(`#${id}`).onchange = () => {
    location.search = new URLSearchParams({
      count: document.querySelector("#count").value,
      mode: document.querySelector("#mode").value,
    });
  };
document.querySelector("#run").onclick = async () => {
  const button = document.querySelector("#run");
  button.disabled = true;
  try {
    document.querySelector("#result").textContent = JSON.stringify(
      await window.measureRotation(),
      null,
      2,
    );
  } finally {
    button.disabled = false;
  }
};
frame();
window.ready = true;
