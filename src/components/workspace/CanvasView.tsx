"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionMode,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  NodeResizer,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronsDownUp,
  Copy,
  Eye,
  ExternalLink,
  LayoutGrid,
  MoreHorizontal as MoreIcon,
  MousePointer2,
  Spline,
  FileText,
  Globe,
  Group,
  Image as ImageIcon,
  LayoutDashboard,
  PanelRight,
  SlidersHorizontal,
  Type,
  Tag,
  Trash2,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isDark } from "@/lib/appearance";
import {
  colorValue,
  newCanvasId,
  parseCanvas,
  serializeCanvas,
  type CanvasData,
  type CanvasEdge,
  type CanvasNode,
  type Side,
} from "@/lib/canvas/format";
import { align, distribute, duplicate, restack, type Alignment } from "@/lib/canvas/arrange";
import { arrowEnds, arrowLine, arrowRoute, dashPattern, withArrowStyle, type ArrowEnds, type ArrowLine, type ArrowRoute } from "@/lib/canvas/arrow-style";
import { firstLine, withoutTitle } from "@/lib/canvas/card-text";
import { CANVAS_VIEW_EVENT, GRID_GAP, loadCanvasView, saveCanvasView, type CanvasViewPrefs } from "@/lib/canvas/view-prefs";
import { openHow, type OpenHow } from "@/lib/links/open";
import { splitLinkText } from "@/lib/links/parse";
import { renderMarkdown } from "@/lib/markdown/render";
import type { LinkContext } from "@/lib/markdown/remark-links";
import { TREE_DRAG_TYPE } from "@/lib/vault/drag";
import { basename, isCanvas, isDrawing, isImage, isNote } from "@/lib/vault/paths";
import type { PropertyInfo } from "@/lib/editor/properties";
import { Modal } from "./Modal";
import { PropertiesEditor } from "./PropertiesEditor";
import { Picker } from "./Picker";
import { RowMenu, type RowMenuHandle, type RowMenuItem } from "../RowMenu";
import { BarButton, BarDivider, ColourPicker, FIT, SelectionBar, ZoomPill } from "./CanvasChrome";

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
  /** A note's properties, to edit from its card (writes into the note). */
  noteProperties?(path: string): {
    properties: Record<string, unknown>;
    info: PropertyInfo;
    set(key: string, value: unknown): void;
  } | null;
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
  /** Suggestions for the canvas's own properties (kept under "properties" in its JSON). */
  propertyInfo?: PropertyInfo;
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

/** Height of a card shown by its title only. */
const TITLE_ONLY_HEIGHT = 42;

/** A card set to show its title only, whatever the view (kept in the canvas file). */
const titleOnly = (c: CanvasNode) => c.titleOnly === true;

