"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import type { GraphEdge, GraphNode } from "@/lib/links/link-index";

type Node = NodeObject<GraphNode & { x?: number; y?: number }>;

export interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** The open note, drawn in the accent colour. */
  activeId?: string | null;
  /** Nodes to emphasise (e.g. search matches); others are dimmed. Undefined = all. */
  highlight?: Set<string>;
  onSelect(node: GraphNode): void;
  /** Always draw labels (small graphs), instead of only when zoomed in. */
  labels?: boolean;
}

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** A force-directed graph of notes. Fills its container. */
export default function GraphCanvas({ nodes, edges, activeId, highlight, onSelect, labels }: GraphCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<Node> | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The graph library mutates link objects, so hand it copies.
  const data = useMemo(
    () => ({ nodes: nodes.map((n) => ({ ...n })), links: edges.map((e) => ({ ...e })) }),
    [nodes, edges],
  );

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      (m.get(e.source) ?? m.set(e.source, new Set()).get(e.source)!).add(e.target);
      (m.get(e.target) ?? m.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    return m;
  }, [edges]);

  const colors = useMemo(
    () => ({
      node: cssVar("--muted", "#888"),
      text: cssVar("--foreground", "#222"),
      accent: cssVar("--accent", "#6d5bd0"),
      line: cssVar("--border", "#ddd"),
      bg: cssVar("--background", "#fff"),
    }),
    // Re-read when the colour scheme changes (graph is remounted on theme change anyway).
    [],
  );

  const focus = hover ?? null;
  const isLit = (id: string) =>
    (highlight ? highlight.has(id) : true) && (!focus || id === focus || neighbours.get(focus)?.has(id));

  return (
    <div ref={box} className="h-full w-full" data-testid="graph">
      {size.width > 0 && (
        <ForceGraph2D<Node>
          ref={fg}
          width={size.width}
          height={size.height}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          cooldownTicks={120}
          minZoom={0.2}
          maxZoom={4}
          onEngineStop={() => {
            // Fit everything, but don't blow a two-note graph up to fill the screen.
            fg.current?.zoomToFit(0, 40);
            if ((fg.current?.zoom() ?? 1) > 2.5) fg.current?.zoom(2.5);
          }}
          nodeLabel={(n) => n.title}
          nodeRelSize={4}
          linkColor={(l) => {
            const s = typeof l.source === "object" ? (l.source as Node).id : l.source;
            const t = typeof l.target === "object" ? (l.target as Node).id : l.target;
            const lit = focus ? s === focus || t === focus : true;
            return lit ? colors.line : `${colors.line}55`;
          }}
          linkWidth={(l) => {
            const s = typeof l.source === "object" ? (l.source as Node).id : l.source;
            return focus && s === focus ? 1.5 : 1;
          }}
          onNodeHover={(n) => setHover(n ? (n.id as string) : null)}
          onNodeClick={(n) => onSelect(n as GraphNode)}
          nodeCanvasObject={(n, ctx, scale) => {
            const r = 3 + Math.sqrt(n.degree) * 1.6;
            const lit = isLit(n.id as string);
            ctx.globalAlpha = lit ? 1 : 0.2;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
            if (n.unresolved) {
              ctx.strokeStyle = colors.node;
              ctx.lineWidth = 1 / scale;
              ctx.stroke();
            } else {
              ctx.fillStyle = n.id === activeId ? colors.accent : n.id === focus ? colors.accent : colors.node;
              ctx.fill();
            }
            if (labels || scale > 1.4 || n.id === focus || n.id === activeId) {
              const font = 11 / scale;
              // Canvas fonts can't use CSS variables.
              ctx.font = `${font}px system-ui, -apple-system, "Segoe UI", sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = colors.text;
              ctx.fillText(n.title, n.x!, n.y! + r + 2 / scale);
            }
            ctx.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(n, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x!, n.y!, 5 + Math.sqrt(n.degree) * 1.6, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      )}
    </div>
  );
}
