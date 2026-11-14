import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Facet, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  hoverTooltip,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";
import { splitLinkText } from "../links/parse";

/** What the editor needs from the app to work with links. */
export interface LinkHost {
  /** Resolves a link target from the current note; null if no such note. */
  resolve(target: string): string | null;
  /** Opens a link target, creating the note if needed. */
  open(target: string, heading?: string): void;
  /** Notes to offer when typing "[[". */
  notes(): Array<{ title: string; path: string; aliases: string[]; linkText: string }>;
  headings(path: string): string[];
  /** A short plain-text preview of a note, for hover cards. */
  preview(path: string): string;
}

export const linkHost = Facet.define<LinkHost, LinkHost | null>({
  combine: (values) => values[values.length - 1] ?? null,
});

/** Set by the live preview compartment so link clicks know whether syntax is hidden. */
export const livePreviewOn = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

const OPEN = 91; // [
const BANG = 33; // !
const CLOSE = 93; // ]

/** Lezer extension: `[[target#heading|alias]]` and `![[embed]]` as WikiLink nodes. */
export const WikiLinkSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "WikiLink", style: tags.link },
    { name: "WikiLinkMark", style: tags.processingInstruction },
    { name: "WikiLinkTarget" },
  ],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        const embed = next === BANG;
        const start = embed ? pos + 1 : pos;
        if (cx.char(start) !== OPEN || cx.char(start + 1) !== OPEN) return -1;
        for (let i = start + 2; i < cx.end - 1; i++) {
          const c = cx.char(i);
          if (c === 10) return -1;
          if (c === CLOSE && cx.char(i + 1) === CLOSE) {
            if (i === start + 2) return -1; // "[[]]"
            const end = i + 2;
            return cx.addElement(
              cx.elt("WikiLink", pos, end, [
                cx.elt("WikiLinkMark", pos, start + 2),
                cx.elt("WikiLinkTarget", start + 2, i),
                cx.elt("WikiLinkMark", i, end),
              ]),
            );
          }
        }
        return -1;
      },
      before: "Link",
    },
  ],
};

export interface WikiLinkAt {
  from: number;
  to: number;
  target: string;
  heading?: string;
  alias?: string;
  /** Where the visible text starts/ends (after "[[", before "]]"). */
  innerFrom: number;
  innerTo: number;
}

/** The wikilink node around `pos`, if any. */
export function wikiLinkAt(state: EditorState, pos: number, side: -1 | 1 = 1): WikiLinkAt | null {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, side); n; n = n.parent) {
    if (n.name === "WikiLink") {
      const inner = n.getChild("WikiLinkTarget");
      if (!inner) return null;
      const parts = splitLinkText(state.sliceDoc(inner.from, inner.to));
      return { from: n.from, to: n.to, innerFrom: inner.from, innerTo: inner.to, ...parts };
    }
  }
  return null;
}

/** Styles every wikilink, marks unresolved ones, and tags them for clicks. */
const linkMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = this.build(u.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const host = view.state.facet(linkHost);
      const out: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (n) => {
            if (n.name !== "WikiLink") return;
            const inner = n.node.getChild("WikiLinkTarget");
            if (!inner) return false;
            const { target } = splitLinkText(view.state.sliceDoc(inner.from, inner.to));
            const resolved = !target || !host || host.resolve(target) !== null;
            out.push(
              Decoration.mark({
                class: resolved ? "cm-wikilink" : "cm-wikilink cm-wikilink-unresolved",
                attributes: { "data-wikilink": "", title: resolved ? "" : "Not created yet. Click to create." },
              }).range(inner.from, inner.to),
            );
            return false;
          },
        });
      }
      return Decoration.set(out, true);
    }
  },
  { decorations: (v) => v.decorations },
);

const isMod = (e: MouseEvent) => (/Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey);

/**
 * Ctrl/Cmd-click opens a link anywhere. In live preview, a plain click on a
 * rendered link (syntax hidden) opens it too, as in Obsidian.
 */
