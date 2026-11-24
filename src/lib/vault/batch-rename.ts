import { basename, dirname, displayName, fileSuffix, joinPath, validateName } from "./paths";

/*
 * Renaming several files at once (chosen in the file tree): a rule makes each new name, and
 * the plan says what each would become, or why it can't.
 */

export type RenameRule =
  | { kind: "replace"; find: string; replace: string; matchCase: boolean }
  | { kind: "affix"; prefix: string; suffix: string }
  | { kind: "number"; base: string; start: number };

export interface RenameItem {
  path: string;
  isFolder: boolean;
}

export interface PlannedRename {
  path: string;
  /** Names as shown (notes, drawings and canvases without their extension). */
  from: string;
  to: string;
  /** The path it would have. */
  target: string;
  /** Why it can't be renamed so; nothing when it can (or is unchanged). */
  problem?: string;
}

/** A name as the tree shows it: a folder's or attachment's in full, a note's without ".md". */
const shownName = (i: RenameItem) => (i.isFolder ? basename(i.path) : displayName(i.path));

/** The ending kept on a file whose shown name leaves it out (".md", ".excalidraw.md", ".canvas"). */
function hiddenSuffix(i: RenameItem): string {
  if (i.isFolder) return "";
  const suffix = fileSuffix(i.path);
  return basename(i.path).endsWith(shownName(i)) ? "" : suffix;
}

/** Each new name, in the given order (the tree's), by the rule. */
function newNames(items: RenameItem[], rule: RenameRule): string[] {
  if (rule.kind === "number") {
    const width = String(rule.start + items.length - 1).length;
    return items.map((_, i) => `${rule.base.trim()}${rule.base.trim() ? " " : ""}${String(rule.start + i).padStart(width, "0")}`);
  }
  if (rule.kind === "affix") return items.map((i) => `${rule.prefix}${shownName(i)}${rule.suffix}`);
  if (!rule.find) return items.map(shownName);
  const escaped = rule.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, rule.matchCase ? "g" : "gi");
  return items.map((i) => shownName(i).replace(pattern, () => rule.replace));
}

/**
 * What renaming these items by the rule would do. A name that's empty or not allowed, the
 * same as another new name in that folder, or taken by a file that isn't being renamed, is a
 * problem (as is one taken by another of the items, to keep the order of renames from mattering).
 */
export function planRenames(items: RenameItem[], rule: RenameRule, exists: (path: string) => boolean): PlannedRename[] {
  const names = newNames(items, rule);
  const plans: PlannedRename[] = items.map((i, n) => {
    const from = shownName(i);
    const to = names[n].trim();
    const target = joinPath(dirname(i.path), to + hiddenSuffix(i));
    return { path: i.path, from, to, target };
  });
  // Every item's name after renaming (an unchanged one keeps its own), to find two the same.
  const seen = new Map<string, number>();
  for (const p of plans) {
    const key = (p.to === p.from ? p.path : p.target).toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const p of plans) {
    if (p.to === p.from) continue;
    const invalid = validateName(p.to);
    if (invalid) p.problem = invalid;
    else if ((seen.get(p.target.toLowerCase()) ?? 0) > 1) p.problem = "Another file would get this name.";
    else if (exists(p.target) && p.target.toLowerCase() !== p.path.toLowerCase()) p.problem = "A file with this name is already there.";
  }
  return plans;
}
