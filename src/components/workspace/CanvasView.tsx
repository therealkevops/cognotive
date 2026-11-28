"use client";

import "@xyflow/react/dist/style.css";
import { Background, BackgroundVariant, ConnectionMode, MiniMap, ReactFlow, ReactFlowProvider, addEdge, applyEdgeChanges, applyNodeChanges, useReactFlow, type Connection, type EdgeChange, type NodeChange } from "@xyflow/react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, ArrowDownToLine, ArrowUpToLine, ChevronsDownUp, Copy, Eye, ExternalLink, LayoutGrid, MoreHorizontal as MoreIcon, Waypoints, MousePointer2, Spline, FileText, Globe, Group, Image as ImageIcon, LayoutDashboard, PanelRight, SlidersHorizontal, Type, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { colorValue, newCanvasId, parseCanvas, serializeCanvas, type CanvasEdge, type CanvasNode, type Side } from "@/lib/canvas/format";
import { align, distribute, duplicate, restack, type Alignment } from "@/lib/canvas/arrange";
import { arrowEnds, arrowLine, arrowRoute, withArrowStyle, type ArrowEnds, type ArrowLine, type ArrowRoute } from "@/lib/canvas/arrow-style";
import { canvasGraph, dotRadius } from "@/lib/canvas/graph";
import { CANVAS_VIEW_EVENT, GRID_GAP, loadCanvasView, saveCanvasView, type CanvasViewPrefs } from "@/lib/canvas/view-prefs";
import { type OpenHow } from "@/lib/links/open";
import { TREE_DRAG_TYPE } from "@/lib/vault/drag";
import { isCanvas, isNote } from "@/lib/vault/paths";
import type { PropertyInfo } from "@/lib/editor/properties";
import { Modal } from "./Modal";
import { PropertiesEditor } from "./PropertiesEditor";
import { Picker } from "./Picker";
import { RowMenu, type RowMenuHandle, type RowMenuItem } from "../RowMenu";
import { BarButton, BarDivider, ColourPicker, FIT, SelectionBar, ZoomPill } from "./CanvasChrome";
import { CanvasContext, EDGE_TYPES, NODE_TYPES, type CanvasCtx } from "./CanvasCards";
import { TITLE_ONLY_HEIGHT, hasTitleView, titleOnly, toArrow, toCanvas, toCard, type ArrowEdge, type CanvasVault, type CardNode } from "./canvas-model";
import { useDarkMode } from "../useDarkMode";

