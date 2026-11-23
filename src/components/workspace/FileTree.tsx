"use client";

import {
  ChevronRight,
  Columns2,
  Copy,
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
} from "lucide-react";
import { useContext, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { readPref, writePref } from "@/lib/prefs";
import { dirname, isBinary, isCanvas, isDrawing, isImage, isMarkdown, isNote } from "@/lib/vault/paths";
import { copyPath, moveTargets } from "@/lib/vault/tree-actions";
import { formatLink } from "@/lib/links/format";
import { hubProperty } from "@/lib/links/health";
import { Picker } from "./Picker";
import { buildTree, type TreeNode } from "@/lib/vault/tree";
import { ATTACHMENT_FOLDER, useVault } from "../vault/useVault";
import { DeleteDialog } from "./DeleteDialog";
import { RowMenu, type RowMenuHandle } from "../RowMenu";
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
  // Where the file picker's files go: the folder whose menu asked, or the default.
  const uploadTo = useRef("");
  const [moving, setMoving] = useState<string | null>(null);
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
      <div
        role="tree"
        aria-label="Repository files"
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
            actions={actions}
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
  actions,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  setOpen(path: string, open: boolean): void;
  renaming: string | null;
  setRenaming(path: string | null): void;
  dropTarget: string | null;
  dropProps: (folder: string) => Record<string, unknown>;
  actions: TreeActions;
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
  const menu = useRef<RowMenuHandle>(null);
  // The side pane only shows on wide screens.
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

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
        onContextMenu={(e) => {
          if (isRenaming) return;
          e.preventDefault();
          menu.current?.openAt(e.clientX, e.clientY);
        }}
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
          // Touch screens have no hover: the selected item shows its menu button anyway.
          <RowMenu
            ref={menu}
            label={`More actions for ${node.name}`}
            className={`ml-auto ${isActive ? "[@media(hover:none)]:opacity-100" : ""}`}
            items={[
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
              ...(!isFolder && !isBinary(node.path) ? [{ label: "Duplicate", icon: Copy, onSelect: () => actions.duplicate(node.path) }] : []),
              ...(!isFolder ? [{ label: "Copy link", icon: Link2, onSelect: () => actions.copyLink(node.path) }] : []),
              ...(!isFolder && isNote(node.path)
                ? [
                    hubProperty(vault.links.get(node.path)?.properties) === true
                      ? { label: "Unpin from sidebar", icon: PinOff, onSelect: () => actions.togglePin(node.path) }
                      : { label: "Pin to sidebar", icon: Pin, onSelect: () => actions.togglePin(node.path) },
                  ]
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
              dropProps={dropProps}
              actions={actions}
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

/** What a file tree item's menu can do (shared by every item, so each only says which path). */
interface TreeActions {
  newNote(folder: string): void;
  newFolder(parent: string): void;
  newDrawing(folder: string): void;
  newCanvas(folder: string): void;
  upload(folder: string): void;
  move(path: string): void;
  duplicate(path: string): void;
  copyLink(path: string): void;
  togglePin(path: string): void;
}