/** Cards that shrink to their title when the view shows titles only (pictures and groups don't). */
function hasTitleView(c: CanvasNode): boolean {
  return c.type === "text" || c.type === "link" || (c.type === "file" && !isImage(c.file) && !isDrawing(c.file));
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
  /** Cards shown by their titles only (a view setting on this device). */
  compact: boolean;
  update(id: string, patch: Partial<CanvasNode>): void;
  /** Makes a card at least this tall (a text card growing with its text). */
  growTo(id: string, height: number): void;
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

function Board({ initial, onChange, onOpenLink, onOpenFile, onEditAsText, vault, propertyInfo }: CanvasViewProps) {
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
  // Top-level keys other than nodes and edges (the canvas's properties among them), kept as they are.
  const [extra, setExtra] = useState<Record<string, unknown>>(start?.extra ?? {});
  const [showProps, setShowProps] = useState(false);
  const canvasProps = (extra.properties && typeof extra.properties === "object" && !Array.isArray(extra.properties)
    ? extra.properties
    : {}) as Record<string, unknown>;
  const setCanvasProperty = (key: string, value: unknown) =>
    setExtra((x) => {
      const props = { ...((x.properties as Record<string, unknown> | undefined) ?? {}) };
      if (value === undefined) delete props[key];
      else props[key] = value;
      const next = { ...x };
      if (Object.keys(props).length) next.properties = props;
      else delete next.properties;
      return next;
    });
  const [nodes, setNodes] = useState<CardNode[]>(start?.nodes ?? []);
  const [edges, setEdges] = useState<ArrowEdge[]>(start?.edges ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  // How canvases are shown on this device; other open canvases follow a change.
  const [view, setView] = useState<CanvasViewPrefs>(loadCanvasView);
  useEffect(() => {
    const on = () => setView(loadCanvasView());
    window.addEventListener(CANVAS_VIEW_EVENT, on);
    return () => window.removeEventListener(CANVAS_VIEW_EVENT, on);
  }, []);
  const changeView = (patch: Partial<CanvasViewPrefs>) => saveCanvasView({ ...view, ...patch });
  const compact = view.cards === "titles";
  // What the board draws: with titles only, cards are shorter on screen but keep their size in the file.
  const shown = useMemo(
    () =>
      nodes.map((n) =>
        n.id !== editing && hasTitleView(n.data.c) && (compact || titleOnly(n.data.c)) ? { ...n, height: TITLE_ONLY_HEIGHT } : n,
      ),
    [nodes, compact, editing],
  );
  // Fit the cards in view when the canvas opens, not when the first card is added to an empty one.
  const [fitOnOpen] = useState(() => (start?.nodes.length ?? 0) > 0);
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
    const json = serializeCanvas(toCanvas(nodes, edges, extra));
    if (lastSaved.current === null) {
      lastSaved.current = json; // what was loaded isn't an edit
      return;
    }
    if (json === lastSaved.current) return;
    lastSaved.current = json;
    onChangeRef.current(json);
  }, [nodes, edges, start, extra]);

  const update = useCallback((id: string, patch: Partial<CanvasNode>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { c: { ...n.data.c, ...patch } as CanvasNode } } : n)));
  }, []);
  const growTo = useCallback((id: string, height: number) => {
    setNodes((ns) =>
      ns.map((n) => (n.id === id && height > (n.height ?? n.data.c.height) ? { ...n, height: Math.ceil(height) } : n)),
    );
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

  /** The selection's colour: one they all share, undefined for none, null when they differ. */
  const selectionColor = (() => {
    const all = [...selectedNodes.map((n) => n.data.c.color), ...selectedEdges.map((e) => e.data?.c.color)];
    return all.every((c) => c === all[0]) ? all[0] : null;
  })();

  /** The selected cards as they'd be saved (current place and size). */
  const selectedCards = (): CanvasNode[] => toCanvas(selectedNodes, [], {}).nodes;

  const duplicateSelected = () => {
    const ids = new Set(selectedNodes.map((n) => n.id));
    const copy = duplicate(
      selectedCards(),
      edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => e.data!.c),
      newCanvasId,
    );
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...copy.nodes.map((c) => ({ ...toCard(c), selected: true }))]);
    setEdges((es) => [...es.map((e) => ({ ...e, selected: false })), ...copy.edges.map(toArrow)]);
  };

  const restackSelected = (to: "front" | "back") => {
    const ids = new Set(selectedNodes.map((n) => n.id));
    setNodes((ns) => restack(ns, ids, to));
  };

  const moveTo = (places: Map<string, { x: number; y: number }>) =>
    setNodes((ns) => ns.map((n) => (places.has(n.id) ? { ...n, position: places.get(n.id)! } : n)));
  const alignSelected = (how: Alignment) => moveTo(align(selectedCards(), how));
  const distributeSelected = (axis: "horizontal" | "vertical") => moveTo(distribute(selectedCards(), axis));

  const styleArrows = (change: { route?: ArrowRoute; ends?: ArrowEnds; line?: ArrowLine }) => {
    const ids = new Set(selectedEdges.map((e) => e.id));
    setEdges((es) => es.map((e) => (ids.has(e.id) ? { ...e, data: { c: withArrowStyle(e.data!.c, change) } } : e)));
  };

  const selectOnly = (nodeIds: string[], edgeIds: string[] = []) => {
    setNodes((ns) => ns.map((n) => ({ ...n, selected: nodeIds.includes(n.id) })));
    setEdges((es) => es.map((e) => ({ ...e, selected: edgeIds.includes(e.id) })));
  };

  // Single keys for the add bar and zoom, while the board (not a text box or dialog) has the keyboard.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      if (e.altKey || e.defaultPrevented) return;
      const active = document.activeElement as HTMLElement | null;
      const onBoard = !active || active === document.body || !!wrapper.current?.contains(active);
      if (!onBoard || active?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]")) return;
      if (document.querySelector("[role=dialog][aria-modal=true]")) return;
      const k = e.key;
      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+D duplicates; Ctrl/Cmd+] and [ bring to the front and send to the back.
        const mod: Record<string, () => void> = {
          d: duplicateSelected,
          "]": () => restackSelected("front"),
          "[": () => restackSelected("back"),
        };
        const run = mod[k.toLowerCase()];
        if (run && selectedNodes.length) {
          e.preventDefault();
          run();
        }
        return;
      }
      const act: Record<string, () => void> = {
        t: () => addText(),
        n: () => setPicker("note"),
        f: () => setPicker("file"),
        w: () => setAsking({ kind: "link" }),
        g: () => addGroup(),
        "+": () => void rf.zoomIn({ duration: 180 }),
        "=": () => void rf.zoomIn({ duration: 180 }),
        "-": () => void rf.zoomOut({ duration: 180 }),
        "!": () => void rf.fitView(FIT),
      };
      if (e.shiftKey && /^[a-z]$/i.test(k)) return;
      const run = act[k.toLowerCase()];
      if (!run) return;
      e.preventDefault();
      run();
    };
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const single = selectedNodes.length === 1 && selectedEdges.length === 0 ? selectedNodes[0].data.c : null;
  const singleFile = single?.type === "file" && vault.exists(single.file) ? single : null;
  const openCard = (how: OpenHow) => {
    if (!singleFile) return;
    if (singleFile.subpath) onOpenLink(singleFile.file, singleFile.subpath.replace(/^#/, ""), how);
    else onOpenFile(singleFile.file, how);
  };
  const singleTitleView = single && hasTitleView(single) && !compact ? single : null;

  const ALIGN: Array<[Alignment, string, typeof AlignStartVertical]> = [
    ["left", "Align left", AlignStartVertical],
    ["centre", "Align centres", AlignCenterVertical],
    ["right", "Align right", AlignEndVertical],
    ["top", "Align top", AlignStartHorizontal],
    ["middle", "Align middles", AlignCenterHorizontal],
    ["bottom", "Align bottom", AlignEndHorizontal],
  ];
  const alignItems: RowMenuItem[] = [
    ...ALIGN.map(([how, label, icon]) => ({ label, icon, onSelect: () => alignSelected(how) })),
    ...(selectedNodes.length > 2
      ? [
          "separator" as const,
          { label: "Space evenly across", icon: AlignHorizontalSpaceAround, onSelect: () => distributeSelected("horizontal") },
          { label: "Space evenly down", icon: AlignVerticalSpaceAround, onSelect: () => distributeSelected("vertical") },
        ]
      : []),
  ];
  const first = selectedEdges[0]?.data?.c;
  const arrowItems: RowMenuItem[] = first
    ? [
        { heading: "Line" },
        ...(["curved", "straight", "elbow"] as const).map((r) => ({
          label: r === "curved" ? "Curved" : r === "straight" ? "Straight" : "Elbow",
          radio: true,
          checked: arrowRoute(first) === r,
          onSelect: () => styleArrows({ route: r }),
        })),
        { heading: "Arrowheads" },
        ...(["none", "end", "both"] as const).map((x) => ({
          label: x === "none" ? "None" : x === "end" ? "At the end" : "Both ends",
          radio: true,
          checked: arrowEnds(first) === x,
          onSelect: () => styleArrows({ ends: x }),
        })),
        { heading: "Style" },
        ...(["solid", "dashed", "dotted"] as const).map((l) => ({
          label: l === "solid" ? "Solid" : l === "dashed" ? "Dashed" : "Dotted",
          radio: true,
          checked: arrowLine(first) === l,
          onSelect: () => styleArrows({ line: l }),
        })),
      ]
    : [];
  /** What the "More" menu and a right-click on the selection offer. */
  const selectionItems: RowMenuItem[] = [
    ...(singleFile
      ? [
          { label: "Open", icon: ExternalLink, onSelect: () => openCard("here") },
          { label: "Open to the side", icon: PanelRight, onSelect: () => openCard("side") },
          "separator" as const,
        ]
      : []),
    ...(selectedEdges.length === 1 && !selectedNodes.length
      ? [{ label: "Label arrow", icon: Tag, onSelect: () => setAsking({ kind: "label", edge: selectedEdges[0].id }) }]
      : []),
    ...(selectedNodes.length
      ? [
          { label: "Duplicate", icon: Copy, onSelect: duplicateSelected },
          { label: "Bring to front", icon: ArrowUpToLine, onSelect: () => restackSelected("front") },
          { label: "Send to back", icon: ArrowDownToLine, onSelect: () => restackSelected("back") },
        ]
      : []),
    ...(selectedNodes.length > 1 ? ["separator" as const, ...alignItems] : []),
    "separator",
    { label: selectedNodes.length + selectedEdges.length > 1 ? "Delete them" : "Delete", icon: Trash2, danger: true, onSelect: removeSelected },
  ];

  // Right-click menus: on the selection, or on empty board space (with where it was).
  const contextMenu = useRef<RowMenuHandle>(null);
  // The selection's items follow it as it changes; empty space's are made when it's right-clicked.
  const [menuFor, setMenuFor] = useState<null | { kind: "selection" } | { kind: "pane"; items: RowMenuItem[] }>(null);
  const [pickAt, setPickAt] = useState<{ x: number; y: number } | undefined>(undefined);
  const openMenu = (e: React.MouseEvent | MouseEvent, kind: NonNullable<typeof menuFor>) => {
    e.preventDefault();
    setMenuFor(kind);
    contextMenu.current?.openAt(e.clientX, e.clientY);
  };
  const paneItems = (at: { x: number; y: number }): RowMenuItem[] => [
    { label: "Add text card here", icon: Type, onSelect: () => addText(at) },
    {
      label: "Add note here",
      icon: FileText,
      onSelect: () => {
        setPickAt(at);
        setPicker("note");
      },
    },
    "separator",
    { label: "Select all", icon: MousePointer2, onSelect: () => selectOnly(nodes.map((n) => n.id)) },
    { label: "Zoom to fit", icon: LayoutGrid, onSelect: () => void rf.fitView(FIT) },
  ];

  const ctx = useMemo<CanvasCtx>(
    () => ({
      vault,
      dark,
      editing,
      setEditing,
      compact,
      update,
      growTo,
      openLink: (t, sub, how) => onOpenLink(t, sub, how),
      openFile: (p, how) => onOpenFile(p, how),
    }),
    [vault, dark, editing, compact, update, growTo, onOpenLink, onOpenFile],
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
          nodes={shown}
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
          onNodeContextMenu={(e, node) => {
            if (!node.selected) selectOnly([node.id]);
            openMenu(e, { kind: "selection" });
          }}
          onEdgeContextMenu={(e, edge) => {
            if (!edge.selected) selectOnly([], [edge.id]);
            openMenu(e, { kind: "selection" });
          }}
          onSelectionContextMenu={(e) => openMenu(e, { kind: "selection" })}
          onPaneContextMenu={(e) => openMenu(e, { kind: "pane", items: paneItems(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })) })}
          connectionMode={ConnectionMode.Loose}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          deleteKeyCode={["Backspace", "Delete"]}
          minZoom={0.1}
          maxZoom={2.5}
          fitView={fitOnOpen}
          fitViewOptions={{ maxZoom: 1, padding: 0.15 }}
          snapToGrid={view.snap}
          snapGrid={[GRID_GAP, GRID_GAP]}
          colorMode={dark ? "dark" : "light"}
          proOptions={{ hideAttribution: true }}
        >
          {view.grid !== "none" && (
            <Background
              key={view.grid}
              variant={view.grid === "lines" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
              gap={GRID_GAP}
              size={view.grid === "lines" ? 1 : 1.4}
              className={view.grid === "lines" ? "canvas-grid-lines" : undefined}
            />
          )}
          {view.minimap && (
            <MiniMap<CardNode>
              position="top-right"
              pannable
              zoomable
              ariaLabel="Mini-map"
              className="canvas-minimap"
              nodeBorderRadius={6}
              nodeColor={(n) => colorValue(n.data.c.color) ?? (n.type === "group" ? "transparent" : dark ? "#3f3f46" : "#d4d4d8")}
              nodeStrokeColor={(n) => (n.type === "group" ? (colorValue(n.data.c.color) ?? (dark ? "#52525b" : "#a1a1aa")) : "transparent")}
              nodeStrokeWidth={2}
            />
          )}
        </ReactFlow>

        {/* Adding things: a dock at the bottom, clear of the cards. */}
        <div
          role="toolbar"
          aria-label="Canvas tools"
          className="menu-panel absolute bottom-3 left-3 z-10 flex items-center gap-0.5 p-1 sm:left-1/2 sm:-translate-x-1/2"
        >
          <ToolButton label="Add text card" shortcut="T" onClick={() => addText()}>
            <Type size={16} aria-hidden />
          </ToolButton>
          <ToolButton label="Add note" shortcut="N" onClick={() => setPicker("note")}>
            <FileText size={16} aria-hidden />
          </ToolButton>
          <ToolButton label="Add image or file" shortcut="F" onClick={() => setPicker("file")}>
            <ImageIcon size={16} aria-hidden />
          </ToolButton>
          <ToolButton label="Add web page" shortcut="W" onClick={() => setAsking({ kind: "link" })}>
            <Globe size={16} aria-hidden />
          </ToolButton>
          <ToolButton label="Add group" shortcut="G" onClick={addGroup}>
            <Group size={16} aria-hidden />
          </ToolButton>
          <BarDivider />
          <RowMenu
            label="View options"
            button={{
              content: <Eye size={16} aria-hidden />,
              className: "icon-button h-8 w-8 sm:h-9 sm:w-9",
              title: "View",
            }}
            items={[
              { heading: "Grid" },
              ...(["dots", "lines", "none"] as const).map((g) => ({
                label: g === "dots" ? "Dots" : g === "lines" ? "Lines" : "No grid",
                checked: view.grid === g,
                radio: true,
                onSelect: () => changeView({ grid: g }),
              })),
              { label: "Snap to grid", checked: view.snap, onSelect: () => changeView({ snap: !view.snap }) },
              "separator",
              { heading: "Cards" },
              { label: "Show previews", checked: !compact, radio: true, onSelect: () => changeView({ cards: "preview" }) },
              { label: "Titles only", checked: compact, radio: true, onSelect: () => changeView({ cards: "titles" }) },
              "separator",
              { label: "Mini-map", checked: view.minimap, onSelect: () => changeView({ minimap: !view.minimap }) },
            ]}
          />
          {propertyInfo && (
            <>
              <ToolButton label="Canvas properties" onClick={() => setShowProps((v) => !v)}>
                <SlidersHorizontal size={16} aria-hidden />
              </ToolButton>
            </>
          )}
        </div>
        <ZoomPill />

        {hasSelection && !editing && (
          <SelectionBar nodes={selectedNodes} edges={selectedEdges}>
            <ColourPicker key={[...selectedNodes, ...selectedEdges].map((x) => x.id).join()} current={selectionColor} onPick={setColor} />
            {singleFile && (
              <>
                <BarButton label="Open" onClick={() => openCard("here")}>
                  <ExternalLink size={15} aria-hidden />
                </BarButton>
                <BarButton label="Open to the side" onClick={() => openCard("side")}>
                  <PanelRight size={15} aria-hidden />
                </BarButton>
              </>
            )}
            {singleTitleView && (
              <BarButton
                label="Title only"
                pressed={titleOnly(singleTitleView)}
                onClick={() => update(singleTitleView.id, { titleOnly: titleOnly(singleTitleView) ? undefined : true })}
              >
                <ChevronsDownUp size={15} aria-hidden />
              </BarButton>
            )}
            {selectedEdges.length === 1 && selectedNodes.length === 0 && (
              <BarButton label="Label arrow" onClick={() => setAsking({ kind: "label", edge: selectedEdges[0].id })}>
                <Tag size={15} aria-hidden />
              </BarButton>
            )}
            {selectedEdges.length > 0 && selectedNodes.length === 0 && (
              <RowMenu
                label="Arrow style"
                items={arrowItems}
                button={{ content: <Spline size={15} aria-hidden />, className: "icon-button h-8 w-8", title: "Arrow style" }}
              />
            )}
            {selectedNodes.length > 1 && (
              <RowMenu
                label="Align"
                items={alignItems}
                button={{ content: <AlignStartVertical size={15} aria-hidden />, className: "icon-button h-8 w-8", title: "Align" }}
              />
            )}
            {selectedNodes.some((n) => n.type !== "group") && (
              <BarButton label="Group the selected cards" onClick={addGroup}>
                <Group size={15} aria-hidden />
              </BarButton>
            )}
            <BarDivider />
            <RowMenu
              label="More"
              items={selectionItems}
              button={{ content: <MoreIcon size={15} aria-hidden />, className: "icon-button h-8 w-8", title: "More" }}
            />
            <BarButton label="Delete" onClick={removeSelected}>
              <Trash2 size={15} aria-hidden />
            </BarButton>
          </SelectionBar>
        )}

        <RowMenu
          ref={contextMenu}
          hideButton
          label={menuFor?.kind === "pane" ? "Canvas" : "Selection"}
          items={menuFor?.kind === "pane" ? menuFor.items : menuFor ? selectionItems : []}
        />

        {propertyInfo && showProps && (
          <div
            role="dialog"
            aria-label="Properties of this canvas"
            className="drawing-properties menu-panel"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setShowProps(false);
            }}
          >
            <PropertiesEditor properties={canvasProps} info={propertyInfo} onSet={setCanvasProperty} />
          </div>
        )}

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
          onPick={(item) => addFile(item.id, pickAt)}
          onClose={() => {
            setPickAt(undefined);
            setPicker(null);
          }}
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