export type { CanvasVault };

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

  // The board, or the same cards and arrows drawn as a graph (laid out automatically; never saved).
  const [mode, setMode] = useState<"board" | "graph">("board");
  const graphing = mode === "graph";
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const switchTo = (next: "board" | "graph") => {
    if (next === mode) return;
    setMoved({});
    setEditing(null);
    setMode(next);
    // Once the other view is drawn, show all of it.
    requestAnimationFrame(() => requestAnimationFrame(() => void rf.fitView({ ...FIT, duration: 0 })));
  };
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
      if (graphing && (e.ctrlKey || e.metaKey || /^[a-z]$/i.test(k))) return;
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
  const singleTitleView = single && hasTitleView(single) && !compact && !graphing ? single : null;

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
    ...(selectedNodes.length && !graphing
      ? [
          { label: "Duplicate", icon: Copy, onSelect: duplicateSelected },
          { label: "Bring to front", icon: ArrowUpToLine, onSelect: () => restackSelected("front") },
          { label: "Send to back", icon: ArrowDownToLine, onSelect: () => restackSelected("back") },
        ]
      : []),
    ...(selectedNodes.length > 1 && !graphing ? ["separator" as const, ...alignItems] : []),
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
  const paneItems = (at: { x: number; y: number }): RowMenuItem[] =>
    graphing
      ? [
          { label: "Select all", icon: MousePointer2, onSelect: () => selectOnly(nodes.filter((n) => n.type !== "group").map((n) => n.id)) },
          { label: "Zoom to fit", icon: LayoutGrid, onSelect: () => void rf.fitView(FIT) },
          "separator",
          { label: "Back to the board", icon: LayoutDashboard, onSelect: () => switchTo("board") },
        ]
      : [
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
          "separator",
          { label: "Show as a graph", icon: Waypoints, onSelect: () => switchTo("graph") },
        ];

  // The graph's shape changes only when cards, arrows or note links come and go, not when
  // something is moved, recoloured or selected: lay it out again only then.
  const shape = graphing
    ? nodes.map((n) => `${n.id}:${n.type}:${n.data.c.type === "file" ? `${n.data.c.file}${n.data.c.subpath ?? ""}` : ""}`).join("|") +
      "#" +
      edges.map((e) => `${e.id}:${e.source}>${e.target}`).join("|")
    : "";
  const notePaths = graphing && view.noteLinks
    ? [...new Set(nodes.flatMap((n) => (n.data.c.type === "file" && !n.data.c.subpath && isNote(n.data.c.file) ? [n.data.c.file] : [])))].sort().join("\u0000")
    : "";
  const graph = useMemo(() => {
    if (!graphing) return null;
    const paths = notePaths ? notePaths.split("\u0000") : [];
    const links = paths.length > 1 ? (vault.noteLinks?.(paths) ?? []) : [];
    return canvasGraph(
      nodes.map((n) => n.data.c),
      edges.map((e) => ({ ...e.data!.c, fromNode: e.source, toNode: e.target })),
      links,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- laid out again only when its shape changes (see above)
  }, [graphing, shape, notePaths, vault]);

  const graphNodes = useMemo<CardNode[]>(() => {
    if (!graph) return [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return graph.dots.flatMap((d) => {
      const n = byId.get(d.id);
      if (!n) return [];
      const r = dotRadius(d.degree);
      return [
        {
          id: d.id,
          type: "dot",
          position: moved[d.id] ?? { x: d.x - r, y: d.y - r },
          width: r * 2,
          height: r * 2,
          selected: n.selected,
          data: { c: n.data.c, degree: d.degree },
        },
      ];
    });
  }, [graph, nodes, moved]);

  const graphEdges = useMemo<ArrowEdge[]>(() => {
    if (!graph) return [];
    const byId = new Map(edges.map((e) => [e.id, e]));
    const degree = new Map(graph.dots.map((d) => [d.id, d.degree]));
    const radii = (a: string, b: string): [number, number] => [dotRadius(degree.get(a) ?? 0), dotRadius(degree.get(b) ?? 0)];
    return graph.lines.flatMap((l): ArrowEdge[] => {
      if (l.kind === "link") {
        return [
          {
            id: l.id,
            type: "graph",
            source: l.source,
            target: l.target,
            selectable: false,
            focusable: false,
            deletable: false,
            data: { c: { id: l.id, fromNode: l.source, toNode: l.target, toEnd: "none" }, link: true, radii: radii(l.source, l.target) },
          },
        ];
      }
      const e = byId.get(l.id);
      if (!e) return [];
      return [{ ...e, type: "graph", sourceHandle: null, targetHandle: null, data: { ...e.data!, radii: radii(l.source, l.target) } }];
    });
  }, [graph, edges]);

  // In the graph, dragging a dot only moves it there; selecting and deleting act on the canvas.
  const onGraphNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    const places: Record<string, { x: number; y: number }> = {};
    for (const c of changes) if (c.type === "position" && c.position) places[c.id] = c.position;
    if (Object.keys(places).length) setMoved((m) => ({ ...m, ...places }));
    const rest = changes.filter((c) => c.type === "select" || c.type === "remove");
    if (rest.length) {
      const gone = new Set(rest.flatMap((c) => (c.type === "remove" ? [c.id] : [])));
      setNodes((ns) => applyNodeChanges(rest, ns));
      if (gone.size) setEdges((es) => es.filter((e) => !gone.has(e.source) && !gone.has(e.target)));
    }
  }, []);
  const onGraphEdgesChange = useCallback((changes: EdgeChange<ArrowEdge>[]) => {
    const rest = changes.filter((c) => (c.type === "select" || c.type === "remove") && !c.id.startsWith("link:"));
    if (rest.length) setEdges((es) => applyEdgeChanges(rest, es));
  }, []);

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
    <CanvasContext.Provider value={ctx}>
      <div
        ref={wrapper}
        className="canvas-board relative h-full w-full"
        data-testid="canvas"
        // Double-click empty space for a new text card, as in Obsidian.
        onDoubleClick={(e) => {
          if (!graphing && (e.target as HTMLElement).classList.contains("react-flow__pane")) {
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
          nodes={graphing ? graphNodes : shown}
          edges={graphing ? graphEdges : edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={graphing ? onGraphNodesChange : onNodesChange}
          onEdgesChange={graphing ? onGraphEdgesChange : onEdgesChange}
          onConnect={onConnect}
          nodesConnectable={!graphing}
          onNodeDragStart={graphing ? undefined : onNodeDragStart}
          onNodeDrag={graphing ? undefined : onNodeDrag}
          onNodeDragStop={graphing ? undefined : onNodeDragStop}
          onNodeDoubleClick={(_e, node) => {
            const c = node.data.c;
            if (!graphing || c.type !== "file" || !vault.exists(c.file)) return;
            if (c.subpath) onOpenLink(c.file, c.subpath.replace(/^#/, ""), "here");
            else onOpenFile(c.file, "here");
          }}
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
          snapToGrid={view.snap && !graphing}
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
              nodeColor={(n) => colorValue(n.data.c.color) ?? (n.type === "group" ? "transparent" : dark ? "#52525b" : "#a1a1aa")}
              nodeStrokeColor={(n) => (n.type === "group" ? (colorValue(n.data.c.color) ?? (dark ? "#52525b" : "#a1a1aa")) : "transparent")}
              nodeStrokeWidth={2}
            />
          )}
        </ReactFlow>

        {/* Board or graph. */}
        <div role="radiogroup" aria-label="Show as" className="menu-panel absolute top-3 left-3 z-10 flex items-center gap-0.5 p-1">
          {(
            [
              ["board", "Board", LayoutDashboard],
              ["graph", "Graph", Waypoints],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={`flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ${
                mode === m ? "bg-foreground/[0.08] text-foreground" : "text-muted hover:text-foreground"
              }`}
              onClick={() => switchTo(m)}
            >
              <Icon size={14} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {/* Adding things: a dock at the bottom, clear of the cards. */}
        <div
          role="toolbar"
          aria-label="Canvas tools"
          className="menu-panel absolute bottom-3 left-3 z-10 flex items-center gap-0.5 p-1 sm:left-1/2 sm:-translate-x-1/2"
        >
          {!graphing && (
            <>
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
            </>
          )}
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
              "separator",
              { heading: "Graph" },
              { label: "Note links", checked: view.noteLinks, onSelect: () => changeView({ noteLinks: !view.noteLinks }) },
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
            {selectedNodes.length > 1 && !graphing && (
              <RowMenu
                label="Align"
                items={alignItems}
                button={{ content: <AlignStartVertical size={15} aria-hidden />, className: "icon-button h-8 w-8", title: "Align" }}
              />
            )}
            {selectedNodes.some((n) => n.type !== "group") && !graphing && (
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

        {nodes.length === 0 && !graphing && (
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
    </CanvasContext.Provider>
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
