import { basename, dirname, drawingName, isDrawing, isMarkdown, noteTitle } from "./paths";
import type { VaultEntry } from "./types";

export interface TreeNode {
  path: string;
  name: string;
  kind: "file" | "folder";
  children: TreeNode[];
}

/**
 * Builds the folder tree shown in the sidebar. Folders that only exist because
 * files are inside them are created on the way. Folders sort before files, and
 * names sort case-insensitively with numbers in natural order.
 */
export function buildTree(entries: VaultEntry[]): TreeNode {
  const root: TreeNode = { path: "", name: "", kind: "folder", children: [] };
  const folders = new Map<string, TreeNode>([["", root]]);

  const folder = (path: string): TreeNode => {
    const existing = folders.get(path);
    if (existing) return existing;
    const node: TreeNode = { path, name: basename(path), kind: "folder", children: [] };
    folders.set(path, node);
    folder(dirname(path)).children.push(node);
    return node;
  };

  for (const e of entries) {
    // Hidden files and folders (.noted/, .obsidian/) aren't shown.
    if (e.path.split("/").some((seg) => seg.startsWith("."))) continue;
    if (e.kind === "folder") folder(e.path);
    else
      folder(dirname(e.path)).children.push({
        path: e.path,
        // Notes and drawings show without their extension, as in Obsidian.
        name: isDrawing(e.path) ? drawingName(e.path) : isMarkdown(e.path) ? noteTitle(e.path) : basename(e.path),
        kind: "file",
        children: [],
      });
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === "folder" ? -1 : 1) : collator.compare(a.name, b.name),
    );
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}
