"use client";

import {
  ChevronRight,
  Columns2,
  File,
  FilePlus,
  FolderPlus,
  Image as ImageIcon,
  LayoutDashboard,
  PenTool,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { useContext, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { readPref, writePref } from "@/lib/prefs";
import { dirname, isCanvas, isDrawing, isImage, isMarkdown } from "@/lib/vault/paths";
import { buildTree, type TreeNode } from "@/lib/vault/tree";
import { ATTACHMENT_FOLDER, useVault } from "../vault/useVault";
import { DeleteDialog } from "./DeleteDialog";
import { SidePaneContext } from "./SidePane";

import { TREE_DRAG_TYPE as DRAG_TYPE } from "@/lib/vault/drag";

export function FileTree() {
  const vault = useVault();
  const tree = useMemo(() => buildTree(vault.entries), [vault.entries]);
  const prefKey = `vault:${vault.vaultId}:expanded`;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readPref<string[]>(prefKey, [])));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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

  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE) && !e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(folder);
    },
    onDragLeave: () => setDropTarget((t) => (t === folder ? null : t)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      // Files dragged in from the computer become attachments in that folder.
      if (e.dataTransfer.files.length) {
        void addFiles([...e.dataTransfer.files], folder);
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
    <nav aria-label="Files" className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="px-2 text-xs font-medium text-muted">Files</h2>
        <div className="flex gap-0.5">
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
            onClick={() => upload.current?.click()}
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
              if (files.length) void addFiles(files, "");
            }}
          />
        </div>
      </div>
      <div
        role="tree"
        aria-label="Vault files"
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
            dropProps={dropProps}
            onNewNote={newNote}
          />
        ))}
      </div>
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
  dropProps,
  onNewNote,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  setOpen(path: string, open: boolean): void;
  renaming: string | null;
  setRenaming(path: string | null): void;
  dropTarget: string | null;
  dropProps: (folder: string) => Record<string, unknown>;
  onNewNote(folder: string): void;
}) {
  const vault = useVault();
  const openSide = useContext(SidePaneContext);
  const isFolder = node.kind === "folder";
  const open = isFolder && expanded.has(node.path);
  const isActive = vault.active?.path === node.path;
  const isRenaming = renaming === node.path;
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
    } else if (e.key === "ArrowRight" && isFolder && !open) setOpen(node.path, true);
    else if (e.key === "ArrowLeft" && isFolder && open) setOpen(node.path, false);
  };

  const [deleting, setDeleting] = useState(false);
  const remove = () => setDeleting(true);

  return (
    <div role="none">
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={isFolder ? open : undefined}
        aria-selected={isActive}
        aria-current={isActive ? "page" : undefined}
        tabIndex={0}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, node.path);
          // Move into a folder, or link from the editor.
          e.dataTransfer.effectAllowed = "linkMove";
        }}
        onClick={activate}
        onKeyDown={onKeyDown}
        onDoubleClick={() => setRenaming(node.path)}
        {...(isFolder ? dropProps(node.path) : {})}
        className={`group flex cursor-pointer items-center gap-1.5 rounded-lg py-[0.3125rem] pr-1 text-sm select-none ${
          isActive ? "bg-foreground/[0.08] font-medium text-foreground" : "text-foreground/80 hover:bg-foreground/[0.05] hover:text-foreground"
        } ${dropTarget === node.path ? "ring-1 ring-accent" : ""} ${canOpen || isFolder ? "" : "opacity-60"}`}
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
          // Touch screens have no hover: show the actions on the selected item instead.
          <span
            className={`ml-auto hidden shrink-0 gap-0.5 group-focus-within:flex group-hover:flex ${
              isActive ? "[@media(hover:none)]:flex" : ""
            }`}
          >
            {isFolder && (
              <button
                type="button"
                className="icon-button h-6 w-6"
                aria-label={`New note in ${node.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onNewNote(node.path);
                }}
              >
                <FilePlus size={14} aria-hidden />
              </button>
            )}
            {!isFolder && openSide && (
              <button
                type="button"
                className="icon-button hidden h-6 w-6 lg:inline-flex"
                aria-label={`Open ${node.name} in the side pane`}
                onClick={(e) => {
                  e.stopPropagation();
                  openSide(node.path);
                }}
              >
                <Columns2 size={14} aria-hidden />
              </button>
            )}
            <button
              type="button"
              className="icon-button h-6 w-6"
              aria-label={`Rename ${node.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setRenaming(node.path);
              }}
            >
              <Pencil size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="icon-button h-6 w-6"
              aria-label={`Delete ${node.name}`}
              onClick={(e) => {
                e.stopPropagation();
                remove();
              }}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </span>
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
              dropProps={dropProps}
              onNewNote={onNewNote}
            />
          ))}
        </div>
      )}
      {deleting && <DeleteDialog path={node.path} isFolder={isFolder} onClose={() => setDeleting(false)} />}
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