function ToolButton({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="icon-button h-8 w-8 sm:h-9 sm:w-9"
      aria-label={label}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
    >
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
  resizable = true,
}: {
  id: string;
  selected: boolean;
  color?: string;
  children: React.ReactNode;
  className?: string;
  minHeight?: number;
  /** Not while shown by title only: its height on screen isn't its real one. */
  resizable?: boolean;
}) {
  const c = colorValue(color);
  return (
    <>
      <NodeResizer isVisible={selected && resizable} minWidth={120} minHeight={minHeight} lineClassName="canvas-resize-line" handleClassName="canvas-resize-handle" />
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

/** Marks a card's body while more of it is hidden below, so it fades out instead of being cut off. */
function useFade(ref: React.RefObject<HTMLElement | null>, html: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => el.toggleAttribute("data-more", el.scrollHeight - el.scrollTop - el.clientHeight > 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const seen = new ResizeObserver(check);
    seen.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      seen.disconnect();
    };
  }, [ref, html]);
}

function TextCard({ id, data, selected }: NodeProps<CardNode>) {
  const c = data.c as Extract<CanvasNode, { type: "text" }>;
  const { editing, setEditing, update, growTo, vault, compact } = useCanvas();
  const isEditing = editing === id;
  const short = (compact || titleOnly(c)) && !isEditing;
  const [draft, setDraft] = useState(c.text);
  const html = useMemo(() => (isEditing || short ? "" : renderMarkdown(c.text, vault.links)), [c.text, isEditing, short, vault.links]);
  const ref = useRef<HTMLDivElement>(null);
  useAssets(ref, html);
  useFade(ref, html);
  const onClick = useLinkClicks();
  return (
    <Card id={id} selected={!!selected} color={c.color} resizable={!short}>
      {short ? (
        <div
          className="flex h-full items-center truncate px-3 text-sm font-medium"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setDraft(c.text);
            setEditing(id);
          }}
        >
          <span className="truncate">{firstLine(c.text) || <span className="text-muted">Empty card</span>}</span>
        </div>
      ) : isEditing ? (
        <textarea
          aria-label="Card text"
          className="nodrag nowheel nopan h-full w-full resize-none bg-transparent p-3 font-[family-name:var(--note-font)] text-[0.95rem] leading-relaxed outline-none"
          value={draft}
          autoFocus
          placeholder="Write here… [[links]] and markdown work."
          onChange={(e) => {
            setDraft(e.target.value);
            // Grow with the text rather than scroll inside a small card (borders included).
            const t = e.currentTarget;
            if (t.scrollHeight > t.clientHeight) growTo(id, t.scrollHeight + 4);
          }}
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
  const { vault, openFile, openLink, compact } = useCanvas();
  const exists = vault.exists(c.file);
  const picture = isImage(c.file) || isDrawing(c.file);
  const preview = useMemo(
    () => (exists && isNote(c.file) ? vault.notePreview(c.file, c.subpath) : null),
    // Re-read when other notes change: vault.links changes identity with the index.
    [exists, c.file, c.subpath, vault],
  );
  // The card's header already shows the title: leave out a first heading that only repeats it.
  const short = (compact || titleOnly(c)) && !picture;
  const html = useMemo(
    () => (preview && !short ? renderMarkdown(withoutTitle(preview.markdown, preview.title), vault.links) : ""),
    [preview, short, vault.links],
  );
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
  useFade(ref, html);
  const onClick = useLinkClicks();
  const title = preview?.title ?? basename(c.file);
  const Icon = isCanvas(c.file) ? LayoutDashboard : picture ? ImageIcon : FileText;
  // The note's properties, edited in a panel beside the card.
  const [showProps, setShowProps] = useState(false);
  const props = exists && isNote(c.file) && !c.subpath ? vault.noteProperties?.(c.file) : null;
  const propCount = props ? Object.keys(props.properties).length : 0;
  const name = basename(c.file).replace(/\.md$/i, "");
  const open = (e: React.MouseEvent) => {
    if (!exists) return;
    const how = openHow(e);
    if (c.subpath) openLink(c.file, c.subpath.replace(/^#/, ""), how);
    else openFile(c.file, how);
  };

  return (
    <Card id={id} selected={!!selected} color={c.color} className="flex flex-col" resizable={!short}>
      <div className={`${short ? "h-full" : "canvas-card-head"} flex shrink-0 items-center`}>
        {short ? (
          // The whole card is its title: it drags like any card, and a double-click opens it.
          <div
            className="flex min-w-0 flex-1 items-center gap-2 px-3 text-sm font-medium"
            title="Double-click to open"
            onDoubleClick={(e) => {
              e.stopPropagation();
              open(e);
            }}
          >
            <Icon size={14} aria-hidden className="shrink-0 text-muted" />
            <span className="truncate">{title}</span>
          </div>
        ) : (
          <button
            type="button"
            className="nodrag flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:text-accent"
            title="Open (Ctrl/Cmd-click: new tab)"
            onClick={open}
          >
            <Icon size={14} aria-hidden className="shrink-0 text-muted" />
            <span className="truncate">{title}</span>
          </button>
        )}
        {props && (
          <button
            type="button"
            className={`nodrag mr-1 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${
              showProps ? "bg-accent/15 text-accent" : "text-muted hover:text-accent"
            }`}
            aria-label={`Properties of ${name}`}
            aria-expanded={showProps}
            title="Properties"
            onClick={() => setShowProps((v) => !v)}
          >
            <SlidersHorizontal size={12} aria-hidden />
            {propCount > 0 && propCount}
          </button>
        )}
      </div>
      {props && (
        <NodeToolbar isVisible={showProps} position={Position.Right} align="start" offset={10}>
          <div
            role="dialog"
            aria-label={`Properties of ${name}`}
            className="canvas-properties menu-panel nodrag nowheel nopan"
            onKeyDown={(e) => e.key === "Escape" && setShowProps(false)}
          >
            <PropertiesEditor properties={props.properties} info={props.info} onSet={props.set} />
          </div>
        </NodeToolbar>
      )}
      {!short && (
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
      )}
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
  const { compact } = useCanvas();
  if (compact || titleOnly(c)) {
    return (
      <Card id={id} selected={!!selected} color={c.color} className="flex items-center gap-2 px-3" resizable={false}>
        <Globe size={14} aria-hidden className="shrink-0 text-muted" />
        <span className="truncate text-sm font-medium">{host}</span>
      </Card>
    );
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
  const own = colorValue(c?.color);
  const color = selected ? (own ?? "var(--accent)") : (own ?? "var(--canvas-arrow)");
  const route = c ? arrowRoute(c) : "curved";
  const at = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [path, labelX, labelY] =
    route === "straight" ? getStraightPath(at) : route === "elbow" ? getSmoothStepPath({ ...at, borderRadius: 10 }) : getBezierPath(at);
  const markerId = `arrow-${id}`;
  const end = c?.toEnd !== "none";
  const startArrow = c?.fromEnd === "arrow";
  return (
    <>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M1,1 L9,5 L1,9 z" fill={color} stroke={color} strokeWidth="1" strokeLinejoin="round" />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={end ? `url(#${markerId})` : undefined}
        markerStart={startArrow ? `url(#${markerId})` : undefined}
        style={{ stroke: color, strokeWidth: selected ? 2.25 : 1.75, strokeDasharray: c ? dashPattern(c) : undefined, strokeLinecap: "round" }}
        interactionWidth={18}
      />
      {c?.label && (
        <EdgeLabelRenderer>
          <div
            className="canvas-edge-label nodrag nopan absolute rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, color: colorValue(c.color) }}
          >
            {c.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

