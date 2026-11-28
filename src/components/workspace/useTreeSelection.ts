import { useMemo, useRef, useState } from "react";
import type { TreeNode } from "@/lib/vault/tree";
import { rangeOf, visiblePaths } from "@/lib/vault/tree-actions";
import { isWithin } from "@/lib/vault/paths";
import type { VaultEntry } from "@/lib/vault/types";

/**
 * Several files and folders chosen at once in the file tree: Ctrl/Cmd-click adds or takes
 * one away, Shift-click a range from the last one clicked, and "select all" takes every row
 * shown. Items that stop existing drop out by themselves.
 */
export function useTreeSelection(tree: TreeNode, expanded: Set<string>, entries: VaultEntry[], activePath: string | undefined) {
  const [raw, setChosen] = useState<string[]>([]);
  /** Where a Shift-click range starts. */
  const anchor = useRef<string | null>(null);
  const chosen = useMemo(() => raw.filter((p) => entries.some((e) => e.path === p || isWithin(e.path, p))), [raw, entries]);

  /** A click on a row with Ctrl/Cmd (add or take away) or Shift (a range); false for a plain click. */
  const choose = (path: string, how: { toggle: boolean; range: boolean }): boolean => {
    if (how.range) {
      setChosen(rangeOf(visiblePaths(tree, expanded), anchor.current ?? activePath ?? null, path));
      return true;
    }
    if (how.toggle) {
      setChosen((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
      anchor.current = path;
      return true;
    }
    setChosen([]);
    anchor.current = path;
    return false;
  };
  /** Adds one (from its row's menu). */
  const add = (path: string) => {
    setChosen((prev) => (prev.includes(path) ? prev : [...prev, path]));
    anchor.current = path;
  };
  const clear = () => setChosen([]);
  /** Every row the tree shows (a closed folder counts once, and brings what's in it). */
  const chooseAll = () => setChosen(visiblePaths(tree, expanded));

  return { chosen, choose, add, clear, chooseAll };
}
