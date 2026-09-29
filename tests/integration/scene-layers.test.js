import { afterEach, describe, expect, test, vi } from "vitest";
import { setupViewer, cleanup } from "../helpers/setup.js";
import { makeLayeredFurniture } from "../fixtures/layers.js";
import { Raycaster } from "../../src/rendering/raycast.js";

describe("Слои модели", () => {
  let ctx;
  afterEach(() => {
    if (ctx) cleanup(ctx);
    ctx = null;
  });
  const p1 = "/Model/A/P1",
    p2 = "/Model/B/P2",
    bolt = "/Model/A/Hardware/Bolt/Body";
  function start() {
    ctx = setupViewer();
    ctx.viewer.render(
      makeLayeredFurniture(),
      ctx.renderOptions,
      ctx.viewerOptions,
    );
    return ctx.viewer;
  }
  const visible = (v, id) => v.nestedGroup.groups[id].getVisibility();

  test("галочка слоя не меняет дерево и скрытые панели не показывают надписи", () => {
    const v = start();
    expect(Object.values(v.getLayers()).every((layer) => layer.visible)).toBe(
      true,
    );
    const states = v.getStates();
    const geometry = v.nestedGroup.groups[`${p1}/Name/Text`].front.geometry;
    const camera = v.controls.getTarget().clone();
    const checkbox = ctx.container.querySelector('[data-layer="labels"]');
    checkbox.click();
    expect(visible(v, `${p1}/Name/Text`)).toBe(false);
    expect(v.getStates()).toEqual(states);
    v.setState(p1, [0, 0]);
    v.setLayerVisible("labels", true);
    expect(visible(v, `${p1}/Name/Text`)).toBe(false);
    expect(visible(v, `${p2}/Name/Text`)).toBe(true);
    v.setState(`${p1}/Name/Text`, [1, 1]);
    expect(visible(v, `${p1}/Name/Text`)).toBe(false);
    expect(v.nestedGroup.groups[`${p1}/Name/Text`].front.geometry).toBe(
      geometry,
    );
    expect(v.controls.getTarget().distanceTo(camera)).toBe(0);
  });

  test("фурнитура следует хотя бы одной панели, но дерево имеет приоритет", () => {
    const v = start();
    v.setState(p1, [0, 0]);
    expect(visible(v, bolt)).toBe(true);
    v.setLayerVisible("facades", false);
    expect(visible(v, bolt)).toBe(false);
    expect(visible(v, `${p2}/Name/Text`)).toBe(false);
    v.setLayerVisible("facades", true);
    expect(visible(v, bolt)).toBe(true);
    v.setState("/Model/A", [0, 0]);
    expect(visible(v, bolt)).toBe(false);
    v.setState("/Model/A", [1, 1]);
    v.setState(bolt, [0, 0]);
    v.setLayerVisible("hardware", false);
    v.setLayerVisible("hardware", true);
    expect(visible(v, bolt)).toBe(false);
  });

  test("настройки сохраняются при полной загрузке и изменении метаданных дельтой", async () => {
    const v = start();
    v.setLayerVisible("walls", false);
    v.clear();
    v.render(makeLayeredFurniture(), ctx.renderOptions, ctx.viewerOptions);
    expect(visible(v, "/Model/Walls/Body")).toBe(false);
    expect(v.getLayers().walls.visible).toBe(false);
    const before = v.nestedGroup.groups[`${p1}/Body`];
    await v.applySceneDelta({
      remove: [],
      add: [],
      update: [{ id: p1, name: "Renamed panel", parts: [], layer: "walls" }],
    });
    expect(v.nestedGroup.groups[`${p1}/Body`]).toBe(before);
    expect(visible(v, `${p1}/Body`)).toBe(false);
    await v.applySceneDelta({
      remove: [],
      add: [],
      update: [{ id: p1, name: "Renamed panel", parts: [] }],
    });
    expect(visible(v, `${p1}/Body`)).toBe(true);
  });

  test("развёрнутая геометрия и прозрачность сохраняют фильтр", () => {
    const v = start();
    v.setLayerVisible("labels", false);
    v.setTransparent(true);
    v.toggleGroup(true);
    v.update(true, false);
    for (const [id, group] of Object.entries(v.nestedGroup.groups)) {
      if (id.startsWith(`${p1}/Name/Text/`) && group.isObjectGroup)
        expect(group.visible).toBe(false);
    }
    v.toggleGroup(false);
    v.update(true, false);
    expect(visible(v, `${p1}/Name/Text`)).toBe(false);
  });

  test("скрытые слои не попадают в выбор мышью", () => {
    const v = start();
    v.setLayerVisible("walls", false);
    const object = v.nestedGroup.groups["/Model/Walls/Body"].front;
    const raycaster = new Raycaster(
      v.rendered.camera,
      v.renderer.domElement,
      800,
      600,
      1,
      v.nestedGroup.rootGroup,
      () => {},
    );
    vi.spyOn(raycaster.raycaster, "intersectObjects").mockReturnValue([
      { object },
    ]);
    expect(raycaster.getIntersectedObjs()).toEqual([]);
    raycaster.dispose();
  });
});
