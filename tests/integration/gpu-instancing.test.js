import { describe, test, expect, vi } from "vitest";
import * as THREE from "three";
import { setupViewer, cleanup } from "../helpers/setup.js";
import { makeFurniture } from "../fixtures/furniture.js";
import { CadInstancing } from "../../src/rendering/cad-instancing.js";

function setup(options = {}) {
  const ctx = setupViewer({}, options, {
    axes: false,
    axes0: false,
    grid: [false, false, false],
  });
  ctx.viewer.render(
    makeFurniture(30, { encoded: true }),
    ctx.renderOptions,
    ctx.viewerOptions,
  );
  return ctx;
}

describe("GPU instancing", () => {
  test("unencoded shared objects batch, independently copied geometry does not", () => {
    const ctx = setupViewer();
    try {
      ctx.viewer.render(
        makeFurniture(12),
        ctx.renderOptions,
        ctx.viewerOptions,
      );
      expect(ctx.viewer.getInstancingStats().instancedObjects).toBe(12);
      ctx.viewer.clear();
      const model = makeFurniture(12);
      for (const part of model.parts[0].parts)
        part.shape = structuredClone(part.shape);
      ctx.viewer.render(model, ctx.renderOptions, ctx.viewerOptions);
      expect(ctx.viewer.getInstancingStats()).toMatchObject({
        reason: "no-compatible-repeats",
        instancedObjects: 0,
      });
    } finally {
      cleanup(ctx);
    }
  });

  test("disabling batches preserves source resources and clear disposes marker scenes", () => {
    const ctx = setup();
    try {
      const v = ctx.viewer;
      const group = v.nestedGroup.groups["/Furniture/Hardware/Fastener0"];
      const disposeSource = vi.fn();
      group.front.geometry.addEventListener("dispose", disposeSource);
      v.setGpuInstancing(false);
      v.setGpuInstancing(true);
      expect(disposeSource).not.toHaveBeenCalled();
      const pivotDispose = vi.fn();
      v._pivotMarkerDepth.geometry.addEventListener("dispose", pivotDispose);
      const orientationDispose = vi.spyOn(v.orientationMarker, "dispose");
      v.clear();
      expect(pivotDispose).toHaveBeenCalled();
      expect(orientationDispose).toHaveBeenCalledTimes(1);
      expect(v.getInstancingStats().faceBatches).toBe(0);
    } finally {
      cleanup(ctx);
    }
  });

  test("encoded refs create batches, rotation does not rebuild, proxies stay intact", () => {
    const ctx = setup();
    try {
      const viewer = ctx.viewer;
      expect(viewer.getInstancingStats()).toMatchObject({
        reason: null,
        instancedObjects: 30,
        faceBatches: 6,
        edgeBatches: 3,
      });
      const before = viewer.getInstancingStats().rebuilds;
      viewer.update(true, false);
      viewer.camera.getCamera().position.x += 10;
      viewer.update(true, false);
      expect(viewer.getInstancingStats().rebuilds).toBe(before);
      expect(
        viewer.nestedGroup.groups["/Furniture/Hardware/Fastener0"].front
          .visible,
      ).toBe(true);
      expect(viewer.scene.children.some((o) => o.isInstancedMesh)).toBe(false);
    } finally {
      cleanup(ctx);
    }
  });

  test("visibility, material changes and removal update batches", () => {
    const ctx = setup();
    try {
      const v = ctx.viewer;
      const path = "/Furniture/Hardware/Fastener0";
      v.setObject(path, 0, 0);
      v.setObject(path, 0, 1);
      expect(v.getInstancingStats().instancedObjects).toBe(29);
      v.setObject(path, 1, 0);
      v.setObject(path, 1, 1);
      expect(v.getInstancingStats().instancedObjects).toBe(30);
      const group = v.nestedGroup.groups[path];
      group.front.material.color.set("#00ff00");
      v.update(true, false);
      v.removePart(path);
      expect(v.getInstancingStats().instancedObjects).toBe(29);
    } finally {
      cleanup(ctx);
    }
  });

  test("editing one shared shape leaves the other copies unchanged", () => {
    const ctx = setup();
    try {
      const v = ctx.viewer;
      const group = v.nestedGroup.groups["/Furniture/Hardware/Fastener0"];
      const other = v.nestedGroup.groups["/Furniture/Hardware/Fastener6"];
      const before = Array.from(other.front.geometry.attributes.position.array);
      const shape = structuredClone(v.shapes.parts[0].parts[0].shape);
      shape.vertices[0] += 2;
      shape.edges[0] += 2;
      const edgeBefore = other.edges.geometry.attributes.instanceStart.getX(0);
      v.updatePart("/Furniture/Hardware/Fastener0", { shape });
      expect(
        Array.from(other.front.geometry.attributes.position.array),
      ).toEqual(before);
      expect(other.edges.geometry.attributes.instanceStart.getX(0)).toBe(
        edgeBefore,
      );
      expect(group.front.geometry.attributes.position.getX(0)).toBe(
        shape.vertices[0],
      );
      expect(v.getInstancingStats().instancedObjects).toBe(29);
    } finally {
      cleanup(ctx);
    }
  });

  test("clipping and transparency fall back and return without stale state", () => {
    const ctx = setup();
    try {
      const v = ctx.viewer;
      const group = v.nestedGroup.groups["/Furniture/Hardware/Fastener0"];
      expect([...group.clipping.values()].every((g) => !g.visible)).toBe(true);
      v.setLocalClipping(true);
      expect(v.getInstancingStats().reason).toBe("clipping");
      expect([...group.clipping.values()].every((g) => g.visible)).toBe(true);
      v.setLocalClipping(false);
      expect(v.getInstancingStats().reason).toBe(null);
      v.setTransparent(true);
      expect(v.getInstancingStats().reason).toBe("transparent");
      v.setTransparent(false);
      expect(v.getInstancingStats().reason).toBe(null);
      v.setGpuInstancing(false);
      expect(v.getInstancingStats().reason).toBe("disabled");
      v.setGpuInstancing(true);
      expect(v.getInstancingStats().instancedObjects).toBe(30);
    } finally {
      cleanup(ctx);
    }
  });

  test("render exceptions restore all original visibility and remove batches", () => {
    const ctx = setup();
    const manager = new CadInstancing();
    try {
      const v = ctx.viewer;
      const groups = Object.values(v.nestedGroup.groups).filter(
        (g) => g.isObjectGroup,
      );
      manager.sync(v.nestedGroup.rootGroup, groups);
      expect(() =>
        manager.render(v.scene, () => {
          throw new Error("draw failed");
        }),
      ).toThrow("draw failed");
      expect(groups.every((g) => g.front.visible)).toBe(true);
      expect(
        v.scene.children.some((o) => o instanceof THREE.InstancedMesh),
      ).toBe(false);
      manager.dispose();
      manager.dispose();
      expect(manager.getStats().faceBatches).toBe(0);
    } finally {
      manager.dispose();
      cleanup(ctx);
    }
  });

  test("nested transforms reach faces and edges; unsupported scales are not batched", () => {
    const ctx = setup();
    const manager = new CadInstancing();
    try {
      const v = ctx.viewer;
      const groups = Object.values(v.nestedGroup.groups).filter(
        (g) => g.isObjectGroup,
      );
      manager.sync(v.nestedGroup.rootGroup, groups);
      const first = v.nestedGroup.groups["/Furniture/Hardware/Fastener0"];
      const expected = new THREE.Vector3()
        .fromBufferAttribute(first.edges.geometry.attributes.instanceStart, 0)
        .applyMatrix4(first.edges.matrixWorld);
      let disposal;
      manager.render(v.scene, () => {
        const meshes = v.scene.children.filter((o) => o.isInstancedMesh);
        const matrix = new THREE.Matrix4();
        meshes[0].getMatrixAt(0, matrix);
        matrix.elements.forEach((value, i) =>
          expect(value).toBeCloseTo(first.front.matrixWorld.elements[i], 5),
        );
        const edges = v.scene.children.find(
          (o) => o.isLineSegments2 && o.name === "__cad_instance_batch",
        );
        const actual = new THREE.Vector3().fromBufferAttribute(
          edges.geometry.attributes.instanceStart,
          0,
        );
        expect(actual.distanceTo(expected)).toBeLessThan(1e-4);
        disposal = vi.fn();
        meshes[0].geometry.addEventListener("dispose", disposal);
      });
      first.scale.set(-1, 1, 1);
      manager.sync(v.nestedGroup.rootGroup, groups);
      expect(manager.getStats().instancedObjects).toBe(29);
      expect(disposal).toHaveBeenCalledTimes(1);
      first.scale.set(1, 2, 1);
      manager.sync(v.nestedGroup.rootGroup, groups);
      expect(manager.getStats().instancedObjects).toBe(29);
      first.scale.set(1, 1, 1);
      manager.sync(v.nestedGroup.rootGroup, groups);
      expect(manager.getStats().instancedObjects).toBe(30);
    } finally {
      manager.dispose();
      cleanup(ctx);
    }
  });

  test("tools, expanded geometry, zebra and animation use the original scene", () => {
    const ctx = setup();
    try {
      const v = ctx.viewer;
      for (const tool of ["select", "distance", "properties", "angle"]) {
        v.activateTool(tool, true);
        v.update(true, false);
        expect(v.getInstancingStats().reason).toBe("tool");
        v.activateTool(tool, false);
        v.update(true, false);
        expect(v.getInstancingStats().reason).toBe(null);
      }
      v.setActiveTab("zebra");
      v.update(true, false);
      expect(v.getInstancingStats().reason).toBe("zebra");
      v.setActiveTab("tree");
      v.setExplode(true);
      v.update(true, false);
      expect(["expanded", "animation"]).toContain(
        v.getInstancingStats().reason,
      );
      v.setExplode(false);
      v.update(true, false);
      expect(v.getInstancingStats().reason).toBe(null);
    } finally {
      cleanup(ctx);
    }
  });

  test("wireframe, back faces and material changes invalidate their own batches", () => {
    const ctx = setup();
    try {
      const v = ctx.viewer;
      const group = v.nestedGroup.groups["/Furniture/Hardware/Fastener0"];
      group.front.material.wireframe = true;
      group.back.material.visible = true;
      v.update(true, false);
      const manager = new CadInstancing();
      const groups = Object.values(v.nestedGroup.groups).filter(
        (g) => g.isObjectGroup,
      );
      manager.sync(v.nestedGroup.rootGroup, groups);
      manager.render(v.scene, () => expect(group.front.visible).toBe(true));
      group.front.material.wireframe = false;
      group.front.material.map = new THREE.Texture();
      manager.sync(v.nestedGroup.rootGroup, groups);
      manager.render(v.scene, () => expect(group.front.visible).toBe(true));
      group.front.material.map.dispose();
      group.front.material.map = null;
      manager.dispose();
    } finally {
      cleanup(ctx);
    }
  });
});
