"use client";

import { BaseEdge, EdgeLabelRenderer, Handle, NodeResizer, NodeToolbar, Position, getBezierPath, getSmoothStepPath, getStraightPath, type EdgeProps, type NodeProps } from "@xyflow/react";
import { ExternalLink, FileText, Globe, Image as ImageIcon, LayoutDashboard, SlidersHorizontal } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { colorValue, type CanvasNode, type Side } from "@/lib/canvas/format";
import { arrowRoute, dashPattern } from "@/lib/canvas/arrow-style";
import { cardLabel, firstLine, withoutTitle } from "@/lib/canvas/card-text";
import { dotRadius } from "@/lib/canvas/graph";
import { openHow, type OpenHow } from "@/lib/links/open";
import { splitLinkText } from "@/lib/links/parse";
import { renderMarkdown } from "@/lib/markdown/render";
import { useRendererVersion } from "@/lib/markdown/use-renderer";
import { basename, isCanvas, isDrawing, isImage, isNote } from "@/lib/vault/paths";
import { PropertiesEditor } from "./PropertiesEditor";
import { SIDE_POSITION, titleOnly, type ArrowEdge, type CanvasVault, type CardNode } from "./canvas-model";

/* ---------- Shared by the board and its cards ---------- */

export interface CanvasCtx {
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
export const CanvasContext = createContext<CanvasCtx | null>(null);
const useCanvas = () => useContext(CanvasContext)!;

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
  const extras = useRendererVersion();
  const html = useMemo(
    () => (isEditing || short ? "" : renderMarkdown(c.text, vault.links)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawn again once KaTeX or the highlighter loads
    [c.text, isEditing, short, vault.links, extras],
  );
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
  const extras = useRendererVersion();
  const html = useMemo(
    () => (preview && !short ? renderMarkdown(withoutTitle(preview.markdown, preview.title), vault.links) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawn again once KaTeX or the highlighter loads
    [preview, short, vault.links, extras],
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

/* ---------- The graph ---------- */

/** A card as a dot in the graph: its colour, sized by its connections, named beside it. */
function GraphDot({ data, selected }: NodeProps<CardNode>) {
  const r = dotRadius(data.degree ?? 0);
  const color = colorValue(data.c.color);
  const label = cardLabel(data.c);
  return (
    <>
      <div
        className={`canvas-dot ${selected ? "is-selected" : ""}`}
        style={{ width: r * 2, height: r * 2, ...(color ? ({ "--card-color": color } as React.CSSProperties) : {}) }}
        title={data.c.type === "file" ? `${label} (double-click to open)` : label}
      />
      <span className="canvas-dot-label" style={{ top: r * 2 + 4 }}>
        {label}
      </span>
      <Handle type="source" position={Position.Top} className="canvas-dot-handle" isConnectable={false} />
    </>
  );
}

/** A line between two dots: an arrow (with its ends and label), or a faint link between notes. */
function GraphLine({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<ArrowEdge>) {
  const c = data?.c;
  const [r1, r2] = data?.radii ?? [0, 0];
  // The handles sit at the dots' centres: start and end the line at their rims.
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const start = c?.fromEnd === "arrow";
  const end = !data?.link && c?.toEnd !== "none";
  const [path, labelX, labelY] = getStraightPath({
    sourceX: sourceX + ux * (r1 + (start ? 3 : 1)),
    sourceY: sourceY + uy * (r1 + (start ? 3 : 1)),
    targetX: targetX - ux * (r2 + (end ? 3 : 1)),
    targetY: targetY - uy * (r2 + (end ? 3 : 1)),
  });
  if (data?.link) {
    return <BaseEdge id={id} path={path} className="canvas-note-link" interactionWidth={0} />;
  }
  const own = colorValue(c?.color);
  const color = selected ? (own ?? "var(--accent)") : (own ?? "var(--canvas-arrow)");
  const markerId = `graph-arrow-${id}`;
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
        markerStart={start ? `url(#${markerId})` : undefined}
        style={{ stroke: color, strokeWidth: selected ? 2.25 : 1.75, strokeDasharray: c ? dashPattern(c) : undefined, strokeLinecap: "round" }}
        interactionWidth={14}
      />
      {c?.label && (
        <EdgeLabelRenderer>
          <div
            className="canvas-edge-label nodrag nopan absolute rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, color: own }}
          >
            {c.label}
          </div>
        </EdgeLabelRenderer>
      )}
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

/** The board's card and arrow components, by type. */
export const NODE_TYPES = { text: TextCard, file: FileCard, link: LinkCard, group: GroupCard, dot: GraphDot };
export const EDGE_TYPES = { canvas: CanvasArrow, graph: GraphLine };
