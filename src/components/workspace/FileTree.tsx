"use client";

import { ChevronRight, FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState, type DragEvent, type KeyboardEvent } from "react";
import { readPref, writePref } from "@/lib/prefs";
import { dirname, isMarkdown } from "@/lib/vault/paths";
import { buildTree, type TreeNode } from "@/lib/vault/tree";
import { useVault } from "../vault/useVault";

const DRAG_TYPE = "application/x-noted-path";

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
  const newFolder = async (parent: string) => {
    if (parent) setOpen(parent, true);
    const path = await vault.createFolder(parent);
    if (path) setRenaming(path);
  };

  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(folder);
    },
    onDragLeave: () => setDropTarget((t) => (t === folder ? null : t)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
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
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Files</h2>
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
            aria-label="New folder"
            title="New folder"
            onClick={() => void newFolder(activeFolder)}
          >
            <FolderPlus size={16} aria-hidden />
          </button>
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
  const isFolder = node.kind === "folder";
  const open = isFolder && expanded.has(node.path);
  const isActive = vault.active?.path === node.path;
  const isRenaming = renaming === node.path;
  const canOpen = !isFolder && isMarkdown(node.path);

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

  const remove = () => {
    const what = isFolder ? `the folder "${node.name}" and everything in it` : `"${node.name}"`;
    if (window.confirm(`Delete ${what}? This can't be undone.`)) void vault.remove(node.path);
  };

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
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={activate}
        onKeyDown={onKeyDown}
        onDoubleClick={() => setRenaming(node.path)}
        {...(isFolder ? dropProps(node.path) : {})}
        className={`group flex cursor-pointer items-center gap-1 rounded py-1 pr-1 text-sm select-none ${
          isActive ? "bg-accent/15 text-foreground" : "text-foreground/85 hover:bg-foreground/5"
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
          <span className="ml-auto hidden shrink-0 gap-0.5 group-focus-within:flex group-hover:flex">
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
    </div>
  );
}

/** Inline name editor. Enter or blur commits; Escape cancels (calls onDone(null)). */
function RenameInput({ initial, onDone }: { initial: string; onDone(name: string | null): void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      aria-label="New name"
      className="min-w-0 flex-1 rounded border border-accent bg-background px-1 text-sm outline-none"
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
