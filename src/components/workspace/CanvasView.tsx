"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BaseEdge,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { ExternalLink, FileText, Globe, Group, Image as ImageIcon, LayoutDashboard, StickyNote, Tag, Trash2 } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isDark } from "@/lib/appearance";
import {
  CANVAS_COLORS,
  colorValue,
  newCanvasId,
  parseCanvas,
  serializeCanvas,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type Side,
} from "@/lib/canvas/format";
import { openHow, type OpenHow } from "@/lib/links/open";
import { splitLinkText } from "@/lib/links/parse";
import { renderMarkdown } from "@/lib/markdown/render";
import type { LinkContext } from "@/lib/markdown/remark-links";
import { TREE_DRAG_TYPE } from "@/lib/vault/drag";
import { basename, isCanvas, isDrawing, isImage, isNote } from "@/lib/vault/paths";
import { Modal } from "./Modal";
import { Picker } from "./Picker";

/** What a canvas needs from the vault. */
export interface CanvasVault {
  /** Files that can be placed as cards (notes, images, drawings, other canvases…). */
  files(): Array<{ path: string; title: string; folder: string }>;
  /** A note's text for a card: the whole note, or a heading section or block. */
  notePreview(path: string, subpath?: string): { title: string; markdown: string } | null;
  /** A displayable URL for an image or drawing. */
  fileUrl(path: string): Promise<string | null>;
  exists(path: string): boolean;
  /** Resolving and reading notes, for rendering [[links]] and embeds in cards. */
  links: LinkContext;
}

export interface CanvasViewProps {
  /** Changes when a different canvas is opened. */
  docKey: string;
  initial: string;
  onChange(json: string): void;
  onOpenLink(target: string, sub?: string, how?: OpenHow): void;
  onOpenFile(path: string, how?: OpenHow): void;
  /** Shows the file's text instead, to repair a canvas that can't be read. */
  onEditAsText?(): void;
  vault: CanvasVault;
}

type CardData = { c: CanvasNode };
type ArrowData = { c: CanvasEdge };
type CardNode = Node<CardData>;
type ArrowEdge = Edge<ArrowData>;

const SIDE_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

function toCard(c: CanvasNode): CardNode {
  return {
    id: c.id,
    type: c.type,
    position: { x: c.x, y: c.y },
    width: c.width,
    height: c.height,
    data: { c },
    // Groups sit behind the cards they hold.
    zIndex: c.type === "group" ? -1 : 0,
  };
}

function toArrow(c: CanvasEdge): ArrowEdge {
  return {
    id: c.id,
    type: "canvas",
    source: c.fromNode,
    target: c.toNode,
    sourceHandle: c.fromSide ?? null,
    targetHandle: c.toSide ?? null,
    data: { c },
  };
}

/** The canvas file contents for the board as it is now. */
function toCanvas(nodes: CardNode[], edges: ArrowEdge[], extra: Record<string, unknown>): CanvasData {
  return {
    ...extra,
    nodes: nodes.map((n) => ({
      ...n.data.c,
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
      width: Math.round(n.width ?? n.measured?.width ?? n.data.c.width),
      height: Math.round(n.height ?? n.measured?.height ?? n.data.c.height),
    })) as CanvasNode[],
    edges: edges.map((e) => {
      const c: CanvasEdge = { ...e.data!.c, fromNode: e.source, toNode: e.target };
      if (e.sourceHandle) c.fromSide = e.sourceHandle as Side;
      else delete c.fromSide;
      if (e.targetHandle) c.toSide = e.targetHandle as Side;
      else delete c.toSide;
      return c;
    }),
  };
}

interface CanvasCtx {
  vault: CanvasVault;
  dark: boolean;
  editing: string | null;
  setEditing(id: string | null): void;
  update(id: string, patch: Partial<CanvasNode>): void;
  openLink(target: string, sub: string | undefined, how: OpenHow): void;
  openFile(path: string, how: OpenHow): void;
}
const Ctx = createContext<CanvasCtx | null>(null);
const useCanvas = () => useContext(Ctx)!;

function useDarkMode() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(isDark());
    mq.addEventListener("change", on);
    window.addEventListener("noted-appearance", on);
    return () => {
      mq.removeEventListener("change", on);
      window.removeEventListener("noted-appearance", on);
    };
  }, []);
  return dark;
}

/**
 * An Obsidian-style canvas: cards (text, notes, images and drawings, web
 * links, groups) on an endless board, joined by labelled arrows. Saved as
 * JSON Canvas, so the same file opens in Obsidian.
 */
