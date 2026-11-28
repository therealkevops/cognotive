import { useState, type DragEvent } from "react";
import { TREE_DRAG_TYPE as DRAG_TYPE } from "@/lib/vault/drag";
import { dirname } from "@/lib/vault/paths";

/** Dragging several chosen items: their paths, as JSON. */
export const DRAG_MANY = "application/x-noted-paths";

type Where = "before" | "after";

/** What dropping in the file tree does. */
export interface TreeDropActions {
  /** Files dragged in from the computer, saved as attachments in `folder`. */
  addFiles(files: File[], folder: string): void;
  moveMany(paths: string[], folder: string): void;
  moveOne(path: string, folder: string): void;
  /** Puts the items above or below a row (into its folder first). */
  reorder(paths: string[], anchor: string, where: Where): void;
  openFolder(path: string): void;
}

const draggedPaths = (e: DragEvent): string[] => {
  const many = e.dataTransfer.getData(DRAG_MANY);
  if (many) return JSON.parse(many) as string[];
  const one = e.dataTransfer.getData(DRAG_TYPE);
  return one ? [one] : [];
};

const accepts = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes("Files");

/** Dropping files and tree rows on the tree: which folder or gap lights up, and what a drop does. */
export function useTreeDrop(actions: TreeDropActions) {
  /** The folder a drop would go into ("" for the top level). */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** Where a dragged item would go among the rows: above or below this one. */
  const [dropLine, setDropLine] = useState<{ path: string; where: Where } | null>(null);

  /**
   * Dropping on a row: on its top or bottom quarter (half, for a file), the items go above
   * or below it; on the middle of a folder, into it. Files from the computer go into the
   * row's folder (or the folder itself).
   */
  const rowDropProps = (path: string, isFolder: boolean) => {
    const whereAt = (e: DragEvent): Where | "into" => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = (e.clientY - r.top) / Math.max(1, r.height);
      if (isFolder) return y < 0.25 ? "before" : y > 0.75 ? "after" : "into";
      return y < 0.5 ? "before" : "after";
    };
    return {
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const where = e.dataTransfer.types.includes("Files") && !e.dataTransfer.types.includes(DRAG_TYPE) ? "into" : whereAt(e);
        if (where === "into") {
          setDropLine(null);
          setDropTarget(isFolder ? path : dirname(path));
        } else {
          setDropTarget(null);
          setDropLine({ path, where });
        }
      },
      onDragLeave: () => {
        setDropLine((l) => (l?.path === path ? null : l));
        setDropTarget((t) => (t === path ? null : t));
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(null);
        setDropLine(null);
        if (e.dataTransfer.files.length) {
          actions.addFiles([...e.dataTransfer.files], isFolder ? path : dirname(path));
          return;
        }
        const where = whereAt(e);
        const paths = draggedPaths(e);
        if (!paths.length) return;
        if (where === "into") {
          if (isFolder) actions.openFolder(path);
          actions.moveMany(paths, path);
        } else actions.reorder(paths, path, where);
      },
    };
  };

  /** Dropping on a folder's empty space (or the tree's, for the top level): into it. */
  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropLine(null);
      setDropTarget(folder);
    },
    onDragLeave: () => setDropTarget((t) => (t === folder ? null : t)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      setDropLine(null);
      // Files dragged in from the computer become attachments in that folder.
      if (e.dataTransfer.files.length) {
        actions.addFiles([...e.dataTransfer.files], folder);
        return;
      }
      const many = e.dataTransfer.getData(DRAG_MANY);
      if (many) {
        actions.moveMany(JSON.parse(many) as string[], folder);
        return;
      }
      const path = e.dataTransfer.getData(DRAG_TYPE);
      if (path) {
        if (folder) actions.openFolder(folder);
        actions.moveOne(path, folder);
      }
    },
  });

  return { dropTarget, dropLine, rowDropProps, dropProps };
}
