# GPU instancing in CAD mode

Repeated solid shapes use GPU `InstancedMesh` batches by default. Front faces,
back faces and edges are grouped separately by shared source geometry and
compatible material settings. Fat edges use `LineSegments2` with merged,
world-space endpoints: this reduces draw calls but is not per-shape GPU edge
instancing. Lighting is still evaluated at each occurrence's transformed
position and normal; instances do not share a baked lighting result.

## Model contract

No Python API or wire-format change is required. The existing
`{ instances, shapes }` payload with `shape: { ref: N }` is supported. In an
in-memory unencoded shape tree, reusing the same `shape` object also works.
Translations and rotations remain on individual tree nodes, including parent
assemblies. Colors and material settings may differ: they form separate batches.

The renderer does not compare independently tessellated buffers for equality.
If every occurrence arrives with a different source geometry, it remains an
ordinary mesh. Prefer copies/locations of the same CAD part over rebuilding an
identical part separately; inspect the transmitted refs before changing model
generation. Unrelated and unique parts can coexist with batched hardware.

The original ObjectGroups remain authoritative for visibility, paths, tree state,
raycasting and CAD tools. They are replaced only during a render call, including
the pivot depth pass, then restored in `finally`. Updating one repeated part via
`updatePart()` detaches its shared CPU buffers and removes that occurrence from
its old batch. Use the viewer APIs for geometry updates; direct buffer writes
without version updates are not a supported invalidation mechanism.

## Scope and fallback

- Ordinary CAD mode, opaque untextured solid parts, rigid positive transforms.
- At least two compatible occurrences per batch.
- Clipping, measurement/selection tools, expanded topology, explode/animation,
  Studio, zebra, normal helpers and shared external GL contexts use the original
  render path. Returning to ordinary CAD mode restores batching.
- Transparent, textured, custom-shader, mirrored or scaled objects stay on the
  ordinary path. Global transparency disables batching entirely.
- Inactive clipping stencil writers are hidden independently of instancing.
- Cache geometries/materials are owned and disposed by the render cache; it never
  disposes source geometry. `clear()` also releases the separate pivot and
  orientation-marker scenes, which previously leaked across model reloads.

This optimizes draw submission, not tessellation, triangle count, initial model
loading or Python processing. Keeping CPU-side proxies also means scene traversal
still scales with the number of parts.

## API

```js
viewer.render(
  payload,
  { ...renderOptions, gpuInstancing: true },
  viewerOptions,
);
viewer.setGpuInstancing(false); // A/B comparison without reloading
viewer.setGpuInstancing(true);
console.log(viewer.getInstancingStats());
```

`gpuInstancing` defaults to `true` on every `render()`. Stats include a fallback
`reason` (or `null`), `eligibleInstances` (including unique eligible parts),
`instancedObjects` (parts with at least one batched component), `faceBatches`,
`edgeBatches` and cumulative `rebuilds` since cache disposal. Camera rotation must
not increase `rebuilds`. Suspended batches are retained until reused or cleared.

## Verification

```sh
yarn install --frozen-lockfile --ignore-scripts
npx playwright install --with-deps chromium
npm run test:run -- --testTimeout=30000
npx tsc --noEmit
npm run test:instancing
```

The browser runner builds baseline commit
`58fd979f8c9685c0c2d7455a5363135bc35143ab` in `test-results/baseline` using the same
dependencies. It tests the baseline, stencil-only fix, and full instancing for
100/1000/3000 repeated parts with different colors and nested transforms.
It records complete-frame draw calls, including pivot depth and orientation
passes (`renderer.info.autoReset = false`), CPU median/p95 and rAF interval
median/p95 after warmup. The full-frame call reduction must exceed 10x compared
with the stencil-only mode. There is no hardware-independent FPS assertion.

Desktop/mobile checks compare pixels with batching off/on, exercise pointer
rotation, hidden/transparent parts, fallback transitions and repeated clear/render
cycles. Browser and shader errors fail the run. Results and screenshots are in
`test-results/instancing.json` and `test-results/*.png`.

The default browser is headless Chromium with SwiftShader for reproducibility.
Use `SOFTWARE_GL=0 HEADED=1` on a GPU-equipped machine for representative frame
times. `SAMPLES`, `COUNTS`, `BASELINE_REF` and `SKIP_BASELINE_BUILD=1` control the
runner. `TEST_MODEL=/absolute/path/model.viewer.json` adds a real serialized-model
comparison without modifying that file or involving Python.

`MODES=instanced COUNTS=100 SAMPLES=10 SKIP_BASELINE_BUILD=1` runs a shorter
visual/lifecycle smoke test against an already built bundle. It intentionally
does not assert a baseline draw-call ratio.

For manual inspection, serve this repository over HTTP and open
`tests/browser/instancing.html`. The Original option requires the baseline build
created by the runner. The existing Dockerfile builds this local library and
copies its bundle into the standalone Python viewer; no backend changes are
needed.

## Recorded run (2026-09-27)

Chromium / SwiftShader, 1100 x 680 viewport, six warmup frames and twenty
measured rotation frames per case. Full-frame draw calls:

| Scene                           | Original | Stencil fix only | Instancing |
| ------------------------------- | -------: | ---------------: | ---------: |
| 100 repeated parts + panel      |     1626 |              313 |         28 |
| 1000 repeated parts + panel     |    16026 |             3013 |         28 |
| 3000 repeated parts + panel     |    48026 |             9013 |         28 |
| `office.viewer.json`, 502 parts |     8042 |             1516 |        511 |

The office model batches 354 parts into 19 face and 19 edge batches. No model
or Python changes were made. Geometry is not simplified: the stencil-only and
instanced modes submit the same triangle count in every measured scene.

Synthetic desktop/mobile images match exactly, including hidden and translucent
parts. The office image differs above the per-channel tolerance (16/255) in
0.00544% of pixels; the acceptance limit is 0.3%. Four clear/render cycles retain
exactly 423 GPU geometries each. Pointer rotation and clipping/transparency
fallback transitions pass, with no browser or shader errors.

See [raw results, including median/p95 timings](docs/instancing-benchmark.json).
SwiftShader timings show substantial queueing jitter. In this run most of the
office-model timing improvement comes from disabling inactive stencils;
instancing reduces calls further but does not improve its median frame time.
Draw-call reductions must not be interpreted as proportional FPS gains.
Representative GPU timings still need to be measured on the target machine.

The TypeScript build and unit/integration suite pass. Docker/standalone Python
integration was not run: Docker and the Python CAD dependencies are absent in
this environment. `npm run lint` is blocked by the pre-existing missing
`@eslint/js` dependency in the repository's ESLint configuration.