export default function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider key={props.docKey}>
      <Board {...props} />
    </ReactFlowProvider>
  );
}

function Board({ initial, onChange, onOpenLink, onOpenFile, onEditAsText, vault }: CanvasViewProps) {
  const dark = useDarkMode();
  const rf = useReactFlow<CardNode, ArrowEdge>();
  const wrapper = useRef<HTMLDivElement>(null);

  // Parsed once per canvas; the board owns the state afterwards.
  const [start] = useState(() => {
    const data = parseCanvas(initial);
    if (!data) return null;
    const { nodes, edges, ...extra } = data;
    return { nodes: nodes.map(toCard), edges: edges.map(toArrow), extra };
  });
  const [nodes, setNodes] = useState<CardNode[]>(start?.nodes ?? []);
  const [edges, setEdges] = useState<ArrowEdge[]>(start?.edges ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | "note" | "file">(null);
  const [asking, setAsking] = useState<null | { kind: "link" } | { kind: "label"; edge: string }>(null);
  const busy = useRef(false);

  // Save each settled change (not every frame of a drag or resize). Saving at once,
  // not after a delay, means switching to another note can't lose the last edit.
  const lastSaved = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!start || busy.current) return;
    const json = serializeCanvas(toCanvas(nodes, edges, start.extra));
    if (lastSaved.current === null) {
      lastSaved.current = json; // what was loaded isn't an edit
      return;
    }
    if (json === lastSaved.current) return;
    lastSaved.current = json;
    onChangeRef.current(json);
  }, [nodes, edges, start]);

  const update = useCallback((id: string, patch: Partial<CanvasNode>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { c: { ...n.data.c, ...patch } as CanvasNode } } : n)));
  }, []);

  /** Where a new card goes: centred on `at`, or the middle of the view. */
  const placeAt = useCallback(
    (w: number, h: number, at?: { x: number; y: number }) => {
      const r = wrapper.current!.getBoundingClientRect();
      const p = at ?? rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      return { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), width: w, height: h };
    },
    [rf],
  );

  const add = useCallback(
    (c: CanvasNode) => {
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...toCard(c), selected: true }]);
    },
    [setNodes],
  );

  const addText = (at?: { x: number; y: number }) => {
    const id = newCanvasId();
    add({ id, type: "text", text: "", ...placeAt(260, 120, at) });
    setEditing(id);
  };

  const addFile = (path: string, at?: { x: number; y: number }) => {
    const size = isNote(path) || isCanvas(path) ? [400, 360] : [400, 300];
    add({ id: newCanvasId(), type: "file", file: path, ...placeAt(size[0], size[1], at) });
  };

  /** A group around the selected cards, or an empty one in the middle of the view. */
  const addGroup = () => {
    const chosen = nodes.filter((n) => n.selected && n.type !== "group");
    const id = newCanvasId();
    if (!chosen.length) {
      add({ id, type: "group", label: "Group", ...placeAt(600, 400) });
      return;
    }
    const pad = 40;
    const x = Math.min(...chosen.map((n) => n.position.x)) - pad;
    const y = Math.min(...chosen.map((n) => n.position.y)) - pad;
    const right = Math.max(...chosen.map((n) => n.position.x + (n.width ?? n.data.c.width))) + pad;
    const bottom = Math.max(...chosen.map((n) => n.position.y + (n.height ?? n.data.c.height))) + pad;
    add({ id, type: "group", label: "Group", x, y, width: right - x, height: bottom - y });
  };

  const onNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    busy.current = changes.some(
      (c) => (c.type === "position" && c.dragging) || (c.type === "dimensions" && c.resizing),
    );
    setNodes((ns) => applyNodeChanges(changes, ns));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange<ArrowEdge>[]) => setEdges((es) => applyEdgeChanges(changes, es)), []);
  const onConnect = useCallback((conn: Connection) => {
    const c: CanvasEdge = {
      id: newCanvasId(),
      fromNode: conn.source,
      toNode: conn.target,
      ...(conn.sourceHandle ? { fromSide: conn.sourceHandle as Side } : {}),
      ...(conn.targetHandle ? { toSide: conn.targetHandle as Side } : {}),
    };
    setEdges((es) => addEdge(toArrow(c), es));
  }, []);

  // Moving a group moves the cards inside it, as in Obsidian.
  const groupDrag = useRef<{ start: { x: number; y: number }; members: Map<string, { x: number; y: number }> } | null>(null);
  const onNodeDragStart = useCallback(
    (_e: unknown, node: CardNode) => {
      if (node.type !== "group") return;
      const gx = node.position.x;
      const gy = node.position.y;
      const gw = node.width ?? node.data.c.width;
      const gh = node.height ?? node.data.c.height;
      const members = new Map<string, { x: number; y: number }>();
      for (const n of rf.getNodes()) {
        if (n.id === node.id || n.selected) continue;
        const w = n.width ?? n.data.c.width;
        const h = n.height ?? n.data.c.height;
        if (n.position.x >= gx && n.position.y >= gy && n.position.x + w <= gx + gw && n.position.y + h <= gy + gh) {
          members.set(n.id, { ...n.position });
        }
      }
      groupDrag.current = { start: { x: gx, y: gy }, members };
    },
    [rf],
  );
  const onNodeDrag = useCallback((_e: unknown, node: CardNode) => {
    const g = groupDrag.current;
    if (!g || node.type !== "group" || !g.members.size) return;
    const dx = node.position.x - g.start.x;
    const dy = node.position.y - g.start.y;
    setNodes((ns) => ns.map((n) => (g.members.has(n.id) ? { ...n, position: { x: g.members.get(n.id)!.x + dx, y: g.members.get(n.id)!.y + dy } } : n)));
  }, []);
  const onNodeDragStop = useCallback(() => {
    groupDrag.current = null;
    busy.current = false;
    setNodes((ns) => [...ns]); // save the final positions
  }, []);

  const selectedNodes = nodes.filter((n) => n.selected);
  const selectedEdges = edges.filter((e) => e.selected);
  const hasSelection = selectedNodes.length + selectedEdges.length > 0;

  const setColor = (color: string | undefined) => {
    const ids = new Set(selectedNodes.map((n) => n.id));
    const eids = new Set(selectedEdges.map((e) => e.id));
    setNodes((ns) =>
      ns.map((n) => {
        if (!ids.has(n.id)) return n;
        const c = { ...n.data.c } as CanvasNode;
        if (color) c.color = color;
        else delete c.color;
        return { ...n, data: { c } };
      }),
    );
    setEdges((es) =>
      es.map((e) => {
        if (!eids.has(e.id)) return e;
        const c = { ...e.data!.c };
        if (color) c.color = color;
        else delete c.color;
        return { ...e, data: { c } };
      }),
    );
  };

  const removeSelected = () => {
    const ids = new Set(selectedNodes.map((n) => n.id));
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
    setEdges((es) => es.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target)));
  };

  const ctx = useMemo<CanvasCtx>(
    () => ({
      vault,
      dark,
      editing,
      setEditing,
      update,
      openLink: (t, sub, how) => onOpenLink(t, sub, how),
      openFile: (p, how) => onOpenFile(p, how),
    }),
    [vault, dark, editing, update, onOpenLink, onOpenFile],
  );

  const nodeTypes = useMemo(() => ({ text: TextCard, file: FileCard, link: LinkCard, group: GroupCard }), []);
  const edgeTypes = useMemo(() => ({ canvas: CanvasArrow }), []);

  if (!start) {
    return (
      <div role="alert" className="mx-auto max-w-lg p-8">
        <p className="font-medium">This canvas can&apos;t be opened: its file isn&apos;t valid JSON.</p>
        <p className="mt-1 text-sm text-muted">
          It may have been cut short or edited by hand. Fix it as text, or restore an earlier version from version history
          if the repository syncs with GitHub. Nothing has been changed.
        </p>
        {onEditAsText && (
          <button type="button" className="button-secondary mt-4" onClick={onEditAsText}>
            Edit as text
          </button>
        )}
      </div>
    );
  }

  return (
    <Ctx.Provider value={ctx}>
      <div
        ref={wrapper}
        className="canvas-board relative h-full w-full"
        data-testid="canvas"
        // Double-click empty space for a new text card, as in Obsidian.
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).classList.contains("react-flow__pane")) {
            addText(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(TREE_DRAG_TYPE)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "link";
          }
        }}
        onDrop={(e) => {
          const path = e.dataTransfer.getData(TREE_DRAG_TYPE);
          if (!path || !vault.exists(path)) return;
          e.preventDefault();
          addFile(path, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
        }}
      >
        <ReactFlow<CardNode, ArrowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onEdgeDoubleClick={(_e, edge) => setAsking({ kind: "label", edge: edge.id })}
          connectionMode={ConnectionMode.Loose}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          deleteKeyCode={["Backspace", "Delete"]}
          minZoom={0.1}
          maxZoom={2.5}
          fitView={nodes.length > 0}
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          colorMode={dark ? "dark" : "light"}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1.4} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>

        <div
          role="toolbar"
          aria-label="Canvas tools"
          className="menu-panel absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 p-1"
        >
          <ToolButton label="Add text card" onClick={() => addText()}>
            <StickyNote size={16} aria-hidden />
          </ToolButton>
          <ToolButton label="Add note" onClick={() => setPicker("note")}>
            <FileText size={16} aria-hidden />
          </ToolButton>
          <ToolButton label="Add image or file" onClick={() => setPicker("file")}>
            <ImageIcon size={16} aria-hidden />
          </ToolButton>
          <ToolButton label="Add web page" onClick={() => setAsking({ kind: "link" })}>
            <Globe size={16} aria-hidden />
          </ToolButton>
          <ToolButton label={selectedNodes.length ? "Group the selected cards" : "Add group"} onClick={addGroup}>
            <Group size={16} aria-hidden />
          </ToolButton>
          {hasSelection && (
            <>
              <span className="mx-1 h-5 w-px bg-border" aria-hidden />
              <div role="group" aria-label="Colour" className="flex items-center gap-1 px-1">
                <button
                  type="button"
                  aria-label="No colour"
                  title="No colour"
                  className="h-4.5 w-4.5 rounded-full border border-border-strong bg-raised"
                  onClick={() => setColor(undefined)}
                />
                {Object.entries(CANVAS_COLORS).map(([id, { name, hex }]) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={name}
                    title={name}
                    className="h-4.5 w-4.5 rounded-full"
                    style={{ background: hex }}
                    onClick={() => setColor(id)}
                  />
                ))}
              </div>
              {selectedEdges.length === 1 && selectedNodes.length === 0 && (
                <ToolButton label="Label arrow" onClick={() => setAsking({ kind: "label", edge: selectedEdges[0].id })}>
                  <Tag size={16} aria-hidden />
                </ToolButton>
              )}
              <ToolButton label="Delete" onClick={removeSelected}>
                <Trash2 size={16} aria-hidden />
              </ToolButton>
            </>
          )}
        </div>

        {nodes.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted">
            Double-click to add a card, or drag notes here from the file tree.
          </p>
        )}
      </div>

      {picker && (
        <Picker
          title={picker === "note" ? "Add note" : "Add image or file"}
          placeholder={picker === "note" ? "Which note?" : "Which file?"}
          items={vault
            .files()
            .filter((f) => (picker === "note" ? isNote(f.path) : !isNote(f.path)))
            .map((f) => ({ id: f.path, label: f.title, hint: f.folder }))}
          empty="Nothing to add yet."
          onPick={(item) => addFile(item.id)}
          onClose={() => setPicker(null)}
        />
      )}
      {asking?.kind === "link" && (
        <AskText
          title="Add web page"
          label="Address"
          initial="https://"
          onClose={() => setAsking(null)}
          onDone={(url) => add({ id: newCanvasId(), type: "link", url: url.trim(), ...placeAt(400, 300) })}
        />
      )}
      {asking?.kind === "label" && (
        <AskText
          title="Arrow label"
          label="Label (e.g. supports, causes, replaces)"
          initial={edges.find((e) => e.id === asking.edge)?.data?.c.label ?? ""}
          allowEmpty
          onClose={() => setAsking(null)}
          onDone={(label) =>
            setEdges((es) =>
              es.map((e) => {
                if (e.id !== asking.edge) return e;
                const c = { ...e.data!.c };
                if (label.trim()) c.label = label.trim();
                else delete c.label;
                return { ...e, data: { c } };
              }),
            )
          }
        />
      )}
    </Ctx.Provider>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" className="icon-button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** A one-field dialog. */
