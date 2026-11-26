"use client";

import {
  ArrowDownAZ,
  CheckCheck,
  CheckSquare,
  ChevronRight,
  Columns2,
  Copy,
  CopyPlus,
  File,
  FilePlus,
  FolderInput,
  FolderPlus,
  Image as ImageIcon,
  LayoutDashboard,
  Link2,
  PenTool,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useContext, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { readPref, writePref } from "@/lib/prefs";
import { basename, dirname, isBinary, isCanvas, isDrawing, isImage, isMarkdown, isNote, isWithin } from "@/lib/vault/paths";
import { copyPath, moveTargets, moveTargetsFor, planCopy, planDuplicate, rangeOf, topmost, visiblePaths } from "@/lib/vault/tree-actions";
import { applyOrder, placeNames } from "@/lib/vault/file-order";
import { formatLink } from "@/lib/links/format";
import { hubProperty } from "@/lib/links/health";
import { Picker } from "./Picker";
import { buildTree, type TreeNode } from "@/lib/vault/tree";
import { ATTACHMENT_FOLDER, useVault } from "../vault/useVault";
import { DeleteDialog } from "./DeleteDialog";
import { BatchRename } from "./BatchRename";
import { RowMenu, type RowMenuHandle } from "../RowMenu";
import { SidePaneContext } from "./SidePane";

import { TREE_DRAG_TYPE as DRAG_TYPE } from "@/lib/vault/drag";

/** Dragging several chosen items: their paths, as JSON. */
const DRAG_MANY = "application/x-noted-paths";

export function FileTree() {
  const vault = useVault();
  // In each folder's custom order (set by dragging), where it has one.
  const tree = useMemo(() => applyOrder(buildTree(vault.entries), vault.settings.fileOrder), [vault.entries, vault.settings.fileOrder]);
  const prefKey = `vault:${vault.vaultId}:expanded`;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readPref<string[]>(prefKey, [])));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** Where a dragged item would go among the rows: above or below this one. */
  const [dropLine, setDropLine] = useState<{ path: string; where: "before" | "after" } | null>(null);

  const setOpen = (path: string, open: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(path);
      else next.delete(path);
      writePref(prefKey, [...next]);
      return next;
    });
  };

  const activeFolder = vault.active ? dirname(vault.active.path) : "";

  const newNote = async (folder: string) => {
    if (folder) setOpen(folder, true);
    await vault.createNote(folder);
  };
  const upload = useRef<HTMLInputElement>(null);
  const addFiles = async (files: File[], folder: string) => {
    const saved = await vault.addAttachments(files, folder || ATTACHMENT_FOLDER);
    if (saved.length) setOpen(dirname(saved[0]), true);
    if (saved.length === 1) await vault.open(saved[0]);
  };
  const newFolder = async (parent: string) => {
    if (parent) setOpen(parent, true);
    const path = await vault.createFolder(parent);
    if (path) setRenaming(path);
  };
  // Where the file picker's files go: the folder whose menu asked, or the default.
  const uploadTo = useRef("");
  const [moving, setMoving] = useState<string | null>(null);
  // Several items chosen at once (Ctrl/Cmd-click, Shift-click), to move together.
  const [chosenRaw, setChosen] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const chosen = useMemo(() => chosenRaw.filter((p) => vault.entries.some((e) => e.path === p || isWithin(e.path, p))), [chosenRaw, vault.entries]);
  const [movingMany, setMovingMany] = useState(false);
  const [deletingMany, setDeletingMany] = useState(false);
  const [renamingMany, setRenamingMany] = useState(false);
  const [copyingMany, setCopyingMany] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const say = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 2500);
  };
  const actions: TreeActions = {
    newNote: (f) => void newNote(f),
    newFolder: (f) => void newFolder(f),
    newDrawing: (f) => {
      setOpen(f, true);
      void vault.createDrawing(f);
    },
    newCanvas: (f) => {
      setOpen(f, true);
      void vault.createCanvas(f);
    },
    upload: (f) => {
      uploadTo.current = f;
      upload.current?.click();
    },
    move: setMoving,
    moveChosen: () => setMovingMany(true),
    deleteChosen: () => setDeletingMany(true),
    renameChosen: () => setRenamingMany(true),
    copyChosen: () => setCopyingMany(true),
    duplicateChosen: () => void duplicateMany(chosen),
    choose: (path) => {
      setChosen((prev) => (prev.includes(path) ? prev : [...prev, path]));
      anchor.current = path;
    },
    clearChosen: () => setChosen([]),
    chooseAll: () => setChosen(visiblePaths(tree, expanded)),
    nudge: (path, by) => {
      const names = namesIn(dirname(path));
      const i = names.indexOf(basename(path));
      const j = i + by;
      if (i < 0 || j < 0 || j >= names.length) return;
      const folder = dirname(path);
      void reorder([path], folder ? `${folder}/${names[j]}` : names[j], by < 0 ? "before" : "after").then(() =>
        // Moving a row in the page drops its focus: give it back, to keep going.
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[role="treeitem"][data-path="${CSS.escape(path)}"]`)?.focus()),
      );
    },
    resetOrder: (folder) => resetOrder(folder),
    hasOrder: (folder) => !!vault.settings.fileOrder[folder]?.length,
    duplicate: (path) => {
      const content = vault.textOf(path);
      if (content === undefined) return;
      void vault.createNoteWith(copyPath(path, vault.exists), content);
    },
    copyLink: (path) => {
      const inner = vault.links.linkText(path);
      // Written for pasting into the open note (a markdown link is relative to it).
      const link = formatLink(vault.settings.linkFormat, vault.active?.path ?? path, { path, target: inner }, inner);
      void navigator.clipboard.writeText(link).then(
        () => say(`Copied ${link}`),
        () => say("The browser didn't allow copying."),
      );
    },
    togglePin: (path) => {
      const pinned = hubProperty(vault.links.get(path)?.properties) === true;
      void vault.setProperty(path, "hub", pinned ? undefined : true);
      say(pinned ? "Unpinned from the sidebar." : "Pinned to the sidebar.");
    },
  };

  /** A click on a row with Ctrl/Cmd (add or take away) or Shift (a range); false for a plain click. */
  const choose = (path: string, how: { toggle: boolean; range: boolean }): boolean => {
    if (how.range) {
      const order = visiblePaths(tree, expanded);
      setChosen(rangeOf(order, anchor.current ?? vault.active?.path ?? null, path));
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
  const clearChosen = () => setChosen([]);
  /** Every row the tree shows (a closed folder counts once, and brings what's in it). */
  const chooseAll = () => setChosen(visiblePaths(tree, expanded));

  /** Moves the chosen items into a folder (a folder's contents go with it). */
  const moveMany = async (paths: string[], folder: string) => {
    const items = topmost(paths).filter((p) => dirname(p) !== folder && !isWithin(folder, p));
    for (const p of items) await vault.move(p, folder);
    if (folder) setOpen(folder, true);
    setChosen([]);
    if (items.length) say(`Moved ${items.length} ${items.length === 1 ? "item" : "items"} to ${folder || "the top level"}.`);
  };

  /** Copies the chosen items into a folder (their own, for duplicates); clashing names get " copy". */
  const copyMany = async (paths: string[], folder: string) => {
    const items = paths.map((p) => ({ path: p, isFolder: !vault.entries.some((e) => e.path === p && e.kind === "file") }));
    const plan = planCopy(items, folder, vault.entries);
    await vault.copyFiles(plan);
    if (folder) setOpen(folder, true);
    setChosen([]);
    const n = topmost(paths).length;
    say(`Copied ${n} ${n === 1 ? "item" : "items"} to ${folder || "the top level"}.`);
  };

  /** A folder's contents' names, in the order shown. */
  const namesIn = (folder: string): string[] => {
    const find = (n: TreeNode): TreeNode | undefined => (n.path === folder ? n : n.children.map(find).find(Boolean));
    return (find(tree)?.children ?? []).map((c) => basename(c.path));
  };

  /** Puts the items before or after a row (moving them into its folder first, if they're elsewhere). */
  const reorder = async (paths: string[], anchor: string, where: "before" | "after") => {
    const folder = dirname(anchor);
    // A folder can't go inside itself.
    const moving = topmost(paths).filter((p) => p !== anchor && !isWithin(folder, p));
    if (!moving.length) return;
    const names = namesIn(folder);
    for (const p of moving) if (dirname(p) !== folder) await vault.move(p, folder);
    const next = placeNames(names, moving.map(basename), basename(anchor), where);
    await vault.updateSettings({ fileOrder: { ...vault.settings.fileOrder, [folder]: next } });
    setChosen([]);
  };

  /** Back to the usual order (folders first, by name) in a folder. */
  const resetOrder = (folder: string) => {
    const rest = { ...vault.settings.fileOrder };
    delete rest[folder];
    void vault.updateSettings({ fileOrder: rest });
  };

  const draggedPaths = (e: DragEvent): string[] => {
    const many = e.dataTransfer.getData(DRAG_MANY);
    if (many) return JSON.parse(many) as string[];
    const one = e.dataTransfer.getData(DRAG_TYPE);
    return one ? [one] : [];
  };

  /**
   * Dropping on a row: on its top or bottom quarter (half, for a file), the items go above
   * or below it; on the middle of a folder, into it. Files from the computer go into the
   * row's folder (or the folder itself).
   */
  const rowDropProps = (path: string, isFolder: boolean) => {
    const whereAt = (e: DragEvent): "before" | "after" | "into" => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = (e.clientY - r.top) / Math.max(1, r.height);
      if (isFolder) return y < 0.25 ? "before" : y > 0.75 ? "after" : "into";
      return y < 0.5 ? "before" : "after";
    };
    return {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE) && !e.dataTransfer.types.includes("Files")) return;
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
          void addFiles([...e.dataTransfer.files], isFolder ? path : dirname(path));
          return;
        }
        const where = whereAt(e);
        const paths = draggedPaths(e);
        if (!paths.length) return;
        if (where === "into") {
          if (isFolder) setOpen(path, true);
          void moveMany(paths, path);
        } else void reorder(paths, path, where);
      },
    };
  };

  /** Duplicates the chosen items, each in its own folder ("Name copy"). */
  const duplicateMany = async (paths: string[]) => {
    const items = paths.map((p) => ({ path: p, isFolder: !vault.entries.some((e) => e.path === p && e.kind === "file") }));
    await vault.copyFiles(planDuplicate(items, vault.entries));
    setChosen([]);
    const n = topmost(paths).length;
    say(`Duplicated ${n} ${n === 1 ? "item" : "items"}.`);
  };

  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE) && !e.dataTransfer.types.includes("Files")) return;
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
        void addFiles([...e.dataTransfer.files], folder);
        return;
      }
      const many = e.dataTransfer.getData(DRAG_MANY);
      if (many) {
        void moveMany(JSON.parse(many) as string[], folder);
        return;
      }
      const path = e.dataTransfer.getData(DRAG_TYPE);
      if (path) {
        if (folder) setOpen(folder, true);
        void vault.move(path, folder);
      }
    },
  });

  return (
    <nav aria-label="Files" className="@container flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        {/* In a narrow sidebar the buttons need the room; the heading stays for screen readers. */}
        <h2 className="px-2 text-xs font-medium text-muted @max-[13.5rem]:sr-only">Files</h2>
        <div className="flex shrink-0 gap-0.5">
          <button
            type="button"
            className="icon-button"
            aria-label="New note"
            title="New note (Ctrl/Cmd+Alt+N)"
            onClick={() => void newNote(activeFolder)}
          >
            <FilePlus size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="New drawing"
            title="New drawing"
            onClick={() => void vault.createDrawing(activeFolder)}
          >
            <PenTool size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="New canvas"
            title="New canvas"
            onClick={() => void vault.createCanvas(activeFolder)}
          >
            <LayoutDashboard size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="New folder"
            title="New folder"
            onClick={() => void newFolder(activeFolder)}
          >
            <FolderPlus size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Add files"
            title={`Add files (saved in ${ATTACHMENT_FOLDER}/, or drop them on a folder)`}
            onClick={() => {
              uploadTo.current = "";
              upload.current?.click();
            }}
          >
            <Upload size={16} aria-hidden />
          </button>
          <input
            ref={upload}
            type="file"
            multiple
            hidden
            aria-label="Choose files to add"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) void addFiles(files, uploadTo.current);
              uploadTo.current = "";
            }}
          />
        </div>
      </div>
      {chosen.length > 0 && (
        <div role="toolbar" aria-label="Chosen files" className="mb-1.5 flex items-center gap-1 rounded-lg bg-accent/10 py-1 pr-1 pl-2.5 text-xs">
          <span className="min-w-0 flex-1 truncate font-medium">{chosen.length} selected</span>
          <button
            type="button"
            className="icon-button h-6 w-6"
            aria-label="Select all"
            title="Select all (Ctrl/Cmd+A)"
            onClick={chooseAll}
          >
            <CheckCheck size={13} aria-hidden />
          </button>
          <button type="button" className="button-secondary px-2 py-0.5 text-xs" onClick={() => setMovingMany(true)}>
            <FolderInput size={12} aria-hidden /> Move to…
          </button>
          <button type="button" className="icon-button h-6 w-6" aria-label="Duplicate selected" title="Duplicate" onClick={() => void duplicateMany(chosen)}>
            <CopyPlus size={13} aria-hidden />
          </button>
          <button type="button" className="icon-button h-6 w-6" aria-label="Copy selected" title="Copy to…" onClick={() => setCopyingMany(true)}>
            <Copy size={13} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button h-6 w-6"
            aria-label="Rename selected"
            title="Rename selected"
            disabled={chosen.length < 2}
            onClick={() => setRenamingMany(true)}
          >
            <Pencil size={13} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button h-6 w-6 hover:text-red-600 dark:hover:text-red-400"
            aria-label="Delete selected"
            title="Delete selected"
            onClick={() => setDeletingMany(true)}
          >
            <Trash2 size={13} aria-hidden />
          </button>
          <button type="button" className="icon-button h-6 w-6" aria-label="Clear selection" title="Clear selection (Escape)" onClick={clearChosen}>
            <X size={13} aria-hidden />
          </button>
        </div>
      )}
      <div
        role="tree"
        aria-label="Repository files"
        aria-multiselectable
        onKeyDown={(e) => {
          if (e.key === "Escape" && chosen.length) {
            e.stopPropagation();
            clearChosen();
          } else if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "a" && !(e.target as HTMLElement).closest("input")) {
            // Select all, while the tree (not a name being edited) has the keyboard.
            e.preventDefault();
            e.stopPropagation();
            chooseAll();
          }
        }}
        className={`-mx-2 min-h-24 flex-1 overflow-y-auto rounded px-2 pb-8 ${dropTarget === "" ? "bg-accent/10" : ""}`}
        {...dropProps("")}
      >
        {tree.children.length === 0 && <p className="px-2 py-1 text-sm text-muted">No notes yet.</p>}
        {tree.children.map((n) => (
          <Node
            key={n.path}
            node={n}
            depth={0}
            expanded={expanded}
            setOpen={setOpen}
            renaming={renaming}
            setRenaming={setRenaming}
            dropTarget={dropTarget}
            dropLine={dropLine}
            rowDropProps={rowDropProps}
            actions={actions}
            chosen={chosen}
            choose={choose}
          />
        ))}
      </div>
      {notice && (
        <p role="status" className="truncate px-2 pt-1 text-xs text-muted">
          {notice}
        </p>
      )}
      {moving && (
        <Picker
          title={`Move ${moving.split("/").pop()} to…`}
          placeholder="Folder"
          items={moveTargets(tree, moving)}
          onPick={(item) => {
            if (item.id) setOpen(item.id, true);
            void vault.move(moving, item.id);
          }}
          onClose={() => setMoving(null)}
        />
      )}
      {renamingMany && chosen.length > 1 && (
        <BatchRename
          // In the order the tree shows them (chosen items in closed folders after).
          items={(() => {
            const order = visiblePaths(tree, expanded);
            const sorted = [...chosen].sort((a, b) => (order.indexOf(a) + 1 || Infinity) - (order.indexOf(b) + 1 || Infinity));
            return sorted.map((p) => ({ path: p, isFolder: !vault.entries.some((e) => e.path === p && e.kind === "file") }));
          })()}
          onClose={() => setRenamingMany(false)}
          onDone={(n) => {
            setChosen([]);
            if (n) say(`Renamed ${n} ${n === 1 ? "item" : "items"}.`);
          }}
        />
      )}
      {deletingMany && chosen.length > 0 && (
        <DeleteDialog
          items={chosen.map((p) => ({ path: p, isFolder: !vault.entries.some((e) => e.path === p && e.kind === "file") }))}
          // Cancelling keeps the selection; deleted items drop out of it by themselves.
          onClose={() => setDeletingMany(false)}
        />
      )}
      {copyingMany && chosen.length > 0 && (
        <Picker
          title={`Copy ${chosen.length} ${chosen.length === 1 ? "item" : "items"} to…`}
          placeholder="Folder (its own for duplicates)"
          // Any folder: the one they're in makes "Name copy" duplicates.
          items={moveTargetsFor(tree, [])}
          onPick={(item) => void copyMany(chosen, item.id)}
          onClose={() => setCopyingMany(false)}
        />
      )}
      {movingMany && chosen.length > 0 && (
        <Picker
          title={`Move ${chosen.length} ${chosen.length === 1 ? "item" : "items"} to…`}
          placeholder="Folder"
          items={moveTargetsFor(tree, chosen)}
          onPick={(item) => void moveMany(chosen, item.id)}
          onClose={() => setMovingMany(false)}
        />
      )}
    </nav>
  );
}

function Node({
  node,
  depth,
  expanded,
  setOpen,
  renaming,
  setRenaming,
  dropTarget,
  dropLine,
  rowDropProps,
  actions,
  chosen,
  choose,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  setOpen(path: string, open: boolean): void;
  renaming: string | null;
  setRenaming(path: string | null): void;
  dropTarget: string | null;
  dropLine: { path: string; where: "before" | "after" } | null;
  rowDropProps: (path: string, isFolder: boolean) => Record<string, unknown>;
  actions: TreeActions;
  chosen: string[];
  choose(path: string, how: { toggle: boolean; range: boolean }): boolean;
}) {
  const vault = useVault();
  const openSide = useContext(SidePaneContext);
  const isFolder = node.kind === "folder";
  const open = isFolder && expanded.has(node.path);
  const isActive = vault.active?.path === node.path;
  const isRenaming = renaming === node.path;
  const isChosen = chosen.includes(node.path);
  const many = isChosen && chosen.length > 1;
  const canOpen = !isFolder;
  const FileIcon = isDrawing(node.path)
    ? PenTool
    : isCanvas(node.path)
      ? LayoutDashboard
      : isImage(node.path)
        ? ImageIcon
        : isMarkdown(node.path)
          ? null
          : File;

  const activate = () => {
    if (isFolder) setOpen(node.path, !open);
    else if (canOpen) void vault.open(node.path);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    } else if (e.key === "F2") {
      e.preventDefault();
      setRenaming(node.path);
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      // Alt+Up/Down moves it up or down among its folder's contents.
      e.preventDefault();
      actions.nudge(node.path, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "ArrowRight" && isFolder && !open) setOpen(node.path, true);
    else if (e.key === "ArrowLeft" && isFolder && open) setOpen(node.path, false);
  };

  const [deleting, setDeleting] = useState(false);
  const remove = () => setDeleting(true);
  const menu = useRef<RowMenuHandle>(null);
  // The side pane only shows on wide screens.
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

  return (
    <div role="none">
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isFolder ? open : undefined}
        aria-selected={chosen.length ? isChosen : isActive}
        aria-current={isActive ? "page" : undefined}
        tabIndex={0}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, node.path);
          // Dragging one of several chosen items takes them all.
          if (many) e.dataTransfer.setData(DRAG_MANY, JSON.stringify(chosen));
          // Move into a folder, or link from the editor.
          e.dataTransfer.effectAllowed = "linkMove";
        }}
        onClick={(e) => {
          if (choose(node.path, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })) return;
          activate();
        }}
        onKeyDown={onKeyDown}
        onDoubleClick={() => setRenaming(node.path)}
        onContextMenu={(e) => {
          if (isRenaming) return;
          e.preventDefault();
          // A right-click outside the chosen items is about this one only.
          if (!isChosen && chosen.length) choose(node.path, { toggle: false, range: false });
          menu.current?.openAt(e.clientX, e.clientY);
        }}
        {...rowDropProps(node.path, isFolder)}
        className={`group flex cursor-pointer items-center gap-1.5 rounded-lg py-[0.3125rem] pr-1 text-sm select-none ${
          isChosen
            ? "bg-accent/15 text-foreground"
            : isActive
              ? "bg-foreground/[0.08] font-medium text-foreground"
              : "text-foreground/80 hover:bg-foreground/[0.05] hover:text-foreground"
        } ${dropTarget === node.path ? "ring-1 ring-accent" : ""} ${
          dropLine?.path === node.path ? (dropLine.where === "before" ? "shadow-[inset_0_2px_0_0_var(--accent)]" : "shadow-[inset_0_-2px_0_0_var(--accent)]") : ""
        } ${canOpen || isFolder ? "" : "opacity-60"}`}
        style={{ paddingLeft: `${depth * 0.9 + 0.25}rem` }}
        data-path={node.path}
      >
        {isFolder ? (
          <ChevronRight
            size={14}
            aria-hidden
            className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
          />
        ) : FileIcon ? (
          <FileIcon size={14} aria-hidden className="shrink-0 text-muted" />
        ) : (
          <span className="w-[14px] shrink-0" />
        )}
        {isRenaming ? (
          <RenameInput
            initial={node.name}
            onDone={async (name) => {
              if (name !== null && name !== node.name) {
                const ok = await vault.rename(node.path, name);
                if (!ok) return; // keep editing so the user can fix the name
              }
              setRenaming(null);
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        )}
        {!isRenaming && (
          // Touch screens have no hover: the selected item shows its menu button anyway.
          <RowMenu
            ref={menu}
            label={`More actions for ${node.name}`}
            className={`ml-auto ${isActive ? "[@media(hover:none)]:opacity-100" : ""}`}
            items={many ? [
              { label: `Move ${chosen.length} items to…`, icon: FolderInput, onSelect: actions.moveChosen },
              { label: `Duplicate ${chosen.length} items`, icon: CopyPlus, onSelect: actions.duplicateChosen },
              { label: `Copy ${chosen.length} items to…`, icon: Copy, onSelect: actions.copyChosen },
              { label: `Rename ${chosen.length} items…`, icon: Pencil, onSelect: actions.renameChosen },
              { label: "Select all", icon: CheckCheck, onSelect: actions.chooseAll },
              { label: "Clear selection", icon: X, onSelect: actions.clearChosen },
              "separator" as const,
              { label: `Delete ${chosen.length} items`, icon: Trash2, danger: true, onSelect: actions.deleteChosen },
            ] : [
              ...(isFolder
                ? [
                    { label: "New note here", icon: FilePlus, onSelect: () => actions.newNote(node.path) },
                    { label: "New drawing here", icon: PenTool, onSelect: () => actions.newDrawing(node.path) },
                    { label: "New canvas here", icon: LayoutDashboard, onSelect: () => actions.newCanvas(node.path) },
                    { label: "New folder here", icon: FolderPlus, onSelect: () => actions.newFolder(node.path) },
                    { label: "Upload files here", icon: Upload, onSelect: () => actions.upload(node.path) },
                    "separator" as const,
                  ]
                : openSide && wide
                  ? [{ label: "Open in side pane", icon: Columns2, onSelect: () => openSide(node.path) }, "separator" as const]
                  : []),
              { label: "Rename", icon: Pencil, onSelect: () => setRenaming(node.path) },
              { label: "Move to…", icon: FolderInput, onSelect: () => actions.move(node.path) },
              { label: isChosen ? "Selected" : "Select", icon: CheckSquare, onSelect: () => actions.choose(node.path) },
              { label: "Select all", icon: CheckCheck, onSelect: actions.chooseAll },
              ...(!isFolder && !isBinary(node.path) ? [{ label: "Duplicate", icon: Copy, onSelect: () => actions.duplicate(node.path) }] : []),
              ...(!isFolder ? [{ label: "Copy link", icon: Link2, onSelect: () => actions.copyLink(node.path) }] : []),
              ...(!isFolder && isNote(node.path)
                ? [
                    hubProperty(vault.links.get(node.path)?.properties) === true
                      ? { label: "Unpin from sidebar", icon: PinOff, onSelect: () => actions.togglePin(node.path) }
                      : { label: "Pin to sidebar", icon: Pin, onSelect: () => actions.togglePin(node.path) },
                  ]
                : []),
              ...(actions.hasOrder(dirname(node.path))
                ? [{ label: dirname(node.path) ? "Sort this folder A–Z" : "Sort the top level A–Z", icon: ArrowDownAZ, onSelect: () => actions.resetOrder(dirname(node.path)) }]
                : []),
              ...(isFolder && actions.hasOrder(node.path)
                ? [{ label: "Sort its contents A–Z", icon: ArrowDownAZ, onSelect: () => actions.resetOrder(node.path) }]
                : []),
              "separator" as const,
              { label: "Delete", icon: Trash2, danger: true, onSelect: remove },
            ]}
          />
        )}
      </div>
      {open && (
        <div role="group">
          {node.children.map((c) => (
            <Node
              key={c.path}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              setOpen={setOpen}
              renaming={renaming}
              setRenaming={setRenaming}
              dropTarget={dropTarget}
              dropLine={dropLine}
              rowDropProps={rowDropProps}
              actions={actions}
              chosen={chosen}
              choose={choose}
            />
          ))}
        </div>
      )}
      {deleting && <DeleteDialog items={[{ path: node.path, isFolder }]} onClose={() => setDeleting(false)} />}
    </div>
  );
}

/** Inline name editor. Enter or blur commits; Escape cancels (calls onDone(null)). */
function RenameInput({ initial, onDone }: { initial: string; onDone(name: string | null): void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      aria-label="New name"
      className="min-w-0 flex-1 rounded-md border border-border-strong bg-raised px-1.5 text-sm outline-none"
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(value);
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={() => onDone(value)}
    />
  );
}

/** What a file tree item's menu can do (shared by every item, so each only says which path). */
interface TreeActions {
  newNote(folder: string): void;
  newFolder(parent: string): void;
  newDrawing(folder: string): void;
  newCanvas(folder: string): void;
  upload(folder: string): void;
  move(path: string): void;
  /** Several chosen items: move them, add one, or let them go. */
  moveChosen(): void;
  deleteChosen(): void;
  renameChosen(): void;
  copyChosen(): void;
  duplicateChosen(): void;
  choose(path: string): void;
  clearChosen(): void;
  chooseAll(): void;
  /** Custom order: move a row up (-1) or down (1), go back to A–Z, and whether a folder has one. */
  nudge(path: string, by: -1 | 1): void;
  resetOrder(folder: string): void;
  hasOrder(folder: string): boolean;
  duplicate(path: string): void;
  copyLink(path: string): void;
  togglePin(path: string): void;
}
