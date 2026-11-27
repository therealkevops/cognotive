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

/* Several items chosen at once (Ctrl/Cmd-click, Shift-click). */

/** The tree's rows in the order shown: what's inside a folder only when it's open. */
export function visiblePaths(tree: TreeNode, expanded: Set<string>): string[] {
  const out: string[] = [];
  const walk = (node: TreeNode) => {
    for (const c of node.children) {
      out.push(c.path);
      if (c.kind === "folder" && expanded.has(c.path)) walk(c);
    }
  };
  walk(tree);
  return out;
}

/** The rows from `a` to `b` (either way round), as shown; just `b` if `a` isn't shown. */
export function rangeOf(order: string[], a: string | null, b: string): string[] {
  const i = a === null ? -1 : order.indexOf(a);
  const j = order.indexOf(b);
  if (j < 0) return [];
  if (i < 0) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** What to move: an item inside a chosen folder goes along with it, so isn't moved itself. */
export function topmost(paths: string[]): string[] {
  return paths.filter((p) => !paths.some((q) => q !== p && isWithin(p, q)));
}

/**
 * The folders all the chosen items can move to: none of them (or inside them), and not where
 * every one of them already is.
 */
export function moveTargetsFor(tree: TreeNode, paths: string[]): Array<{ id: string; label: string }> {
  const chosen = topmost(paths);
  const heres = new Set(chosen.map(dirname));
  const allIn = (folder: string) => heres.size === 1 && heres.has(folder);
  const out: Array<{ id: string; label: string }> = [];
  if (!allIn("")) out.push({ id: "", label: "Top level" });
  const walk = (node: TreeNode) => {
    for (const c of node.children) {
      if (c.kind !== "folder" || chosen.some((p) => c.path === p || isWithin(c.path, p))) continue;
      if (!allIn(c.path)) out.push({ id: c.path, label: c.path });
      walk(c);
    }
  };
  walk(tree);
  return out;
}

/**
 * Where copies of the chosen items go in a folder: under their own names, or "Name copy"
 * (then "Name copy 2") where that's taken, as Duplicate does. A folder's copy takes
 * everything in it. Returns each file (and folder, so empty ones come too) to copy, in order.
 */
export function planCopy(
  items: Array<{ path: string; isFolder: boolean }>,
  toFolder: string,
  entries: Array<{ path: string; kind: "file" | "folder" }>,
): Array<{ from: string; to: string; kind: "file" | "folder" }> {
  const keep = new Set(topmost(items.map((i) => i.path)));
  const taken = new Set(entries.map((e) => e.path.toLowerCase()));
  // Folders that exist only because files are in them count as taken too.
  for (const e of entries) for (let d = dirname(e.path); d; d = dirname(d)) taken.add(d.toLowerCase());
  const isTaken = (p: string) => taken.has(p.toLowerCase());
  const out: Array<{ from: string; to: string; kind: "file" | "folder" }> = [];
  for (const item of items) {
    if (!keep.has(item.path)) continue;
    const name = item.path.slice(item.path.lastIndexOf("/") + 1);
    let target = toFolder ? `${toFolder}/${name}` : name;
    if (isTaken(target)) target = copyPath(target, isTaken);
    taken.add(target.toLowerCase());
    if (!item.isFolder) {
      out.push({ from: item.path, to: target, kind: "file" });
      continue;
    }
    out.push({ from: item.path, to: target, kind: "folder" });
    for (const e of entries) {
      if (e.path === item.path || !isWithin(e.path, item.path)) continue;
      const to = target + e.path.slice(item.path.length);
      taken.add(to.toLowerCase());
      out.push({ from: e.path, to, kind: e.kind });
    }
  }
  return out;
}

/**
 * Duplicates of the chosen items, each in its own folder ("Name copy", then "Name copy 2"),
 * as Duplicate does for one; a folder's duplicate has everything in it.
 */
export function planDuplicate(
  items: Array<{ path: string; isFolder: boolean }>,
  entries: Array<{ path: string; kind: "file" | "folder" }>,
): Array<{ from: string; to: string; kind: "file" | "folder" }> {
  const keep = new Set(topmost(items.map((i) => i.path)));
  const known = [...entries];
  const out: Array<{ from: string; to: string; kind: "file" | "folder" }> = [];
  for (const item of items) {
    if (!keep.has(item.path)) continue;
    // Planned copies count as taken, so two of the same name in one folder get different ones.
    const plan = planCopy([item], dirname(item.path), known);
    for (const p of plan) known.push({ path: p.to, kind: p.kind });
    out.push(...plan);
  }
  return out;
}

/**
 * The attachments only this note uses: those it links to or embeds that no other note, drawing
 * or canvas links to. Moving the note can bring them along.
 */
export function ownAttachments(
  path: string,
  outgoing: Array<{ resolved: string | null }>,
  backlinks: (path: string) => Array<{ source: string }>,
  isAttachment: (path: string) => boolean,
): string[] {
  const targets = [...new Set(outgoing.flatMap((o) => (o.resolved && o.resolved !== path && isAttachment(o.resolved) ? [o.resolved] : [])))];
  return targets.filter((t) => backlinks(t).every((b) => b.source === path)).sort();
}
