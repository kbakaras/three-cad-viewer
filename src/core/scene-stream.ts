import type { Shape, Shapes } from "./types.js";
import type { Viewer } from "./viewer.js";
import {
  decodeInstance,
  decodeInlineBuffers,
} from "../utils/decode-instances.js";
import type { EncodedInstance } from "../utils/decode-instances.js";

interface SceneMessage {
  type: "scene_full" | "scene_delta";
  revision: number;
  base_revision?: number;
  tree?: Shapes;
  meshes: Record<string, EncodedInstance>;
  mesh_ids?: string[];
  remove?: string[];
  add?: Shapes[];
  update?: Shapes[];
  config: Record<string, unknown>;
  bb?: Shapes["bb"];
}

/** A revision belongs to one viewer connection; meshes are decoded once. */
export class SceneStream {
  revision: number | null = null;
  private meshes = new Map<string, Shape>();

  reset(): void {
    this.revision = null;
    this.meshes.clear();
  }

  private hydrate(node: Shapes): Shapes {
    const ref = node.shape as unknown as { mesh?: string } | undefined;
    if (ref?.mesh) {
      const mesh = this.meshes.get(ref.mesh);
      if (!mesh) throw new Error(`Missing mesh: ${ref.mesh}`);
      node.shape = mesh;
    }
    node.parts?.forEach((child) => this.hydrate(child));
    decodeInlineBuffers({ ...node, parts: [node] });
    return node;
  }

  async apply(
    message: SceneMessage,
    viewer: Viewer | null,
    full: (tree: Shapes, config: Record<string, unknown>) => void,
    resync: () => void,
  ): Promise<boolean> {
    if (
      message.type === "scene_delta" &&
      (message.base_revision !== this.revision || !viewer)
    ) {
      resync();
      return false;
    }
    if (message.type === "scene_full") this.reset();
    for (const [id, mesh] of Object.entries(message.meshes)) {
      if (!this.meshes.has(id)) this.meshes.set(id, decodeInstance(mesh));
    }
    try {
      if (message.type === "scene_full") {
        full(this.hydrate(message.tree!), message.config);
      } else {
        if (viewer!.shapes && message.bb) viewer!.shapes.bb = message.bb;
        await viewer!.applySceneDelta({
          remove: message.remove ?? [],
          add: (message.add ?? []).map((node) => this.hydrate(node)),
          update: (message.update ?? []).map((node) => this.hydrate(node)),
        });
      }
      if (message.mesh_ids) {
        const active = new Set(message.mesh_ids);
        for (const id of this.meshes.keys())
          if (!active.has(id)) this.meshes.delete(id);
      }
      this.revision = message.revision;
      return true;
    } catch (error) {
      this.revision = null;
      if (message.type === "scene_delta") resync();
      throw error;
    }
  }
}
