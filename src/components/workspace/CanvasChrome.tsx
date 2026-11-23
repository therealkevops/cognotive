"use client";

import { useReactFlow, useStore, useViewport, type Edge, type Node } from "@xyflow/react";
import { Minus, Plus } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CANVAS_COLORS, colorValue } from "@/lib/canvas/format";
import { RowMenu } from "../RowMenu";

/* The canvas's floating controls: the zoom pill and the bar over the selection. */

const ZOOM_MS = 180;
export const FIT = { padding: 0.15, maxZoom: 1, duration: ZOOM_MS };

/** "- 100% +", with zoom to fit, to the selection and to set sizes behind the percentage. */
export function ZoomPill() {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const anySelected = useStore((s) => s.nodes.some((n) => n.selected));
  const minZoom = useStore((s) => s.minZoom);
  const maxZoom = useStore((s) => s.maxZoom);
  const to = (z: number) => () => void rf.zoomTo(z, { duration: ZOOM_MS });
  return (
    <div
      role="group"
      aria-label="Zoom"
      className="menu-panel absolute right-3 bottom-3 z-10 flex items-center gap-0.5 p-1"
    >
      <button
        type="button"
        className="icon-button h-8 w-8"
        aria-label="Zoom out"
        title="Zoom out (-)"
        disabled={zoom <= minZoom + 0.001}
        onClick={() => void rf.zoomOut({ duration: ZOOM_MS })}
      >
        <Minus size={15} aria-hidden />
      </button>
      <RowMenu
        label="Zoom options"
        button={{
          content: `${Math.round(zoom * 100)}%`,
          className: "h-8 min-w-14 rounded-lg px-1.5 text-xs font-medium tabular-nums text-muted hover:bg-foreground/[0.07] hover:text-foreground",
          title: "Zoom options",
        }}
        items={[
          { label: "Zoom to fit", onSelect: () => void rf.fitView(FIT) },
          ...(anySelected
            ? [{ label: "Zoom to selection", onSelect: () => void rf.fitView({ ...FIT, maxZoom: 2, nodes: rf.getNodes().filter((n) => n.selected) }) }]
            : []),
          "separator",
          { label: "50%", onSelect: to(0.5) },
          { label: "100%", onSelect: to(1) },
          { label: "200%", onSelect: to(2) },
        ]}
      />
      <button
        type="button"
        className="icon-button h-8 w-8"
        aria-label="Zoom in"
        title="Zoom in (+)"
        disabled={zoom >= maxZoom - 0.001}
        onClick={() => void rf.zoomIn({ duration: ZOOM_MS })}
      >
        <Plus size={15} aria-hidden />
      </button>
    </div>
  );
}

const GAP = 10;

/**
 * A small bar just above what's selected (below it when there's no room above), with
 * what can be done to it. Follows the board as it pans and zooms; hidden while dragging.
 */
export function SelectionBar({ nodes, edges, children }: { nodes: Node[]; edges: Edge[]; children: ReactNode }) {
  const rf = useReactFlow();
  const { x: vx, y: vy, zoom } = useViewport();
  const width = useStore((s) => s.width);
  const dragging = nodes.some((n) => n.dragging);
  const bar = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Measured after each render (its buttons change with the selection); only sets state on a change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (!bar.current) return;
    const w = bar.current.offsetWidth;
    const h = bar.current.offsetHeight;
    if (w !== size.w || h !== size.h) setSize({ w, h });
  });

  // What the bar sits against, in board coordinates.
  let rect: { x: number; y: number; width: number; height: number } | null = null;
  if (nodes.length) rect = rf.getNodesBounds(nodes.map((n) => n.id));
  else if (edges.length === 1) {
    const centre = (id: string) => {
      const n = rf.getInternalNode(id);
      if (!n) return null;
      const p = n.internals.positionAbsolute;
      return { x: p.x + (n.measured.width ?? 0) / 2, y: p.y + (n.measured.height ?? 0) / 2 };
    };
    const a = centre(edges[0].source);
    const b = centre(edges[0].target);
    if (a && b) rect = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, width: 0, height: 0 };
  }
  if (!rect || dragging) return null;

  const left = rect.x * zoom + vx + (rect.width * zoom) / 2;
  const top = rect.y * zoom + vy;
  const bottom = top + rect.height * zoom;
  const half = size.w / 2;
  const x = width ? Math.max(half + 8, Math.min(left, width - half - 8)) : left;
  const above = top - size.h - GAP;
  const y = above >= 8 ? above : bottom + GAP;

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Selection"
      className="menu-panel nodrag nopan absolute z-20 flex items-center gap-0.5 p-1"
      style={{ left: x, top: y, transform: "translateX(-50%)", visibility: size.w ? "visible" : "hidden" }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}

export function BarButton({ label, onClick, children, pressed }: { label: string; onClick(): void; children: ReactNode; pressed?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-button h-8 w-8 ${pressed ? "bg-foreground/[0.07] text-foreground" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export const BarDivider = () => <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />;

/** One swatch showing the current colour; opens the palette in the bar. */
export function ColourPicker({ current, onPick }: { current: string | undefined | null; onPick(color: string | undefined): void }) {
  const [open, setOpen] = useState(false);
  const shown = current ? colorValue(current) : undefined;
  return (
    <div role="group" aria-label="Colour" className="flex items-center">
      <button
        type="button"
        className="icon-button h-8 w-8"
        aria-label="Colour"
        title="Colour"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          aria-hidden
          className={`h-4 w-4 rounded-full ${shown ? "" : "border border-border-strong bg-raised"}`}
          style={shown ? { background: shown } : current === null ? { background: "conic-gradient(#e5484d, #e0b11c, #3fa05a, #2aa5b8, #8e5bd8, #e5484d)" } : undefined}
        />
      </button>
      {open && (
        <div className="flex items-center gap-1 pr-1 pl-0.5">
          <Swatch name="No colour" selected={current === undefined} onClick={() => onPick(undefined)} />
          {Object.entries(CANVAS_COLORS).map(([id, { name, hex }]) => (
            <Swatch key={id} name={name} hex={hex} selected={current === id} onClick={() => onPick(id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Swatch({ name, hex, selected, onClick }: { name: string; hex?: string; selected: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      aria-pressed={selected}
      className={`h-5 w-5 rounded-full ${hex ? "" : "border border-border-strong bg-raised"} ${
        selected ? "ring-2 ring-accent ring-offset-2 ring-offset-raised" : ""
      }`}
      style={hex ? { background: hex } : undefined}
      onClick={onClick}
    />
  );
}
