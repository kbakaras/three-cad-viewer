import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegmentsGeometry } from "../core/patches.js";
import type { ObjectGroup } from "../scene/objectgroup.js";
import { gpuTracker } from "../utils/gpu-tracker.js";

// Kept outside ObjectGroup so serialization and the public shape format stay unchanged.
export const instanceSources = new WeakMap<ObjectGroup, object>();

export interface InstancingStats {
  reason: string | null;
  eligibleInstances: number;
  instancedObjects: number;
  faceBatches: number;
  edgeBatches: number;
  rebuilds: number;
}

type RenderObject = THREE.Mesh | LineSegments2;
interface Member {
  object: RenderObject;
  matrix: THREE.Matrix4;
  version: string;
}
interface Batch {
  members: Member[];
  object: RenderObject;
}

function visible(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function rigid(matrix: THREE.Matrix4): boolean {
  const e = matrix.elements;
  const dot = (a: number, b: number): number =>
    e[a]! * e[b]! + e[a + 1]! * e[b + 1]! + e[a + 2]! * e[b + 2]!;
  return (
    Math.abs(matrix.determinant() - 1) < 1e-5 &&
    Math.abs(dot(0, 0) - 1) < 1e-5 &&
    Math.abs(dot(4, 4) - 1) < 1e-5 &&
    Math.abs(dot(8, 8) - 1) < 1e-5 &&
    Math.abs(dot(0, 4)) + Math.abs(dot(4, 8)) + Math.abs(dot(8, 0)) < 1e-5
  );
}

const textureSlots = [
  "map",
  "lightMap",
  "aoMap",
  "emissiveMap",
  "bumpMap",
  "normalMap",
  "displacementMap",
  "roughnessMap",
  "metalnessMap",
  "specularMap",
  "alphaMap",
  "envMap",
] as const;

function materialKey(material: THREE.Material | LineMaterial): string | null {
  if (
    !(
      material instanceof THREE.MeshStandardMaterial ||
      material instanceof THREE.MeshBasicMaterial ||
      material instanceof LineMaterial
    )
  )
    return null;
  if (
    material.opacity !== 1 ||
    !material.depthWrite ||
    !material.depthTest ||
    material.vertexColors ||
    material.alphaTest !== 0 ||
    material.stencilWrite ||
    material.blending !== THREE.NormalBlending ||
    material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile
  )
    return null;
  // Only the built-in untextured CAD materials are supported in this path.
  for (const name of textureSlots) {
    if ((material as unknown as Record<string, unknown>)[name] != null)
      return null;
  }
  const line = material instanceof LineMaterial ? material : null;
  if (line && (line.dashed || line.worldUnits)) return null;
  const standard =
    material instanceof THREE.MeshStandardMaterial ? material : null;
  return [
    material.type,
    material.color.r,
    material.color.g,
    material.color.b,
    material.side,
    material.transparent,
    material.depthFunc,
    material.polygonOffset,
    material.polygonOffsetFactor,
    material.polygonOffsetUnits,
    material.toneMapped,
    material.fog,
    material.premultipliedAlpha,
    material.dithering,
    material.colorWrite,
    standard?.metalness,
    standard?.roughness,
    standard?.emissive.r,
    standard?.emissive.g,
    standard?.emissive.b,
    standard?.emissiveIntensity,
    standard?.flatShading,
    "wireframe" in material ? material.wireframe : false,
    line?.linewidth,
    line?.alphaToCoverage,
  ].join(",");
}

function geometryVersion(geometry: THREE.BufferGeometry): string {
  return [
    geometry.uuid,
    geometry.index?.version,
    ...Object.values(geometry.attributes).map((a) =>
      "data" in a ? a.data.version : a.version,
    ),
    geometry.drawRange.start,
    geometry.drawRange.count,
  ].join(":");
}

/** A render-only cache; the original scene remains authoritative for all CAD tools. */
export class CadInstancing {
  private batches = new Map<string, Batch>();
  private sources = new WeakMap<object, number>();
  private nextSource = 0;
  private stats: InstancingStats = {
    reason: "not-rendered",
    eligibleInstances: 0,
    instancedObjects: 0,
    faceBatches: 0,
    edgeBatches: 0,
    rebuilds: 0,
  };

  getStats(): InstancingStats {
    return { ...this.stats };
  }

  suspend(reason: string): void {
    this.stats.reason = reason;
    this.stats.instancedObjects = 0;
    this.stats.faceBatches = 0;
    this.stats.edgeBatches = 0;
  }

  private destroy(batch: Batch): void {
    batch.object.removeFromParent();
    gpuTracker.untrack("geometry", batch.object.geometry);
    batch.object.geometry.dispose();
    const material = batch.object.material;
    if (!Array.isArray(material)) {
      gpuTracker.untrack("material", material);
      material.dispose();
    }
    if (batch.object instanceof THREE.InstancedMesh) batch.object.dispose();
  }

  dispose(): void {
    for (const batch of this.batches.values()) this.destroy(batch);
    this.batches.clear();
    this.sources = new WeakMap();
    this.nextSource = 0;
    this.stats = {
      reason: "not-rendered",
      eligibleInstances: 0,
      instancedObjects: 0,
      faceBatches: 0,
      edgeBatches: 0,
      rebuilds: 0,
    };
  }

  private create(members: Member[]): Batch {
    const first = members[0]!.object;
    const material = gpuTracker.trackMaterial(
      (first.material as THREE.Material).clone(),
      "CAD instance material",
    );
    let object: RenderObject;
    if (first instanceof LineSegments2) {
      const segments = members.reduce(
        (sum, m) => sum + m.object.geometry.getAttribute("instanceStart").count,
        0,
      );
      const positions = new Float32Array(segments * 6);
      const point = new THREE.Vector3();
      let offset = 0;
      for (const member of members) {
        const start = member.object.geometry.getAttribute("instanceStart");
        const end = member.object.geometry.getAttribute("instanceEnd");
        for (let i = 0; i < start.count; i++) {
          point
            .fromBufferAttribute(start, i)
            .applyMatrix4(member.matrix)
            .toArray(positions, offset);
          point
            .fromBufferAttribute(end, i)
            .applyMatrix4(member.matrix)
            .toArray(positions, offset + 3);
          offset += 6;
        }
      }
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(positions);
      object = new LineSegments2(geometry, material as LineMaterial);
    } else {
      const mesh = new THREE.InstancedMesh(
        first.geometry.clone(),
        material,
        members.length,
      );
      members.forEach((member, i) => mesh.setMatrixAt(i, member.matrix));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      object = mesh;
    }
    object.name = "__cad_instance_batch";
    gpuTracker.trackGeometry(object.geometry, "CAD instance geometry");
    object.renderOrder = first.renderOrder;
    object.layers.mask = first.layers.mask;
    this.stats.rebuilds++;
    return { object, members };
  }

  /** Synchronize only changed batches. Camera movement does not change the cache. */
  sync(root: THREE.Object3D, groups: Iterable<ObjectGroup>): void {
    root.updateWorldMatrix(true, true);
    const candidates = new Map<string, Member[]>();
    let eligible = 0;
    for (const group of groups) {
      const source = instanceSources.get(group);
      if (!source || group.subtype !== "solid" || !visible(group)) continue;
      let sourceId = this.sources.get(source);
      if (sourceId === undefined) {
        sourceId = this.nextSource++;
        this.sources.set(source, sourceId);
      }
      let accepted = false;
      for (const object of [group.front, group.back, group.edges]) {
        if (
          !object ||
          !(object instanceof THREE.Mesh) ||
          !object.visible ||
          Array.isArray(object.material) ||
          !object.material.visible ||
          !rigid(object.matrixWorld)
        )
          continue;
        const key = materialKey(object.material);
        if (
          key === null ||
          object.geometry.groups.length > 0 ||
          object.geometry.drawRange.start !== 0 ||
          object.geometry.drawRange.count !== Infinity
        )
          continue;
        const kind =
          object === group.front
            ? "front"
            : object === group.back
              ? "back"
              : "edges";
        const batchKey = `${sourceId}:${kind}:${object.renderOrder}:${object.layers.mask}:${key}`;
        const members = candidates.get(batchKey) ?? [];
        members.push({
          object,
          matrix: object.matrixWorld.clone(),
          version: geometryVersion(object.geometry),
        });
        candidates.set(batchKey, members);
        accepted = true;
      }
      if (accepted) eligible++;
    }
    this.stats.reason = null;
    this.stats.eligibleInstances = eligible;
    this.stats.faceBatches = 0;
    this.stats.edgeBatches = 0;
    const instanced = new Set<THREE.Object3D>();
    for (const [key, members] of candidates) {
      if (members.length < 2) {
        candidates.delete(key);
        continue;
      }
      let batch = this.batches.get(key);
      const unchanged =
        batch &&
        batch.members.length === members.length &&
        members.every((m, i) => {
          const old = batch!.members[i]!;
          return (
            m.object === old.object &&
            m.version === old.version &&
            m.matrix.equals(old.matrix)
          );
        });
      if (!unchanged) {
        if (batch) this.destroy(batch);
        batch = this.create(members);
        this.batches.set(key, batch);
      }
      if (batch!.object instanceof LineSegments2) {
        const original = members[0]!.object.material as LineMaterial;
        batch!.object.material.resolution.copy(original.resolution);
        this.stats.edgeBatches++;
      } else this.stats.faceBatches++;
      for (const member of members)
        if (member.object.parent) instanced.add(member.object.parent);
    }
    for (const [key, batch] of this.batches) {
      if (!candidates.has(key)) {
        this.destroy(batch);
        this.batches.delete(key);
      }
    }
    this.stats.instancedObjects = instanced.size;
    if (this.batches.size === 0) this.stats.reason = "no-compatible-repeats";
  }

  render(scene: THREE.Scene, draw: () => void): void {
    const hidden: THREE.Object3D[] = [];
    try {
      for (const batch of this.batches.values()) {
        scene.add(batch.object);
        for (const member of batch.members) {
          if (member.object.visible) {
            hidden.push(member.object);
            member.object.visible = false;
          }
        }
      }
      draw();
    } finally {
      for (const object of hidden) object.visible = true;
      for (const batch of this.batches.values())
        batch.object.removeFromParent();
    }
  }
}
