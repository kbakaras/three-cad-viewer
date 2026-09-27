import { afterEach, describe, expect, test, vi } from "vitest";
import { setupViewer, cleanup } from "../helpers/setup.js";
import { makeFurniture } from "../fixtures/furniture.js";
import { SceneStream } from "../../src/core/scene-stream.js";

function full(revision = 1) {
  const model = makeFurniture(12, { encoded: true });
  const meshes = Object.fromEntries(
    model.instances.map((mesh, i) => [String(i), mesh]),
  );
  const walk = (node) => {
    if (node.shape?.ref != null) node.shape = { mesh: String(node.shape.ref) };
    node.parts?.forEach(walk);
  };
  walk(model.shapes);
  const leaf = model.shapes.parts[0].parts[0];
  leaf.id = "/Furniture/Hardware/stable-id";
  leaf.name = "Bolt 1";
  return {
    type: "scene_full",
    revision,
    meshes,
    tree: model.shapes,
    config: {},
  };
}

describe("Exact scene stream", () => {
  let ctx;
  afterEach(() => {
    if (ctx) cleanup(ctx);
    ctx = null;
  });

  async function start() {
    ctx = setupViewer();
    const stream = new SceneStream();
    const data = full();
    await stream.apply(
      data,
      ctx.viewer,
      (tree) => ctx.viewer.render(tree, ctx.renderOptions, ctx.viewerOptions),
      vi.fn(),
    );
    return { stream, data, viewer: ctx.viewer };
  }

  test("stable ids have readable labels; rename and move preserve buffers, camera and visibility", async () => {
    const { stream, data, viewer: v } = await start();
    const id = "/Furniture/Hardware/stable-id";
    const group = v.nestedGroup.groups[id];
    const geometry = group.front.geometry;
    const target = v.controls.getTarget().clone();
    expect(v.treeview.findNodeByPath(id).name).toBe("Bolt 1");
    v.setState(id, [0, 0]);
    const update = {
      ...data.tree.parts[0].parts[0],
      name: "Bolt 2",
      loc: [
        [100, 0, 0],
        [0, 0, 0, 1],
      ],
      color: "#ff0000",
    };
    const delta = {
      type: "scene_delta",
      revision: 2,
      base_revision: 1,
      meshes: {},
      remove: [],
      add: [],
      update: [update],
      config: {},
    };
    await stream.apply(delta, v, vi.fn(), vi.fn());
    expect(v.nestedGroup.groups[id]).toBe(group);
    expect(group.front.geometry).toBe(geometry);
    expect(group.position.x).toBe(100);
    expect(group.front.material.color.getHexString()).toBe("ff0000");
    expect(v.treeview.findNodeByPath(id).name).toBe("Bolt 2");
    expect(v.getStates()[id]).toEqual([0, 0]);
    expect(v.controls.getTarget().distanceTo(target)).toBe(0);
  });

  test("unchanged scene is a no-op and mismatch requests a full snapshot", async () => {
    const { stream, viewer } = await start();
    const bounds = vi.spyOn(viewer, "updateBounds");
    const resync = vi.fn();
    const delta = {
      type: "scene_delta",
      revision: 2,
      base_revision: 1,
      meshes: {},
      remove: [],
      add: [],
      update: [],
      config: {},
    };
    expect(await stream.apply(delta, viewer, vi.fn(), resync)).toBe(true);
    expect(bounds).not.toHaveBeenCalled();
    expect(
      await stream.apply(
        { ...delta, base_revision: 0 },
        viewer,
        vi.fn(),
        resync,
      ),
    ).toBe(false);
    expect(resync).toHaveBeenCalledOnce();
  });

  test("material definitions are refreshed and can be removed", async () => {
    const { stream, data, viewer: v } = await start();
    v.nestedGroup.resolvedMaterials.set("custom", { color: "#ff0000" });
    const root = {
      ...data.tree,
      parts: [],
      materials: { custom: "builtin:chrome" },
    };
    await stream.apply(
      {
        type: "scene_delta",
        revision: 2,
        base_revision: 1,
        meshes: {},
        remove: [],
        add: [],
        update: [root],
        config: {},
      },
      v,
      vi.fn(),
      vi.fn(),
    );
    expect(v.nestedGroup.materialsTable).toEqual(root.materials);
    expect(v.nestedGroup.resolvedMaterials.size).toBe(0);
    delete root.materials;
    await stream.apply(
      {
        type: "scene_delta",
        revision: 3,
        base_revision: 2,
        meshes: {},
        remove: [],
        add: [],
        update: [root],
        config: {},
      },
      v,
      vi.fn(),
      vi.fn(),
    );
    expect(v.nestedGroup.materialsTable).toBeNull();
    expect(v.shapes.materials).toBeUndefined();
  });

  test("new leaves in a hidden group stay hidden; explicit state changes still apply", async () => {
    const { stream, data, viewer: v } = await start();
    v.setState("/Furniture/Hardware", [0, 0]);
    const leaf = {
      ...data.tree.parts[0].parts[1],
      id: "/Furniture/Hardware/new-id",
      name: "New bolt",
    };
    await stream.apply(
      {
        type: "scene_delta",
        revision: 2,
        base_revision: 1,
        meshes: {},
        remove: [],
        add: [leaf],
        update: [],
        config: {},
      },
      v,
      vi.fn(),
      vi.fn(),
    );
    expect(v.getStates()[leaf.id]).toEqual([0, 0]);
    await stream.apply(
      {
        type: "scene_delta",
        revision: 3,
        base_revision: 2,
        meshes: {},
        remove: [],
        add: [],
        update: [{ ...leaf, state: [0, 0] }],
        config: {},
      },
      v,
      vi.fn(),
      vi.fn(),
    );
    v.setState(leaf.id, [0, 0]);
    await stream.apply(
      {
        type: "scene_delta",
        revision: 4,
        base_revision: 3,
        meshes: {},
        remove: [],
        add: [],
        update: [{ ...leaf, state: [1, 1] }],
        config: {},
      },
      v,
      vi.fn(),
      vi.fn(),
    );
    expect(v.getStates()[leaf.id]).toEqual([1, 1]);
  });

  test("add/remove groups by id and replace one shared leaf without changing siblings", async () => {
    const { stream, data, viewer: v } = await start();
    const original = v.nestedGroup.groups["/Furniture/Hardware/Fastener6"];
    const buffer = Array.from(
      original.front.geometry.attributes.position.array,
    );
    const changed = structuredClone(data.tree.parts[0].parts[0]);
    changed.shape.vertices[0] += 10;
    const group = {
      id: "/Furniture/new-id",
      name: "New group",
      parts: [],
      loc: null,
    };
    const leaf = {
      ...data.tree.parts[0].parts[1],
      id: "/Furniture/new-id/child",
      name: "Child",
    };
    await stream.apply(
      {
        type: "scene_delta",
        revision: 2,
        base_revision: 1,
        meshes: {},
        remove: [],
        add: [group, leaf],
        update: [changed],
        config: {},
      },
      v,
      vi.fn(),
      vi.fn(),
    );
    expect(v.nestedGroup.groups["/Furniture/Hardware/Fastener6"]).toBe(
      original,
    );
    expect(
      Array.from(original.front.geometry.attributes.position.array),
    ).toEqual(buffer);
    expect(v.treeview.findNodeByPath(group.id).name).toBe("New group");
    await stream.apply(
      {
        type: "scene_delta",
        revision: 3,
        base_revision: 2,
        meshes: {},
        remove: [group.id],
        add: [],
        update: [],
        config: {},
      },
      v,
      vi.fn(),
      vi.fn(),
    );
    expect(v.nestedGroup.groups[leaf.id]).toBeUndefined();
    expect(v.shapes.parts.some((p) => p.id === group.id)).toBe(false);
  });
});
