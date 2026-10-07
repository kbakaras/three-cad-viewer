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
  const p1 = "/Model/Product/A/P1",
    p2 = "/Model/Product/B/P2",
    bolt = "/Model/Hardware/Bolts/Bolt/Body";
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

  test("слой можно скрыть при первой загрузке, затем выбор сохраняется", () => {
    ctx = setupViewer();
    const shapes = makeLayeredFurniture();
    shapes.layer_defaults = { walls: false };
    ctx.viewer.render(shapes, ctx.renderOptions, ctx.viewerOptions);
    const v = ctx.viewer;
    expect(v.getLayers().walls.visible).toBe(false);
    expect(visible(v, "/Model/Walls/Body")).toBe(false);
    v.setLayerVisible("walls", true);
    expect(visible(v, "/Model/Walls/Body")).toBe(true);
    v.clear();
    v.render(shapes, ctx.renderOptions, ctx.viewerOptions);
    expect(v.getLayers().walls.visible).toBe(true);
  });

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
    v.setState("/Model/Product/A", [0, 0]);
    expect(visible(v, bolt)).toBe(false);
    v.setState("/Model/Product/A", [1, 1]);
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

  test("виды фурнитуры являются видимыми листьями, а выбор тела открывает вид", () => {
    const v = start();
    const kind = "/Model/Hardware/Bolts";
    const tv = v.treeview;
    tv.expandAll();
    tv.openPath(bolt);
    expect(tv.isLeaf(tv.findNodeByPath(kind))).toBe(true);
    const row = tv.getDomNode(kind);
    expect(row.querySelector(".tv-nav-marker").textContent).toBe("");
    expect(row.querySelector(".tv-children")).toBeNull();
    expect(tv.getDomNode(bolt)).toBeNull();
    expect(row.querySelector(".tv-node-label-highlight")).not.toBeNull();
    v.setState(kind, [0, 0]);
    expect(visible(v, bolt)).toBe(false);
    expect(visible(v, "/Model/Hardware/Bolts/BoltB/Body")).toBe(false);
    expect(visible(v, "/Model/Hardware/Dowels/Dowel/Body")).toBe(true);
    expect(visible(v, `${p1}/Body`)).toBe(true);
    v.setLayerVisible("hardware", false);
    v.setLayerVisible("hardware", true);
    expect(visible(v, bolt)).toBe(false);
  });

  test("скрытие модуля и изделия ограничивает только их фурнитуру", () => {
    const v = start();
    const kindState = v.getState("/Model/Hardware/Bolts").slice();
    v.setState(p1, [0, 0]);
    expect(visible(v, bolt)).toBe(true);
    v.setState("/Model/Product/A", [0, 0]);
    expect(visible(v, bolt)).toBe(false);
    expect(visible(v, "/Model/Hardware/Bolts/BoltB/Body")).toBe(true);
    expect(v.getState("/Model/Hardware/Bolts")).toEqual(kindState);
    v.setState("/Model/Product", [0, 0]);
    v.setState(p2, [1, 1]);
    expect(visible(v, bolt)).toBe(false);
    expect(visible(v, "/Model/Hardware/Bolts/BoltB/Body")).toBe(false);
    v.setState("/Model/Product/B", [1, 1]);
    expect(visible(v, "/Model/Hardware/Bolts/BoltB/Body")).toBe(true);
    expect(visible(v, bolt)).toBe(false);
  });

  test("новые крепежи наследуют отключённый вид, ограничения переживают полную загрузку", async () => {
    const v = start();
    const kind = "/Model/Hardware/Bolts";
    v.setState(kind, [0, 0]);
    const source = makeLayeredFurniture().parts[1].parts[0].parts[0];
    const added = structuredClone(source);
    added.id = `${kind}/NewBolt`;
    added.name = "New bolt";
    added.parts[0].id = `${added.id}/Body`;
    await v.applySceneDelta({ remove: [], update: [], add: [added] });
    expect(visible(v, `${added.id}/Body`)).toBe(false);
    v.setState(kind, [1, 1]);
    expect(visible(v, `${added.id}/Body`)).toBe(true);
    v.setState("/Model/Product/A", [0, 0]);
    v.setState("/Model/Hardware/Dowels", [0, 0]);
    v.clear();
    v.render(makeLayeredFurniture(), ctx.renderOptions, ctx.viewerOptions);
    expect(visible(v, bolt)).toBe(false);
    expect(visible(v, "/Model/Hardware/Bolts/BoltB/Body")).toBe(true);
    expect(v.getState("/Model/Hardware/Dowels")).toEqual([0, 0]);
    expect(v.getState("/Model/Product/A")).toEqual([0, 0]);
  });

  test("изменение и удаление метаданных дельтой обновляет дерево и ограничение", async () => {
    const v = start();
    v.setState("/Model/Product/A", [0, 0]);
    const kind = "/Model/Hardware/Bolts";
    const connector = `${kind}/Bolt`;
    const body = v.nestedGroup.groups[bolt];
    await v.applySceneDelta({
      remove: [],
      add: [],
      update: [
        { id: connector, name: "Bolt", parts: [], visible_if_any: [p2] },
        { id: kind, name: "Конфирматы", parts: [] },
      ],
    });
    expect(v.nestedGroup.groups[bolt]).toBe(body);
    expect(visible(v, bolt)).toBe(true);
    expect(v.treeview.isLeaf(v.treeview.findNodeByPath(kind))).toBe(false);
  });

  test("индивидуально скрытый крепёж остаётся скрытым при перестройке дерева", async () => {
    const v = start();
    const kind = "/Model/Hardware/Bolts";
    v.setState(kind, [1, 1]);
    v.setState(bolt, [0, 0]);
    expect(v.getState(kind)).toEqual([2, 2]);
    await v.applySceneDelta({
      remove: [],
      add: [],
      update: [{ id: kind, name: "Renamed type", parts: [], tree_leaf: true }],
    });
    expect(visible(v, bolt)).toBe(false);
    expect(visible(v, "/Model/Hardware/Bolts/BoltB/Body")).toBe(true);
  });

  test("первый крепёж наследует скрытие своего модуля", async () => {
    ctx = setupViewer();
    const model = makeLayeredFurniture();
    const added = model.parts[1];
    model.parts.splice(1, 1);
    const v = ctx.viewer;
    v.render(model, ctx.renderOptions, ctx.viewerOptions);
    v.setState("/Model/Product/A", [0, 0]);
    await v.applySceneDelta({ remove: [], update: [], add: [added] });
    expect(visible(v, bolt)).toBe(false);
    expect(visible(v, "/Model/Hardware/Bolts/BoltB/Body")).toBe(true);
    v.setState("/Model/Product/A", [1, 1]);
    expect(visible(v, bolt)).toBe(true);
  });

  test("новый вид наследует скрытие всей ветки фурнитуры", async () => {
    const v = start();
    v.setState("/Model/Hardware", [0, 0]);
    const source = makeLayeredFurniture().parts[1].parts[1];
    const added = structuredClone(source);
    added.id = "/Model/Hardware/NewKind";
    added.name = "New kind";
    added.parts[0].id = `${added.id}/Dowel`;
    added.parts[0].parts[0].id = `${added.id}/Dowel/Body`;
    await v.applySceneDelta({ remove: [], update: [], add: [added] });
    expect(v.getState(added.id)).toEqual([0, 0]);
    expect(visible(v, `${added.id}/Dowel/Body`)).toBe(false);
    v.setState("/Model/Hardware", [1, 1]);
    expect(visible(v, `${added.id}/Dowel/Body`)).toBe(true);
  });

  test("запрет от модуля и конечные строки действуют в развёрнутой геометрии", () => {
    const v = start();
    v.setState("/Model/Product/A", [0, 0]);
    v.setTransparent(true);
    v.toggleGroup(true);
    v.update(true, false);
    const groups = Object.entries(v.nestedGroup.groups).filter(
      ([id, group]) => id.startsWith(bolt + "/") && group.isObjectGroup,
    );
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every(([, group]) => !group.visible)).toBe(true);
    expect(
      v.treeview.isLeaf(v.treeview.findNodeByPath("/Model/Hardware/Bolts")),
    ).toBe(true);
    v.treeview.expandAll();
    v.treeview.openPath(groups[0][0]);
    expect(v.treeview.getDomNode(groups[0][0])).toBeNull();
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
