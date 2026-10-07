import type { Shapes, VisibilityState } from "./types.js";
import type { ObjectGroup } from "../scene/objectgroup.js";

export interface PanelFilterState {
  readonly count: number;
}

interface Leaf {
  layers: string[];
  dependencies: string[][];
  ancestors: string[];
  owners: string[];
  selectionRoot: string | null;
}

/** Независимый от дерева фильтр слоёв и связей видимости. */
export class SceneLayers {
  private choices = new Map<string, boolean>();
  private names: Record<string, string> = {};
  private defaults: Record<string, boolean> = {};
  private leaves = new Map<string, Leaf>();
  private owners = new Set<string>();
  private terminals = new Set<string>();
  private ownerStates = new Map<string, VisibilityState>();
  private terminalStates = new Map<string, VisibilityState>();
  private branches = new Set<string>();
  private selectionRoots = new Set<string>();
  private hiddenPanels = new Set<string>();
  private branchCommands = new Map<
    string,
    { path: string; icon: 0 | 1; visible: boolean }
  >();

  setScene(tree: Shapes | null): void {
    this.names = tree?.layers ?? {};
    this.defaults = tree?.layer_defaults ?? {};
    this.leaves.clear();
    this.owners.clear();
    this.terminals.clear();
    this.branches.clear();
    this.selectionRoots.clear();
    const walk = (node: Shapes, parent: Leaf): void => {
      if (node.visibility_owner) this.owners.add(node.visibility_owner);
      if (node.tree_leaf) this.terminals.add(node.id);
      if (node.selection_root) this.selectionRoots.add(node.id);
      const current = {
        layers: node.layer ? [...parent.layers, node.layer] : parent.layers,
        dependencies:
          node.visible_if_any !== undefined
            ? [...parent.dependencies, node.visible_if_any]
            : parent.dependencies,
        ancestors: [...parent.ancestors, node.id],
        owners: node.visibility_owner
          ? [...parent.owners, node.visibility_owner]
          : parent.owners,
        selectionRoot: node.selection_root ? node.id : parent.selectionRoot,
      };
      if (node.parts) {
        this.branches.add(node.id);
        node.parts.forEach((child) => walk(child, current));
      } else this.leaves.set(node.id, current);
    };
    if (tree)
      walk(tree, {
        layers: [],
        dependencies: [],
        ancestors: [],
        owners: [],
        selectionRoot: null,
      });
    // clear() temporarily removes the scene before render() replaces it.
    if (tree) {
      this.hiddenPanels = new Set(
        [...this.hiddenPanels].filter((id) => this.selectionRoots.has(id)),
      );
    }
    // Первый крепёж модуля и новый вид наследуют ранее скрытую ветку.
    for (const [ids, states] of [
      [this.owners, this.ownerStates],
      [this.terminals, this.terminalStates],
    ] as const) {
      for (const id of ids) {
        const state: VisibilityState = [1, 1];
        let changed = false;
        for (const { path, icon, visible } of this.branchCommands.values()) {
          if (id !== path && !id.startsWith(path + "/")) continue;
          state[icon] = visible ? 1 : 0;
          changed = true;
        }
        if (changed) states.set(id, state);
      }
    }
  }

  getSelectionRoots(): ReadonlySet<string> {
    return this.selectionRoots;
  }

  private leafFor(path: string): Leaf | undefined {
    path = path.replaceAll("|", "/");
    while (path && !this.leaves.has(path))
      path = path.slice(0, path.lastIndexOf("/"));
    return this.leaves.get(path);
  }

  getSelectionRoot(path: string): string | null {
    path = path.replaceAll("|", "/");
    if (this.selectionRoots.has(path)) return path;
    return this.leafFor(path)?.selectionRoot ?? null;
  }

  isSelectionGeometry(path: string): boolean {
    const leaf = this.leafFor(path);
    return !!leaf?.selectionRoot && !leaf.dependencies.length;
  }

  getPanelFilter(): PanelFilterState | null {
    return this.hiddenPanels.size ? { count: this.hiddenPanels.size } : null;
  }

  clearPanelFilter(): void {
    this.hiddenPanels.clear();
  }

  togglePanelIsolation(selected: ReadonlySet<string>): void {
    if (!selected.size) {
      this.clearPanelFilter();
      return;
    }
    const others = new Set(
      [...this.selectionRoots].filter((id) => !selected.has(id)),
    );
    const alreadyIsolated =
      others.size === this.hiddenPanels.size &&
      [...others].every((id) => this.hiddenPanels.has(id));
    this.hiddenPanels = alreadyIsolated ? new Set() : others;
  }

  hideSelectedPanels(selected: ReadonlySet<string>): void {
    for (const id of selected) {
      if (this.selectionRoots.has(id)) this.hiddenPanels.add(id);
    }
  }

  showPanelsForTreePath(path: string): void {
    path = path.replaceAll("|", "/");
    const panel = this.isSelectionGeometry(path)
      ? this.getSelectionRoot(path)
      : null;
    for (const id of this.hiddenPanels) {
      if (id === panel || id === path || id.startsWith(path + "/"))
        this.hiddenPanels.delete(id);
    }
  }

  /** Учитывает только прямую команду, а не пересчёт состояния родителей. */
  setTreeVisibility = (path: string, icon: 0 | 1, visible: boolean): void => {
    if (this.branches.has(path)) {
      const key = `${icon}:${path}`;
      this.branchCommands.delete(key);
      this.branchCommands.set(key, { path, icon, visible });
    }
    for (const [ids, states] of [
      [this.owners, this.ownerStates],
      [this.terminals, this.terminalStates],
    ] as const) {
      for (const id of ids) {
        if (id !== path && !id.startsWith(path + "/")) continue;
        const state = states.get(id) ?? [1, 1];
        state[icon] = visible ? 1 : 0;
        states.set(id, state);
      }
    }
  };

  getTreeStates(includeOwners = false): Record<string, VisibilityState> {
    const result: Record<string, VisibilityState> = {};
    if (includeOwners) {
      for (const id of this.owners) {
        const state = this.ownerStates.get(id);
        if (state && state.includes(0)) result[id] = [...state];
      }
    }
    for (const id of this.terminals) {
      const state = this.terminalStates.get(id);
      if (state) result[id] = [...state];
    }
    return result;
  }

  getLayers(): Record<string, { name: string; visible: boolean }> {
    return Object.fromEntries(
      Object.entries(this.names).map(([id, name]) => [
        id,
        { name, visible: this.choices.get(id) ?? this.defaults[id] ?? true },
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
      leaf.layers.every((id) => (this.choices.get(id) ?? this.defaults[id] ?? true)) &&
      (!leaf.selectionRoot || !this.hiddenPanels.has(leaf.selectionRoot));

    for (const [path, value] of Object.entries(groups)) {
      const group = value as ObjectGroup;
      if (!group.isObjectGroup) continue;
      // Развёрнутые грани и рёбра наследуют метаданные исходного тела.
      const leaf = this.leafFor(path);
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
        leaf.owners.every((id) => {
          const state = this.ownerStates.get(id);
          return !state || state.some((value) => value === 1);
        }) &&
        leaf.dependencies.every((refs) =>
          refs.some((ref) => subjects.has(ref)),
        );
    }
  }
}
