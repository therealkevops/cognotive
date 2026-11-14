"use client";

import { X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useVault } from "../vault/useVault";

const GraphCanvas = dynamic(() => import("./GraphCanvas"), {
  ssr: false,
  loading: () => <p className="p-8 text-muted">Loading graph…</p>,
});

/** Full-screen graph of the whole vault, with filters. */
export function GraphDialog({ onClose }: { onClose(): void }) {
  const vault = useVault();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [orphans, setOrphans] = useState(true);
  const [ghosts, setGhosts] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tags = useMemo(
    () => [...vault.links.tags().keys()].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
    [vault.links, vault.indexVersion],
  );

  const graph = useMemo(() => {
    const g = vault.links.graph({ includeUnresolved: ghosts });
    let nodes = g.nodes;
    if (tag) {
      const keep = new Set(vault.links.withTag(tag));
      nodes = nodes.filter((n) => keep.has(n.id));
    }
    if (!orphans) nodes = nodes.filter((n) => n.degree > 0);
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
  }, [vault.links, vault.indexVersion, tag, orphans, ghosts]);

  const highlight = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    return new Set(graph.nodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id));
  }, [query, graph.nodes]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Graph view" className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <h2 className="text-base font-semibold">Graph</h2>
        <input
          type="search"
          aria-label="Highlight notes"
          placeholder="Highlight notes…"
          className="input w-48"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select aria-label="Only notes with tag" className="input w-auto" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} />
          Unlinked notes
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={ghosts} onChange={(e) => setGhosts(e.target.checked)} />
          Notes not yet created
        </label>
        <span className="text-xs text-muted">
          {graph.nodes.length} notes · {graph.edges.length} links
        </span>
        <button type="button" className="icon-button ml-auto" aria-label="Close graph" onClick={onClose}>
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <GraphCanvas
          nodes={graph.nodes}
          edges={graph.edges}
          activeId={vault.active?.path}
          highlight={highlight}
          onSelect={(n) => {
            if (n.unresolved) return;
            void vault.open(n.id);
            onClose();
          }}
        />
      </div>
    </div>
  );
}

/** The open note and its neighbours, for the side panel. */
export function LocalGraph({ onOpenFull }: { onOpenFull(): void }) {
  const vault = useVault();
  const [depth, setDepth] = useState(1);
  const path = vault.active?.path;
  const graph = useMemo(
    () => (path ? vault.links.neighborhood(path, depth, { includeUnresolved: true }) : { nodes: [], edges: [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
    [path, depth, vault.links, vault.indexVersion],
  );
  if (!path) return null;
  return (
    <section aria-label="Local graph">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium text-muted">Local graph</h2>
        <button type="button" className="text-xs text-accent hover:underline" onClick={onOpenFull}>
          Open full graph
        </button>
      </div>
      <div className="h-64 rounded-md border border-border">
        <GraphCanvas
          nodes={graph.nodes}
          edges={graph.edges}
          activeId={path}
          labels
          onSelect={(n) => !n.unresolved && void vault.open(n.id)}
        />
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted">
        Depth
        <input
          type="range"
          min={1}
          max={3}
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
          aria-label="Graph depth"
        />
        {depth}
      </label>
    </section>
  );
}
