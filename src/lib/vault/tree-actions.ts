import { dirname, isWithin } from "./paths";
import type { TreeNode } from "./tree";

/* Helpers for the file tree's item menus. */

/** "Plan.md" → "Plan copy.md" (then "Plan copy 2.md"), keeping a drawing's ".excalidraw.md" whole. */
export function copyPath(path: string, taken: (p: string) => boolean): string {
  const ext = /(\.excalidraw\.md|\.[^./]+)$/i.exec(path)?.[1] ?? "";
  const stem = path.slice(0, path.length - ext.length);
  let candidate = `${stem} copy${ext}`;
  for (let n = 2; taken(candidate); n++) candidate = `${stem} copy ${n}${ext}`;
  return candidate;
}

/** The folders something can move to: every folder but where it is now (and, for a folder, itself and what's inside it). */
export function moveTargets(tree: TreeNode, path: string): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const here = dirname(path);
  if (here !== "") out.push({ id: "", label: "Top level" });
  const walk = (node: TreeNode) => {
    for (const c of node.children) {
      if (c.kind !== "folder" || c.path === path || isWithin(c.path, path)) continue;
      if (c.path !== here) out.push({ id: c.path, label: c.path });
      walk(c);
    }
  };
  walk(tree);
  return out;
}
