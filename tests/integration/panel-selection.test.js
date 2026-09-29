import { afterEach, describe, expect, test, vi } from "vitest";
import { setupViewer, cleanup } from "../helpers/setup.js";
import { makeLayeredFurniture } from "../fixtures/layers.js";
import { Raycaster } from "../../src/rendering/raycast.js";

describe("Выделение панелей", () => {
  let ctx;
  const p1 = "/Model/Product/A/P1",
    p2 = "/Model/Product/B/P2",
    p3 = "/Model/Product/C/P3";
  const bolt = "/Model/Hardware/Bolts/Bolt/Body";
  const dowel = "/Model/Hardware/Dowels/Dowel/Body";
  const visible = (v, id) => v.nestedGroup.groups[id].getVisibility();
  function start(thirdPanel = false) {
    ctx = setupViewer();
    const model = makeLayeredFurniture({ thirdPanel });
    const panel = model.parts[0].parts[0].parts[0];
    panel.parts.push({
      ...panel.parts[0],
      id: `${p1}/Edge`,
      name: "Кромка",
      state: [1, 1],
    });
    ctx.viewer.render(model, ctx.renderOptions, ctx.viewerOptions);
    ctx.display.showHelp(false);
    return ctx.viewer;
  }
  function press(code, key, extra = {}, target = ctx.container) {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code,
        key,
        ...extra,
      }),
    );
  }
  afterEach(() => {
    if (ctx) cleanup(ctx);
    ctx = null;
    vi.restoreAllMocks();
  });

  test("выбор тела, кромки и надписи переключает всю панель, не измерения", () => {
    const v = start();
    v.togglePanelSelection(`${p1}/Name/Text`);
    expect(v.getSelectedPanels()).toEqual([p1]);
    for (const id of [`${p1}/Body`, `${p1}/Edge`]) {
      const group = v.nestedGroup.groups[id];
      expect(group.isGroupSelected).toBe(true);
      expect(group.isSelected).toBe(false);
      expect(group.front.material.color.getHex()).toBe(0x53a0e3);
      group.highlight(true);
      group.unhighlight(false);
      expect(group.front.material.color.getHex()).toBe(0x53a0e3);
    }
    expect(v.nestedGroup.groups[`${p1}/Name/Text`].isGroupSelected).toBe(false);
    expect(v.nestedGroup.selection()).toEqual([]);
    v.togglePanelSelection(`${p2}/Body`);
    v.togglePanelSelection(bolt);
    v.togglePanelSelection("/Model/Walls/Body");
    expect(v.getSelectedPanels()).toEqual([p1, p2]);
    v.togglePanelSelection(`${p1}/Edge`);
    expect(v.getSelectedPanels()).toEqual([p2]);
    expect(
      v.nestedGroup.groups[`${p1}/Body`].front.material.color.getHex(),
    ).toBe(0x82a3ad);
  });

  test("i изолирует выделенные панели, повторное i возвращает остальные", () => {
    const v = start();
    const states = v.getStates();
    const camera = v.getCameraLocationSettings();
    v.togglePanelSelection(p2);
    press("KeyI", "ш");
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p1}/Name/Text`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    expect(visible(v, bolt)).toBe(true);
    expect(visible(v, dowel)).toBe(false);
    expect(visible(v, "/Model/Walls/Body")).toBe(true);
    expect(v.getStates()).toEqual(states);
    press("KeyI", "ш", { repeat: true });
    expect(visible(v, `${p1}/Body`)).toBe(false);
    press("KeyI", "ш");
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    expect(visible(v, dowel)).toBe(true);
    press("KeyI", "ш");
    expect(visible(v, `${p1}/Body`)).toBe(false);
    press("Escape", "Escape");
    expect(v.getSelectedPanels()).toEqual([]);
    expect(visible(v, `${p1}/Body`)).toBe(false);
    press("KeyI", "ш");
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(v.getCameraLocationSettings()).toEqual(camera);
  });

  test("i переизолирует изменённое выделение и без выделения показывает все панели", () => {
    const v = start();
    v.togglePanelSelection(p1);
    v.togglePanelIsolation();
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    v.togglePanelSelection(p1);
    v.togglePanelSelection(p2);
    v.togglePanelIsolation();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    v.clearPanelSelection();
    v.togglePanelIsolation();
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p2}/Body`)).toBe(true);
  });

  test("индикатор считает временно скрытые панели, независимо от выделения", () => {
    const v = start();
    const indicator = ctx.container.querySelector(".tcv_panel_filter");
    const status = ctx.container.querySelector(".tcv_panel_filter_status");
    const reset = ctx.container.querySelector(".tcv_panel_filter_reset");
    expect(indicator.hidden).toBe(true);
    expect(v.getPanelFilter()).toBeNull();
    v.togglePanelSelection(p1);
    v.togglePanelSelection(p2);
    v.hideSelectedPanels();
    expect(indicator.hidden).toBe(false);
    expect(status.textContent).toBe("Временно скрыто: 2");
    expect(v.getPanelFilter()).toEqual({ count: 2 });
    v.togglePanelSelection(p2);
    expect(status.textContent).toBe("Временно скрыто: 2");
    v.togglePanelIsolation();
    expect(status.textContent).toBe("Временно скрыто: 1");
    v.setActiveTab("clip");
    expect(indicator.hidden).toBe(false);
    v.clearPanelSelection();
    expect(status.textContent).toBe("Временно скрыто: 1");
    reset.click();
    expect(indicator.hidden).toBe(true);
    expect(status.textContent).toBe("");
    expect(v.getPanelFilter()).toBeNull();
    expect(visible(v, `${p2}/Body`)).toBe(true);
  });

  test("сброс через UI сохраняет выделение, дерево, слои и камеру", () => {
    const v = start();
    v.setState(`${p2}/Body`, [0, 0]);
    v.setLayerVisible("labels", false);
    const states = v.getStates();
    const layers = v.getLayers();
    const camera = v.getCameraLocationSettings();
    v.togglePanelSelection(p1);
    v.hideSelectedPanels();
    v.togglePanelSelection(p1);
    ctx.container.querySelector(".tcv_panel_filter_reset").click();
    expect(v.getSelectedPanels()).toEqual([p1]);
    expect(v.getStates()).toEqual(states);
    expect(v.getLayers()).toEqual(layers);
    expect(v.getCameraLocationSettings()).toEqual(camera);
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p1}/Name/Text`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    const update = vi.spyOn(v, "update");
    v.clearPanelFilter();
    expect(update).not.toHaveBeenCalled();
  });

  test("индикатор обновляет число панелей и исчезает после удаления последней", async () => {
    const v = start();
    const indicator = ctx.container.querySelector(".tcv_panel_filter");
    const status = ctx.container.querySelector(".tcv_panel_filter_status");
    v.togglePanelSelection(p1);
    v.togglePanelSelection(p2);
    v.hideSelectedPanels();
    v.clear();
    expect(indicator.hidden).toBe(true);
    v.render(makeLayeredFurniture(), ctx.renderOptions, ctx.viewerOptions);
    expect(indicator.hidden).toBe(false);
    expect(status.textContent).toBe("Временно скрыто: 2");
    await v.applySceneDelta({ remove: [p2], add: [], update: [] });
    expect(status.textContent).toBe("Временно скрыто: 1");
    await v.applySceneDelta({ remove: [p1], add: [], update: [] });
    expect(indicator.hidden).toBe(true);
    expect(v.getPanelFilter()).toBeNull();
  });

  test("снятие изоляции не включает панель, скрытую через дерево", () => {
    const v = start();
    v.togglePanelSelection(p2);
    v.togglePanelIsolation();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    v.setState("/Model/Product/A", [0, 0]);
    v.togglePanelIsolation();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p1}/Edge`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(true);
  });

  test("изоляция не включает скрытые панели, слои и модули", () => {
    const v = start();
    v.setState(`${p1}/Body`, [0, 0]);
    v.setLayerVisible("labels", false);
    v.setLayerVisible("facades", false);
    v.togglePanelSelection(p2);
    v.togglePanelIsolation();
    expect(visible(v, `${p2}/Body`)).toBe(false);
    v.setLayerVisible("facades", true);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    v.setState("/Model/Product/B", [0, 0]);
    v.togglePanelIsolation();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p1}/Edge`)).toBe(true);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    expect(v.getLayers().labels.visible).toBe(false);
  });

  test("Alt+i скрывает выбранные панели и снимает выделение, не меняя дерево", () => {
    const v = start();
    const states = v.getStates();
    v.togglePanelSelection(p1);
    v.togglePanelSelection(p2);
    press("KeyI", "ш", { ctrlKey: true, altKey: true });
    press("KeyO", "щ");
    expect(visible(v, `${p1}/Body`)).toBe(true);
    const input = ctx.container.appendChild(document.createElement("input"));
    press("KeyI", "ш", { altKey: true }, input);
    expect(visible(v, `${p1}/Body`)).toBe(true);
    press("KeyI", "ш", { altKey: true });
    expect(v.getSelectedPanels()).toEqual([]);
    expect(v.getStates()).toEqual(states);
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p1}/Edge`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    expect(visible(v, `${p1}/Name/Text`)).toBe(false);
    expect(visible(v, bolt)).toBe(false);
    expect(visible(v, "/Model/Walls/Body")).toBe(true);
    press("KeyI", "ш", { altKey: true, repeat: true });
    expect(visible(v, `${p1}/Body`)).toBe(false);
    press("KeyI", "ш", { altKey: true });
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    expect(v.getStates()).toEqual(states);
    v.clearPanelFilter();
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p2}/Body`)).toBe(true);
  });

  test("i сразу после Alt+i возвращает все панели, без старого выделения", () => {
    const v = start();
    const states = v.getStates();
    const camera = v.getCameraLocationSettings();
    v.togglePanelSelection(p1);
    press("KeyI", "ш", { altKey: true });
    expect(v.getSelectedPanels()).toEqual([]);
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    for (const path of [`${p1}/Body`, `${p1}/Edge`]) {
      const group = v.nestedGroup.groups[path];
      expect(group.isGroupSelected).toBe(false);
      expect(group.front.material.color.getHex()).toBe(0x82a3ad);
    }
    expect(v.getPanelFilter()).toEqual({ count: 1 });
    press("KeyI", "ш");
    expect(v.getPanelFilter()).toBeNull();
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    expect(v.getSelectedPanels()).toEqual([]);
    expect(v.getStates()).toEqual(states);
    expect(v.getCameraLocationSettings()).toEqual(camera);
  });

  test("Alt+i после i дополняет скрытие, не возвращая остальные панели", () => {
    const v = start();
    v.setState(`${p1}/Edge`, [0, 0]);
    v.setLayerVisible("labels", false);
    const states = v.getStates();
    const layers = v.getLayers();
    const camera = v.getCameraLocationSettings();
    v.togglePanelSelection(p1);
    v.hideSelectedPanels();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    v.togglePanelSelection(p1);
    v.togglePanelIsolation();
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p1}/Edge`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    v.hideSelectedPanels();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    expect(v.getPanelFilter()).toEqual({ count: 2 });
    v.setState("/Model/Product/B", [0, 0]);
    press("Escape", "Escape");
    expect(v.getSelectedPanels()).toEqual([]);
    expect(visible(v, `${p1}/Body`)).toBe(false);
    const update = vi.spyOn(v, "update");
    v.hideSelectedPanels();
    expect(update).not.toHaveBeenCalled();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    v.togglePanelIsolation();
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p1}/Edge`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    expect(visible(v, `${p1}/Name/Text`)).toBe(false);
    expect(v.getState(`${p1}/Edge`)).toEqual(states[`${p1}/Edge`]);
    expect(v.getLayers()).toEqual(layers);
    expect(v.getCameraLocationSettings()).toEqual(camera);
  });

  test("скрытие накапливается и переживает обновления модели и дерева", async () => {
    const v = start();
    v.togglePanelSelection(p1);
    v.hideSelectedPanels();
    v.togglePanelSelection(p2);
    v.hideSelectedPanels();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    const states = v.getStates();
    v.clear();
    v.render(makeLayeredFurniture(), ctx.renderOptions, ctx.viewerOptions);
    v.treeview.setStates(states, true);
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    expect(v.getSelectedPanels()).toEqual([]);
    await v.applySceneDelta({ remove: [p2], add: [], update: [] });
    expect(v.getSelectedPanels()).toEqual([]);
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(v.getPanelFilter()).toEqual({ count: 1 });
    v.clearPanelFilter();
    expect(visible(v, `${p1}/Body`)).toBe(true);
  });

  test("i и последовательные Alt+i управляют одним накопительным списком", () => {
    const v = start(true);
    const states = v.getStates();
    v.togglePanelSelection(p1);
    v.togglePanelSelection(p2);
    v.togglePanelIsolation();
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    expect(visible(v, `${p3}/Body`)).toBe(false);
    v.togglePanelSelection(p2);
    v.hideSelectedPanels();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    expect(visible(v, `${p3}/Body`)).toBe(false);
    expect(v.getPanelFilter()).toEqual({ count: 2 });
    v.hideSelectedPanels();
    expect(v.getPanelFilter()).toEqual({ count: 2 });
    v.togglePanelSelection(p2);
    v.hideSelectedPanels();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    expect(visible(v, `${p3}/Body`)).toBe(false);
    expect(v.getPanelFilter()).toEqual({ count: 3 });
    v.togglePanelSelection(p2);
    v.togglePanelIsolation();
    expect(visible(v, `${p1}/Body`)).toBe(false);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    expect(visible(v, `${p3}/Body`)).toBe(false);
    v.togglePanelIsolation();
    expect(v.getPanelFilter()).toBeNull();
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    expect(visible(v, `${p3}/Body`)).toBe(true);
    expect(v.getStates()).toEqual(states);
  });

  test("включение панели или ветки в дереве снимает только её временное скрытие", () => {
    const v = start(true);
    const status = ctx.container.querySelector(".tcv_panel_filter_status");
    for (const id of [p1, p2, p3]) v.togglePanelSelection(id);
    v.hideSelectedPanels();
    v.setState(`${p1}/Name/Text`, [1, 1]);
    v.setState(bolt, [1, 1]);
    v.setState("/Model/Walls", [1, 1]);
    expect(v.getPanelFilter()).toEqual({ count: 3 });
    v.setState(p1, [0, 0]);
    expect(v.getPanelFilter()).toEqual({ count: 3 });
    v.setState(p1, [1, 1]);
    expect(status.textContent).toBe("Временно скрыто: 2");
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p1}/Edge`)).toBe(true);
    expect(visible(v, `${p1}/Name/Text`)).toBe(true);
    expect(visible(v, dowel)).toBe(true);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    expect(visible(v, `${p3}/Body`)).toBe(false);
    v.setLayerVisible("facades", false);
    v.setState("/Model/Product/B", [1, 1]);
    expect(v.getPanelFilter()).toEqual({ count: 1 });
    expect(visible(v, `${p2}/Body`)).toBe(false);
    v.setLayerVisible("facades", true);
    expect(visible(v, `${p2}/Body`)).toBe(true);
    v.setState("/Model/Product", [1, 1]);
    expect(v.getPanelFilter()).toBeNull();
    expect(visible(v, `${p3}/Body`)).toBe(true);
    expect(v.getSelectedPanels()).toEqual([]);
  });

  test("включение геометрии в развёрнутом дереве возвращает её панель", () => {
    const v = start();
    v.togglePanelSelection(p1);
    v.togglePanelSelection(p2);
    v.hideSelectedPanels();
    v.toggleGroup(true);
    const path = Object.entries(v.nestedGroup.groups).find(
      ([id, group]) => id.startsWith(`${p1}/Body/`) && group.isObjectGroup,
    )[0];
    v.setState(path, [1, 1]);
    expect(v.getPanelFilter()).toEqual({ count: 1 });
    expect(visible(v, path)).toBe(true);
    v.toggleGroup(false);
    expect(v.getPanelFilter()).toEqual({ count: 1 });
    expect(visible(v, `${p2}/Body`)).toBe(false);
  });

  test("новая панель не наследует временное скрытие ранее скрытых панелей", async () => {
    const v = start();
    v.togglePanelSelection(p1);
    v.togglePanelIsolation();
    const branch = makeLayeredFurniture({ thirdPanel: true }).parts[0].parts[2];
    await v.applySceneDelta({
      remove: [],
      add: [branch],
      update: [],
    });
    expect(visible(v, `${p1}/Body`)).toBe(true);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    expect(visible(v, `${p3}/Body`)).toBe(true);
    expect(v.getPanelFilter()).toEqual({ count: 1 });
  });

  test("Ctrl+click работает без инструмента, Ctrl+drag не выбирает", () => {
    const v = start();
    const canvas = v.renderer.domElement;
    const hit = { object: v.nestedGroup.groups[`${p1}/Body`].front };
    vi.spyOn(Raycaster.prototype, "getIntersectedObjs").mockReturnValue([hit]);
    const pointer = (type, extra = {}) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          button: 0,
          ctrlKey: true,
          clientX: 10,
          clientY: 10,
          ...extra,
        }),
      );
    pointer("pointerdown");
    pointer("pointerup");
    expect(v.getSelectedPanels()).toEqual([p1]);
    pointer("pointerdown");
    pointer("pointermove", { clientY: 20 });
    pointer("pointerup");
    expect(v.getSelectedPanels()).toEqual([p1]);
    pointer("pointerdown");
    pointer("pointercancel");
    pointer("pointerup");
    expect(v.getSelectedPanels()).toEqual([p1]);
    pointer("pointerdown", { ctrlKey: false });
    pointer("pointerup", { ctrlKey: false });
    expect(v.getSelectedPanels()).toEqual([p1]);
    const measure = vi.fn();
    const caster = new Raycaster(
      v.rendered.camera,
      canvas,
      800,
      600,
      1,
      v.nestedGroup.rootGroup,
      measure,
    );
    caster.init();
    canvas.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, ctrlKey: true }),
    );
    canvas.dispatchEvent(
      new MouseEvent("mouseup", { button: 0, ctrlKey: true }),
    );
    expect(measure).not.toHaveBeenCalled();
    caster.dispose();
  });

  test("обновления и смена представления сохраняют только существующие id", async () => {
    const v = start();
    v.togglePanelSelection(p1);
    v.togglePanelIsolation();
    const body = v.nestedGroup.groups[`${p1}/Body`];
    await v.applySceneDelta({
      remove: [],
      add: [],
      update: [{ id: p1, name: "Другое имя", parts: [], selection_root: true }],
    });
    expect(v.nestedGroup.groups[`${p1}/Body`]).toBe(body);
    expect(body.isGroupSelected).toBe(true);
    v.clear();
    v.render(makeLayeredFurniture(), ctx.renderOptions, ctx.viewerOptions);
    expect(v.getSelectedPanels()).toEqual([p1]);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    v.setTransparent(true);
    v.toggleGroup(true);
    v.update(true, false);
    const groups = Object.entries(v.nestedGroup.groups).filter(
      ([path, group]) => path.startsWith(`${p1}/Body/`) && group.isObjectGroup,
    );
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every(([, group]) => group.isGroupSelected)).toBe(true);
    v.toggleGroup(false);
    await v.applySceneDelta({ remove: [p1], add: [], update: [] });
    expect(v.getSelectedPanels()).toEqual([]);
    expect(visible(v, `${p2}/Body`)).toBe(false);
    v.clearPanelFilter();
    expect(visible(v, `${p2}/Body`)).toBe(true);
    v.togglePanelSelection(p2);
    await v.applySceneDelta({
      remove: [],
      add: [],
      update: [{ id: p2, name: "P2", parts: [], layer: "facades" }],
    });
    expect(v.getSelectedPanels()).toEqual([]);
  });
});