function AskText({
  title,
  label,
  initial,
  allowEmpty = false,
  onDone,
  onClose,
}: {
  title: string;
  label: string;
  initial: string;
  allowEmpty?: boolean;
  onDone(value: string): void;
  onClose(): void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Modal label={title} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!allowEmpty && !value.trim()) return;
          onDone(value);
          onClose();
        }}
      >
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">{label}</span>
          <input className="input" value={value} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setValue(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button-primary">
            Done
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Cards ---------- */

const SIDES: Side[] = ["top", "right", "bottom", "left"];

/** The frame every card shares: border in its colour, resize handles, and a connection dot per side. */
function Card({
  id,
  selected,
  color,
  children,
  className = "",
  minHeight = 40,
}: {
  id: string;
  selected: boolean;
  color?: string;
  children: React.ReactNode;
  className?: string;
  minHeight?: number;
}) {
  const c = colorValue(color);
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={120} minHeight={minHeight} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />
      <div
        className={`canvas-card h-full w-full overflow-hidden ${selected ? "is-selected" : ""} ${className}`}
        style={c ? ({ "--card-color": c } as React.CSSProperties) : undefined}
        data-card={id}
      >
        {children}
      </div>
      {SIDES.map((s) => (
        <Handle key={s} id={s} type="source" position={SIDE_POSITION[s]} className="canvas-handle" />
      ))}
    </>
  );
}

