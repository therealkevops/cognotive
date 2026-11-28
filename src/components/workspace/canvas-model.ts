/** The canvas file's cards and arrows as React Flow nodes and edges, and back. */

import { Position, type Edge, type Node } from "@xyflow/react";
import { type CanvasData, type CanvasEdge, type CanvasNode, type Side } from "@/lib/canvas/format";
import { isDrawing, isImage } from "@/lib/vault/paths";
import type { PropertyInfo } from "@/lib/editor/properties";
import type { LinkContext } from "@/lib/markdown/remark-links";

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
  /** Links between these notes (each from one of them to another), for the graph. */
  noteLinks?(paths: string[]): Array<{ from: string; to: string }>;
  /** A note's properties, to edit from its card (writes into the note). */
  noteProperties?(path: string): {
    properties: Record<string, unknown>;
    info: PropertyInfo;
    set(key: string, value: unknown): void;
  } | null;
}


export type CardData = { c: CanvasNode; /** In the graph: lines meeting the dot. */ degree?: number };
export type ArrowData = {
  c: CanvasEdge;
  /** In the graph: a link between two cards' notes rather than an arrow; and the dots' radii. */
  link?: boolean;
  radii?: [number, number];
};
export type CardNode = Node<CardData>;
export type ArrowEdge = Edge<ArrowData>;

export const SIDE_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

export function toCard(c: CanvasNode): CardNode {
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

export function toArrow(c: CanvasEdge): ArrowEdge {
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
export const TITLE_ONLY_HEIGHT = 42;

/** A card set to show its title only, whatever the view (kept in the canvas file). */
export const titleOnly = (c: CanvasNode) => c.titleOnly === true;

/** Cards that shrink to their title when the view shows titles only (pictures and groups don't). */
export function hasTitleView(c: CanvasNode): boolean {
  return c.type === "text" || c.type === "link" || (c.type === "file" && !isImage(c.file) && !isDrawing(c.file));
}

/** The canvas file contents for the board as it is now. */
export function toCanvas(nodes: CardNode[], edges: ArrowEdge[], extra: Record<string, unknown>): CanvasData {
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