const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const host = view.state.facet(linkHost);
    if (!host) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;

    const wl = wikiLinkAt(view.state, pos);
    if (wl) {
      const touched = view.state.selection.ranges.some((r) => r.from <= wl.to && r.to >= wl.from);
      const rendered = view.state.facet(livePreviewOn) && !touched;
      if (!isMod(event) && !rendered) return false;
      event.preventDefault();
      host.open(wl.target, wl.heading);
      return true;
    }

    // Markdown links to local notes: [text](Note.md)
    if (!isMod(event)) return false;
    for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
      if (n.name !== "Link") continue;
      const url = n.getChild("URL");
      if (!url) return false;
      const href = view.state.sliceDoc(url.from, url.to);
      event.preventDefault();
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
      else {
        const { target, heading } = splitLinkText(decodeURIComponentSafe(href));
        host.open(target, heading);
      }
      return true;
    }
    return false;
  },
});

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Typing "[[" offers notes (and aliases); "[[Note#" offers that note's headings. */
function completeLinks(ctx: CompletionContext): CompletionResult | null {
  const host = ctx.state.facet(linkHost);
  if (!host) return null;
  const before = ctx.matchBefore(/!?\[\[[^\[\]\n]*$/);
  if (!before) return null;
  const open = before.text.indexOf("[[") + 2;
  const typed = before.text.slice(open);
  if (typed.includes("|")) return null;
  const from = before.from + open;
  const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2);
  const closing = after === "]]" ? "" : "]]";

  const hash = typed.indexOf("#");
  if (hash !== -1) {
    const path = host.resolve(typed.slice(0, hash));
    if (!path) return null;
    const options: Completion[] = host.headings(path).map((h) => ({
      label: h,
      type: "heading",
      apply: (view, _c, f, t) => {
        const insert = h + closing;
        view.dispatch({
          changes: { from: f, to: t, insert },
          selection: { anchor: f + insert.length + (closing ? 0 : 2) },
        });
      },
    }));
    return { from: from + hash + 1, options, validFor: /^[^\]\n#|]*$/ };
  }

  const options: Completion[] = [];
  for (const n of host.notes()) {
    const apply = (text: string) => (view: EditorView, _c: Completion, f: number, t: number) => {
      const insert = text + closing;
      view.dispatch({
        changes: { from: f, to: t, insert },
        selection: { anchor: f + insert.length + (closing ? 0 : 2) },
      });
    };
    const folder = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : undefined;
    options.push({ label: n.title, detail: folder, type: "note", apply: apply(n.linkText) });
    for (const a of n.aliases) {
      options.push({ label: a, detail: `→ ${n.title}`, type: "alias", apply: apply(`${n.linkText}|${a}`) });
    }
  }
  return { from, options, validFor: /^[^\]\n#|]*$/ };
}

/** Hovering a wikilink shows the start of the linked note. */
const linkPreview = hoverTooltip(
  (view, pos, side) => {
    const host = view.state.facet(linkHost);
    const wl = wikiLinkAt(view.state, pos, side);
    if (!host || !wl || !wl.target) return null;
    const path = host.resolve(wl.target);
    return {
      pos: wl.innerFrom,
      end: wl.innerTo,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-link-preview";
        const title = document.createElement("div");
        title.className = "cm-link-preview-title";
        title.textContent = path ? path.replace(/\.md$/, "") : wl.target;
        const body = document.createElement("div");
        body.className = "cm-link-preview-body";
        body.textContent = path ? host.preview(path) || "(empty note)" : "This note doesn't exist yet. Click the link to create it.";
        dom.append(title, body);
        return { dom };
      },
    };
  },
  { hoverTime: 400 },
);

export function wikilinkExtensions(): Extension {
  return [linkMarks, linkClicks, linkPreview, autocompletion({ override: [completeLinks], icons: false })];
}