/** Clicks on [[links]] inside rendered card text. */
function useLinkClicks() {
  const { openLink } = useCanvas();
  return (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    if (a.classList.contains("internal-link")) {
      e.preventDefault();
      e.stopPropagation();
      const { target, heading, block } = splitLinkText(a.dataset.href ?? "");
      openLink(target, heading ?? (block ? `^${block}` : undefined), openHow(e));
    } else if (a.getAttribute("href")?.match(/^https?:/)) {
      e.preventDefault();
      window.open(a.href, "_blank", "noopener,noreferrer");
    }
  };
}

function useAssets(ref: React.RefObject<HTMLElement | null>, html: string) {
  const { vault } = useCanvas();
  useEffect(() => {
    let live = true;
    for (const img of ref.current?.querySelectorAll<HTMLImageElement>("img[data-asset]") ?? []) {
      void vault.fileUrl(img.dataset.asset!).then((url) => {
        if (live && url) img.src = url;
      });
    }
    return () => {
      live = false;
    };
  }, [html, ref, vault]);
}

function TextCard({ id, data, selected }: NodeProps<CardNode>) {
  const c = data.c as Extract<CanvasNode, { type: "text" }>;
  const { editing, setEditing, update, vault } = useCanvas();
  const isEditing = editing === id;
  const [draft, setDraft] = useState(c.text);
  const html = useMemo(() => (isEditing ? "" : renderMarkdown(c.text, vault.links)), [c.text, isEditing, vault.links]);
  const ref = useRef<HTMLDivElement>(null);
  useAssets(ref, html);
  const onClick = useLinkClicks();
  return (
    <Card id={id} selected={!!selected} color={c.color}>
      {isEditing ? (
        <textarea
          aria-label="Card text"
          className="nodrag nowheel nopan h-full w-full resize-none bg-transparent p-3 font-[family-name:var(--note-font)] text-[0.95rem] leading-relaxed outline-none"
          value={draft}
          autoFocus
          placeholder="Write here… [[links]] and markdown work."
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            update(id, { text: draft });
            setEditing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
      ) : (
        <div
          ref={ref}
          className="prose-note canvas-card-body nowheel h-full overflow-auto p-3 text-[0.95rem]"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setDraft(c.text);
            setEditing(id);
          }}
          onClick={onClick}
          dangerouslySetInnerHTML={{ __html: html || '<p class="text-muted">Double-click to write.</p>' }}
        />
      )}
    </Card>
  );
}

