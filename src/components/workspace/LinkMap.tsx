"use client";

import { useMemo, useState } from "react";
import { forceLayout } from "@/lib/links/graph-layout";
import type { GraphEdge, GraphNode } from "@/lib/links/link-index";

const MAX_NODES = 300;

type Kind = "hub" | "note" | "orphan" | "missing";

/**
 * The repository's link graph at a glance: hubs large, orphans as loose amber
 * dots, links to missing notes as dashed red stubs. Hover shows a note and its
 * links; clicking opens it (or offers to create a missing one).
 */
export function LinkMap({
  graph,
  hubs,
  orphans,
  onOpen,
  onCreate,
}: {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  hubs: Set<string>;
  orphans: Set<string>;
  onOpen(path: string): void;
  onCreate(target: string, from: string): void;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const map = useMemo(() => {
    const shown = [...graph.nodes]
      .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
      .slice(0, MAX_NODES)
      .sort((a, b) => a.id.localeCompare(b.id));
    const ids = new Set(shown.map((n) => n.id));
    const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const pos = new Map(forceLayout(shown.map((n) => n.id), edges).map((p) => [p.id, p]));
    const kind = (n: GraphNode): Kind =>
      n.unresolved ? "missing" : hubs.has(n.id) ? "hub" : orphans.has(n.id) ? "orphan" : "note";
    const neighbours = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!neighbours.has(e.source)) neighbours.set(e.source, new Set());
      if (!neighbours.has(e.target)) neighbours.set(e.target, new Set());
      neighbours.get(e.source)!.add(e.target);
      neighbours.get(e.target)!.add(e.source);
    }
    const labelled = new Set(
      shown
        .filter((n) => !n.unresolved && n.degree > 1)
        .sort((a, b) => b.degree - a.degree)
        .slice(0, 3)
        .map((n) => n.id),
    );
    return { nodes: shown.map((n) => ({ ...n, ...pos.get(n.id)!, kind: kind(n) })), edges, neighbours, labelled, total: graph.nodes.length };
  }, [graph, hubs, orphans]);

  if (map.nodes.length === 0) return null;
  const near = hover ? map.neighbours.get(hover) : undefined;
  const lit = (id: string) => !hover || id === hover || !!near?.has(id);
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const at = new Map(map.nodes.map((n) => [n.id, n]));
  const missingFrom = (id: string) => map.edges.find((e) => e.target === id)?.source ?? "";
  const radius = (n: (typeof map.nodes)[number]) => (n.kind === "missing" ? 3.5 : Math.min(14, 3.5 + Math.sqrt(n.degree) * 2));
  const hovered = hover ? at.get(hover) : undefined;
  const counts = { hub: 0, note: 0, orphan: 0, missing: 0 };
  for (const n of map.nodes) counts[n.kind]++;

  return (
    <section aria-label="Link map" className="px-5 pb-4">
      <div className="link-map">
        <svg
          width="100%"
          height="100%"
          role="img"
          aria-label={`Link map: ${plural(counts.hub + counts.note + counts.orphan, "note")}, ${plural(map.edges.length, "link")}, ${plural(counts.missing, "missing note")}`}
        >
          <g>
            {map.edges.map((e) => {
              const a = at.get(e.source)!;
              const b = at.get(e.target)!;
              const on = hover && (e.source === hover || e.target === hover);
              return (
                <line
                  key={`${e.source}\u0000${e.target}`}
                  x1={pct(a.x)}
                  y1={pct(a.y)}
                  x2={pct(b.x)}
                  y2={pct(b.y)}
                  className={`map-edge${b.kind === "missing" ? " map-edge-missing" : ""}${on ? " map-edge-on" : ""}`}
                  opacity={hover && !on ? 0.15 : 1}
                />
              );
            })}
          </g>
          {map.nodes.map((n, i) => (
            <g
              key={n.id}
              role="button"
              aria-label={n.kind === "missing" ? `Create ${n.title}` : `Open ${n.title}`}
              className={`map-node map-${n.kind}`}
              style={{ ["--i" as string]: Math.min(i, 120) }}
              opacity={lit(n.id) ? 1 : 0.25}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
              onClick={() => (n.kind === "missing" ? onCreate(n.title, missingFrom(n.id)) : onOpen(n.id))}
            >
              <title>{n.kind === "missing" ? `${n.title} (doesn't exist yet)` : n.title}</title>
              {/* A larger invisible target makes small dots easy to hover. */}
              <circle cx={pct(n.x)} cy={pct(n.y)} r={Math.max(9, radius(n) + 4)} fill="transparent" />
              <circle cx={pct(n.x)} cy={pct(n.y)} r={radius(n)} className="map-dot" />
            </g>
          ))}
          {map.nodes
            .filter((n) => (hovered ? n.id === hovered.id : map.labelled.has(n.id)))
            .map((n) => (
              <text
                key={n.id}
                x={pct(n.x)}
                y={pct(n.y)}
                dy={-radius(n) - 5}
                textAnchor={n.x < 0.15 ? "start" : n.x > 0.85 ? "end" : "middle"}
                className="map-label"
              >
                {n.title}
              </text>
            ))}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <Legend kind="hub" label={`Hubs (${counts.hub})`} />
        <Legend kind="note" label={`Notes (${counts.note})`} />
        <Legend kind="orphan" label={`Orphans (${counts.orphan})`} />
        <Legend kind="missing" label={`Missing (${counts.missing})`} />
        {map.total > map.nodes.length && (
          <span className="ml-auto">
            The {map.nodes.length} most connected of {map.total}
          </span>
        )}
      </div>
    </section>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Legend({ kind, label }: { kind: Kind; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="10" height="10" aria-hidden className={`map-${kind}`}>
        <circle cx="5" cy="5" r="4" className="map-dot" />
      </svg>
      {label}
    </span>
  );
}
