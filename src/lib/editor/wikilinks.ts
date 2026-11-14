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
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";
import { hasModKey, openHow, type OpenHow } from "../links/open";
import { splitLinkText } from "../links/parse";

/** What the editor needs from the app to work with links. */
export interface LinkHost {
  /** Resolves a link target from the current note; null if no such note. */
  resolve(target: string): string | null;
  /**
   * Opens a link target, creating the note if needed. `sub` is a heading, or
   * "^id" for a block. `how`: this tab (default), a new tab, or the side pane.
   */
  open(target: string, sub?: string, how?: OpenHow): void;
  /** Whether a plain click on a link in live preview follows it (true) or edits it. */
  clickFollows?(): boolean;
  /** Notes to offer when typing "[[". */
  notes(): Array<{ title: string; path: string; aliases: string[]; linkText: string }>;
  headings(path: string): string[];
  /** A short plain-text preview of a note, for hover cards. */
  preview(path: string): string;
  /** If `target` resolves to an image or drawing, its path (for inline embeds). */
  embedPath?(target: string): string | null;
  /** A displayable URL for an image or drawing. */
  fileUrl?(path: string): Promise<string | null>;
  /** Saves pasted or dropped files as attachments; returns the link text for each. */
  saveFiles?(files: File[]): Promise<string[]>;
  /** Renders markdown to sanitized HTML (tables and embeds in live preview). */
  renderHtml?(markdown: string): Promise<string>;
  /** If `inner` ("Note#Heading") embeds a note, the markdown to show and a title. */
  noteEmbed?(inner: string): { markdown: string; title: string } | null;
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
  block?: string;
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

/** Event a page sends when settings that change how links behave are saved. */
const SETTINGS_EVENT = "noted-appearance";

/** The ↗ button after a link in live preview, when a plain click edits links. */
class FollowWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly sub: string | undefined,
  ) {
    super();
  }
  eq(other: FollowWidget) {
    return other.target === this.target && other.sub === this.sub;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-link-follow";
    el.textContent = "↗";
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Open ${this.target || "link"}`);
    el.title = "Open link (Ctrl/Cmd-click: new tab, Ctrl/Cmd+Alt-click: side pane)";
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      view.state.facet(linkHost)?.open(this.target, this.sub, openHow(e));
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/** Styles every wikilink, marks unresolved ones, and tags them for clicks. */
const linkMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    follows: boolean;
    onSettings: () => void;
    constructor(readonly view: EditorView) {
      this.follows = this.clickFollows(view);
      this.decorations = this.build(view);
      // Rebuild when the click setting changes, so the ↗ buttons appear or go.
      this.onSettings = () => view.dispatch({});
      window.addEventListener(SETTINGS_EVENT, this.onSettings);
    }
    destroy() {
      window.removeEventListener(SETTINGS_EVENT, this.onSettings);
    }
    clickFollows(view: EditorView) {
      return view.state.facet(linkHost)?.clickFollows?.() ?? true;
    }
    update(u: ViewUpdate) {
      const follows = this.clickFollows(u.view);
      if (
        u.docChanged ||
        u.viewportChanged ||
        follows !== this.follows ||
        u.startState.facet(livePreviewOn) !== u.state.facet(livePreviewOn) ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.follows = follows;
        this.decorations = this.build(u.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const host = view.state.facet(linkHost);
      const followButtons = view.state.facet(livePreviewOn) && !this.follows;
      const out: Range<Decoration>[] = [];
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(view.state).iterate({
          from,
          to,
          enter: (n) => {
            if (n.name !== "WikiLink") return;
            const inner = n.node.getChild("WikiLinkTarget");
            if (!inner) return false;
            const { target, heading, block } = splitLinkText(view.state.sliceDoc(inner.from, inner.to));
            const resolved = !target || !host || host.resolve(target) !== null;
            out.push(
              Decoration.mark({
                class: resolved ? "cm-wikilink" : "cm-wikilink cm-wikilink-unresolved",
                attributes: {
                  "data-wikilink": "",
                  title: resolved ? "" : this.follows ? "Not created yet. Click to create." : "Not created yet. Open it to create.",
                },
              }).range(inner.from, inner.to),
            );
            const embed = view.state.sliceDoc(n.from, n.from + 1) === "!";
            if (followButtons && !embed) {
              out.push(
                Decoration.widget({
                  widget: new FollowWidget(target, heading ?? (block ? `^${block}` : undefined)),
                  side: 1,
                }).range(n.to),
              );
            }
            return false;
          },
        });
      }
      return Decoration.set(out, true);
    }
  },
  { decorations: (v) => v.decorations },
);

/** A followable link at `pos`: a wikilink, or a markdown link to a note or a web page. */
function followableAt(state: EditorState, pos: number): { target: string; sub?: string; url?: string; from: number; to: number } | null {
  const wl = wikiLinkAt(state, pos);
  if (wl) return { target: wl.target, sub: wl.heading ?? (wl.block ? `^${wl.block}` : undefined), from: wl.from, to: wl.to };
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name !== "Link") continue;
    const url = n.getChild("URL");
    if (!url) return null;
    const href = state.sliceDoc(url.from, url.to);
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { target: "", url: href, from: n.from, to: n.to };
    const { target, heading, block } = splitLinkText(decodeURIComponentSafe(href));
    return { target, sub: heading ?? (block ? `^${block}` : undefined), from: n.from, to: n.to };
  }
  return null;
}

function follow(host: LinkHost, link: { target: string; sub?: string; url?: string }, how: OpenHow) {
  if (link.url) window.open(link.url, "_blank", "noopener,noreferrer");
  else host.open(link.target, link.sub, how);
}

/**
 * Following links with the mouse:
 * - Ctrl/Cmd-click opens a new tab, Ctrl/Cmd+Alt-click the side pane, and a
 *   middle click a new tab, anywhere.
 * - In live preview, a plain click on a rendered wikilink follows it if the
 *   "click a link to follow it" setting is on; otherwise it places the cursor
 *   to edit, and the ↗ button after the link follows it.
 */
const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 && event.button !== 1) return false;
    const host = view.state.facet(linkHost);
    if (!host) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const link = followableAt(view.state, pos);
    if (!link) return false;

    if (hasModKey(event) || event.button === 1) {
      event.preventDefault();
      follow(host, link, openHow(event));
      return true;
    }
    if (link.url || !wikiLinkAt(view.state, pos)) return false;
    const touched = view.state.selection.ranges.some((r) => r.from <= link.to && r.to >= link.from);
    const rendered = view.state.facet(livePreviewOn) && !touched;
    if (!rendered || !(host.clickFollows?.() ?? true)) return false;
    event.preventDefault();
    follow(host, link, "here");
    return true;
  },
});

/** Alt+Enter follows the link at the cursor (with Ctrl/Cmd too: in a new tab). */
const followKeys = keymap.of([
  {
    key: "Alt-Enter",
    run: (view) => followAtCursor(view, "here"),
  },
  {
    key: "Mod-Alt-Enter",
    run: (view) => followAtCursor(view, "tab"),
  },
]);

function followAtCursor(view: EditorView, how: OpenHow): boolean {
  const host = view.state.facet(linkHost);
  if (!host) return false;
  const head = view.state.selection.main.head;
  const link = followableAt(view.state, head) ?? (head > 0 ? followableAt(view.state, head - 1) : null);
  if (!link) return false;
  follow(host, link, how);
  return true;
}

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
        body.textContent = path ? host.preview(path) || "(empty note)" : "This note doesn't exist yet. Open the link to create it.";
        dom.append(title, body);
        return { dom };
      },
    };
  },
  { hoverTime: 400 },
);

/** Pasting or dropping files saves them as attachments and inserts ![[embeds]]. */
const fileDrops = EditorView.domEventHandlers({
  paste(event, view) {
    const host = view.state.facet(linkHost);
    const files = [...(event.clipboardData?.files ?? [])];
    if (!host?.saveFiles || files.length === 0) return false;
    event.preventDefault();
    void insertFiles(view, host, files, view.state.selection.main.from, view.state.selection.main.to);
    return true;
  },
  drop(event, view) {
    const host = view.state.facet(linkHost);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!host?.saveFiles || files.length === 0) return false;
    event.preventDefault();
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
    void insertFiles(view, host, files, pos, pos);
    return true;
  },
});

async function insertFiles(view: EditorView, host: LinkHost, files: File[], from: number, to: number) {
  const links = await host.saveFiles!(files);
  if (!links.length) return;
  // Keep embeds on their own line when dropped in front of existing text.
  const line = view.state.doc.lineAt(to);
  const tail = to < line.to ? "\n" : "";
  const insert = links.map((l) => `![[${l}]]`).join("\n") + tail;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length - tail.length },
    userEvent: "input.paste",
  });
}

export function wikilinkExtensions(): Extension {
  return [
    linkMarks,
    linkClicks,
    followKeys,
    linkPreview,
    fileDrops,
    autocompletion({ override: [completeLinks], icons: false }),
  ];
}
