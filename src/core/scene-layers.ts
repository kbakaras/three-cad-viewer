import type { Shapes } from "./types.js";
import type { ObjectGroup } from "../scene/objectgroup.js";

interface Leaf {
  layers: string[];
  dependencies: string[][];
  ancestors: string[];
}

/** Независимый от дерева фильтр слоёв и связей видимости. */
export class SceneLayers {
  private choices = new Map<string, boolean>();
  private names: Record<string, string> = {};
  private leaves = new Map<string, Leaf>();

  setScene(tree: Shapes | null): void {
    this.names = tree?.layers ?? {};
    this.leaves.clear();
    const walk = (node: Shapes, parent: Leaf): void => {
      const current = {
        layers: node.layer ? [...parent.layers, node.layer] : parent.layers,
        dependencies:
          node.visible_if_any !== undefined
            ? [...parent.dependencies, node.visible_if_any]
            : parent.dependencies,
        ancestors: [...parent.ancestors, node.id],
      };
      if (node.parts) node.parts.forEach((child) => walk(child, current));
      else this.leaves.set(node.id, current);
    };
    if (tree) walk(tree, { layers: [], dependencies: [], ancestors: [] });
  }

  getLayers(): Record<string, { name: string; visible: boolean }> {
    return Object.fromEntries(
      Object.entries(this.names).map(([id, name]) => [
        id,
        { name, visible: this.choices.get(id) ?? true },
      ]),
    );
  }

  setVisible(id: string, visible: boolean): void {
    if (!Object.prototype.hasOwnProperty.call(this.names, id))
      throw new Error(`Unknown layer: ${id}`);
    this.choices.set(id, visible);
  }

  apply(groups: Record<string, unknown>): void {
    if (!this.leaves.size) return;
    const entries: [ObjectGroup, Leaf][] = [];
    const subjects = new Set<string>();
    const enabled = (leaf: Leaf): boolean =>
      leaf.layers.every((id) => this.choices.get(id) !== false);

    for (const [path, value] of Object.entries(groups)) {
      const group = value as ObjectGroup;
      if (!group.isObjectGroup) continue;
      let id = path;
      // Развёрнутые грани и рёбра наследуют метаданные исходного тела.
      while (id && !this.leaves.has(id)) id = id.slice(0, id.lastIndexOf("/"));
      const leaf = this.leaves.get(id);
      if (!leaf) continue;
      entries.push([group, leaf]);
      if (
        !leaf.dependencies.length &&
        enabled(leaf) &&
        group.getVisibility(true)
      ) {
        leaf.ancestors.forEach((ancestor) => subjects.add(ancestor));
      }
    }
    for (const [group, leaf] of entries) {
      group.visible =
        enabled(leaf) &&
        leaf.dependencies.every((refs) =>
          refs.some((ref) => subjects.has(ref)),
        );
    }
  }
}
