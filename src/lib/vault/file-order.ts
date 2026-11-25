import { basename, dirname } from "./paths";
import type { TreeNode } from "./tree";

/*
 * A custom order for the file tree, set by dragging: for each folder ("" is the top level),
 * the names of what's in it, in order. Kept in the repository's settings, so it syncs.
 * Anything not listed (new files) comes after, in the usual order.
 */
export type FileOrder = Record<string, string[]>;

/** The tree with each folder's contents in its custom order, where it has one. */
export function applyOrder(tree: TreeNode, order: FileOrder): TreeNode {
  if (!Object.keys(order).length) return tree;
  const walk = (node: TreeNode): TreeNode => {
    const children = node.children.map(walk);
    const listed = order[node.path];
    if (!listed?.length) return { ...node, children };
    const rank = new Map(listed.map((n, i) => [n, i]));
    const at = (c: TreeNode) => rank.get(basename(c.path)) ?? Infinity;
    // A stable sort: those not listed keep the usual order, after the rest.
    return { ...node, children: [...children].sort((a, b) => at(a) - at(b)) };
  };
  return walk(tree);
}

/**
 * A folder's new order: `names` (its contents as shown) with `moving` taken out and put
 * before or after `anchor`. Unchanged if the anchor is itself moving.
 */
export function placeNames(names: string[], moving: string[], anchor: string, where: "before" | "after"): string[] {
  if (moving.includes(anchor)) return names;
  const rest = names.filter((n) => !moving.includes(n));
  const i = rest.indexOf(anchor);
  if (i < 0) return [...rest, ...moving];
  const at = where === "before" ? i : i + 1;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/**
 * The order after a file or folder is renamed or moved: it keeps its place under a new name
 * in the same folder, leaves its old folder's list when moved, and a renamed or moved
 * folder's own lists (and those of folders inside it) go with it. Null when nothing changes.
 */
export function orderAfterMove(order: FileOrder, from: string, to: string): FileOrder | null {
  let changed = false;
  const next: FileOrder = {};
  for (const [folder, names] of Object.entries(order)) {
    let key = folder;
    if (folder === from || folder.startsWith(`${from}/`)) {
      key = to + folder.slice(from.length);
      changed = true;
    }
    next[key] = names;
  }
  const oldFolder = dirname(from);
  const list = next[oldFolder];
  if (list?.includes(basename(from))) {
    changed = true;
    next[oldFolder] =
      dirname(to) === oldFolder ? list.map((n) => (n === basename(from) ? basename(to) : n)) : list.filter((n) => n !== basename(from));
  }
  return changed ? next : null;
}