function FileCard({ id, data, selected }: NodeProps<CardNode>) {
  const c = data.c as Extract<CanvasNode, { type: "file" }>;
  const { vault, openFile, openLink } = useCanvas();
  const exists = vault.exists(c.file);
  const picture = isImage(c.file) || isDrawing(c.file);
  const preview = useMemo(
    () => (exists && isNote(c.file) ? vault.notePreview(c.file, c.subpath) : null),
    // Re-read when other notes change: vault.links changes identity with the index.
    [exists, c.file, c.subpath, vault],
  );
  const html = useMemo(() => (preview ? renderMarkdown(preview.markdown, vault.links) : ""), [preview, vault.links]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!exists || !picture) return;
    let live = true;
    void vault.fileUrl(c.file).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [exists, picture, c.file, vault]);
  const ref = useRef<HTMLDivElement>(null);
  useAssets(ref, html);
  const onClick = useLinkClicks();
  const title = preview?.title ?? basename(c.file);
  const Icon = isCanvas(c.file) ? LayoutDashboard : picture ? ImageIcon : FileText;

  return (
    <Card id={id} selected={!!selected} color={c.color} className="flex flex-col">
      <button
        type="button"
        className="nodrag flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5 text-left text-xs font-medium text-muted hover:text-accent"
        title="Open (Ctrl/Cmd-click: new tab)"
        onClick={(e) => {
          if (!exists) return;
          const how = openHow(e);
          if (c.subpath) openLink(c.file, c.subpath.replace(/^#/, ""), how);
          else openFile(c.file, how);
        }}
      >
        <Icon size={13} aria-hidden className="shrink-0" />
        <span className="truncate">{title}</span>
      </button>
      <div className="min-h-0 flex-1">
        {!exists ? (
          <p className="p-3 text-sm text-muted">“{c.file}” isn&apos;t in this repository.</p>
        ) : picture ? (
          url && (
            // eslint-disable-next-line @next/next/no-img-element -- object URL of a vault file
            <img src={url} alt={basename(c.file)} className="h-full w-full object-contain" draggable={false} />
          )
        ) : preview ? (
          <div
            ref={ref}
            className="prose-note canvas-card-body nowheel h-full overflow-auto p-3 text-[0.9rem]"
            onClick={onClick}
            dangerouslySetInnerHTML={{ __html: html || '<p class="text-muted">(empty note)</p>' }}
          />
        ) : (
          <p className="p-3 text-sm text-muted">Open it to see what&apos;s inside.</p>
        )}
      </div>
    </Card>
  );
}

function LinkCard({ id, data, selected }: NodeProps<CardNode>) {
  const c = data.c as Extract<CanvasNode, { type: "link" }>;
  let host = c.url;
  try {
    host = new URL(c.url).hostname;
  } catch {
    // keep the raw text
  }
  return (
    <Card id={id} selected={!!selected} color={c.color} className="flex flex-col items-start justify-center gap-2 p-4">
      <span className="flex items-center gap-2 text-sm font-medium">
        <Globe size={16} aria-hidden className="text-muted" />
        {host}
      </span>
      <span className="line-clamp-3 text-xs break-all text-muted">{c.url}</span>
      <a href={c.url} target="_blank" rel="noreferrer" className="nodrag button-secondary mt-1 text-xs">
        Open <ExternalLink size={12} aria-hidden />
      </a>
    </Card>
  );
}

function GroupCard({ id, data, selected }: NodeProps<CardNode>) {
  const c = data.c as Extract<CanvasNode, { type: "group" }>;
  const { editing, setEditing, update } = useCanvas();
  const [draft, setDraft] = useState(c.label ?? "");
  const color = colorValue(c.color);
  return (
    <>
      <NodeResizer isVisible={!!selected} minWidth={160} minHeight={100} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />
      <div
        className={`canvas-group h-full w-full ${selected ? "is-selected" : ""}`}
        style={color ? ({ "--card-color": color } as React.CSSProperties) : undefined}
      >
        {editing === id ? (
          <input
            aria-label="Group name"
            className="nodrag canvas-group-label input absolute -top-9 left-0 w-56"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              update(id, { label: draft.trim() || undefined });
              setEditing(null);
            }}
            onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
          />
        ) : (
          <span
            className="canvas-group-label absolute -top-8 left-0 max-w-full truncate rounded-md px-2 py-0.5 text-sm font-medium"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraft(c.label ?? "");
              setEditing(id);
            }}
          >
            {c.label || "Group"}
          </span>
        )}
      </div>
      {SIDES.map((s) => (
        <Handle key={s} id={s} type="source" position={SIDE_POSITION[s]} className="canvas-handle" />
      ))}
    </>
  );
}

/* ---------- Arrows ---------- */

function CanvasArrow({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<ArrowEdge>) {
  const c = data?.c;
  const color = colorValue(c?.color) ?? "var(--canvas-arrow)";
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const markerId = `arrow-${id}`;
  const end = c?.toEnd !== "none";
  const startArrow = c?.fromEnd === "arrow";
  return (
    <>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={color} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={end ? `url(#${markerId})` : undefined}
        markerStart={startArrow ? `url(#${markerId})` : undefined}
        style={{ stroke: color, strokeWidth: selected ? 3 : 2 }}
        interactionWidth={18}
      />
      {c?.label && (
        <EdgeLabelRenderer>
          <div
            className="canvas-edge-label nodrag nopan absolute rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, color: colorValue(c.color) }}
          >
            {c.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

