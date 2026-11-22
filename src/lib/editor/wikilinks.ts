import {
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Facet, Prec, type EditorState, type Extension, type Range } from "@codemirror/state";
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
import { blockIdChange, blockIds, listBlocks, newBlockId, type Block } from "../markdown/blocks";
import { linkBoost } from "../links/rank";
import type { PropertyInfo } from "./properties";
import { TREE_DRAG_TYPE } from "../vault/drag";

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
  /**
   * Notes to offer when typing "[[". `recentRank` is 0 for the note opened most
   * recently; `inbound` is how many notes link to it. Both only rank suggestions.
   */
  notes(): Array<{ title: string; path: string; aliases: string[]; linkText: string; recentRank?: number; inbound?: number }>;
  /** The shortest unambiguous link text for a file dragged in from the file tree; null for a folder. */
  linkText?(path: string): string | null;
  /**
   * The vault's link format applied to a wikilink: given "Note#Heading|alias",
   * the link to insert instead (a markdown link), or null to keep the wikilink.
   */
  formatLink?(inner: string, embed: boolean): string | null;
  /** The path of the note being edited. */
  currentPath?(): string | null;
  /** The saved text of another note, for listing its blocks. */
  noteContent?(path: string): string | undefined;
  /** Gives a block in another note the id `id` (" ^id" at its end), saving that note. */
  addBlockId?(path: string, block: Block, id: string): void;
  /** Opens a note picker that links the selection to the chosen note (Ctrl/Cmd+Shift+K). */
  linkSelection?(): void;
  /** A live query block's results, as markdown (see src/lib/query). */
  queryMarkdown?(source: string, lang: "query" | "dataview"): string;
  /** Asks the AI about the selection (Ctrl/Cmd+Shift+Enter; Ctrl+Shift+A is taken by Chrome's tab search). */
  askSelection?(): void;
  headings(path: string): string[];
  /**
   * What a hover card shows for a link: the note (or its heading section or
   * block), or an embed of an image or drawing. Null if the target doesn't exist.
   */
  notePreview?(target: string, sub?: string): { title: string; markdown: string } | null;
  /** Hover cards: always, or only while Ctrl/Cmd is held. */
  hoverPreview?(): "always" | "mod";
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
  /** Property names, values and tags used across the repository, for suggestions in the properties block. */
  propertyInfo?(): PropertyInfo;
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
export function completeLinks(ctx: CompletionContext): CompletionResult | null {
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
    // "[[#..." means this note; so does a link that names it.
    const targetText = typed.slice(0, hash);
    const path = targetText ? host.resolve(targetText) : null;
    if (targetText && !path) return null;
    const here = !targetText || path === host.currentPath?.();
    if (typed.slice(hash + 1).startsWith("^")) {
      return blockCompletions(ctx, host, here ? null : path!, from + hash + 2, closing);
    }
    const headings = here ? headingsIn(ctx.state.doc.toString()) : host.headings(path!);
    const options: Completion[] = headings.map((h) => ({
      label: h,
      type: "heading",
      apply: (view, _c, f, t) => {
        const insert = h + closing;
        view.dispatch({
          changes: { from: f, to: t, insert },
          selection: { anchor: f + insert.length + (closing ? 0 : 2) },
          userEvent: "input.complete",
        });
      },
    }));
    return { from: from + hash + 1, options, validFor: /^[^\]\n#|^]*$/ };
  }

  const apply = (text: string) => (view: EditorView, _c: Completion, f: number, t: number) => {
    const insert = text + closing;
    view.dispatch({
      changes: { from: f, to: t, insert },
      selection: { anchor: f + insert.length + (closing ? 0 : 2) },
      userEvent: "input.complete",
    });
  };
  const options: Completion[] = [];
  const notes = host.notes();
  for (const n of notes) {
    const boost = linkBoost(n);
    const folder = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : undefined;
    options.push({ label: n.title, detail: folder, type: "note", boost, apply: apply(n.linkText) });
    for (const a of n.aliases) {
      options.push({ label: a, detail: `→ ${n.title}`, type: "alias", boost, apply: apply(`${n.linkText}|${a}`) });
    }
  }
  // When no note has exactly this name, offer to link to a new one (created when the link is opened).
  const name = typed.trim();
  const lower = name.toLowerCase();
  if (
    name &&
    !notes.some(
      (n) =>
        n.title.toLowerCase() === lower ||
        n.linkText.toLowerCase() === lower ||
        n.aliases.some((a) => a.toLowerCase() === lower),
    )
  ) {
    // In its own section, so it always comes after the notes that match.
    options.push({
      label: typed,
      detail: "New note",
      type: "new-note",
      section: { name: "Not created yet", rank: 1 },
      apply: apply(name),
    });
  }
  // No validFor: the list is rebuilt on each keystroke so the "New note" entry follows the typing.
  return { from, options };
}

/** Headings of a note, outside code fences. */
function headingsIn(markdown: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m && m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * "[[Note#^" suggests the note's paragraphs, list items and quotes. Picking one
 * without an id gives it a new one (" ^a1b2c3" at its end), as Obsidian does.
 * `path` null means the note being edited, which is changed in the same edit.
 */
function blockCompletions(
  ctx: CompletionContext,
  host: LinkHost,
  path: string | null,
  from: number,
  closing: string,
): CompletionResult | null {
  const content = path ? host.noteContent?.(path) : ctx.state.doc.toString();
  if (content === undefined) return null;
  const blocks = listBlocks(content).filter((b) => path || !(b.from <= ctx.pos && ctx.pos <= b.to + 2));
  const options: Completion[] = blocks.map((b, index) => ({
    label: b.text,
    detail: b.id ? `^${b.id}` : undefined,
    type: "block",
    apply: (view: EditorView, _c: Completion, f: number, t: number) => {
      let id = b.id;
      const changes: Array<{ from: number; to?: number; insert: string }> = [];
      if (!id) {
        if (path) {
          id = newBlockId(blockIds(content));
          host.addBlockId?.(path, b, id);
        } else {
          // This note may have changed since the list was made: find the block again.
          const doc = view.state.doc.toString();
          const now = listBlocks(doc).filter((x) => !(x.from <= f && f <= x.to + 2));
          const same = now[index]?.text === b.text ? now[index] : now.find((x) => x.text === b.text);
          id = same?.id ?? newBlockId(blockIds(doc));
          if (same && !same.id) changes.push(blockIdChange(same, id));
        }
      }
      changes.push({ from: f, to: t, insert: id + closing });
      const set = view.state.changes(changes);
      view.dispatch({ changes: set, selection: { anchor: set.mapPos(t, 1) + (closing ? 0 : 2) }, userEvent: "input.complete" });
    },
  }));
  return { from, options, filter: true };
}

/** Loads images and drawings in rendered HTML (they carry their vault path in data-asset). */
export function fillAssets(el: HTMLElement, host: LinkHost) {
  for (const img of el.querySelectorAll<HTMLImageElement>("img[data-asset]")) {
    void host.fileUrl?.(img.dataset.asset!).then((url) => {
      if (url) img.src = url;
      else img.classList.add("embed-missing");
    });
  }
}

/** Whether Ctrl/Cmd was held at the last pointer move or key press over the editor. */
let modHeld = false;
const trackMod = EditorView.domEventHandlers({
  mousemove(e) {
    modHeld = hasModKey(e);
  },
  keydown(e) {
    modHeld = hasModKey(e) || e.key === "Control" || e.key === "Meta";
  },
  keyup(e) {
    modHeld = hasModKey(e);
  },
});

/**
 * Hovering a link shows the linked note rendered: formatting, images and
 * drawings, scrollable. A heading or block link shows just that part. Click
 * the card's title to open the note (Ctrl/Cmd-click: new tab).
 */
const linkPreview = hoverTooltip(
  (view, pos, side) => {
    const host = view.state.facet(linkHost);
    const wl = wikiLinkAt(view.state, pos, side);
    if (!host || !wl || !wl.target) return null;
    if (host.hoverPreview?.() === "mod" && !modHeld) return null;
    const sub = wl.heading ?? (wl.block ? `^${wl.block}` : undefined);
    const preview = host.notePreview?.(wl.target, sub) ?? null;
    return {
      pos: wl.innerFrom,
      end: wl.innerTo,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-link-preview";
        dom.setAttribute("role", "dialog");
        dom.setAttribute("aria-label", "Link preview");
        const title = document.createElement("button");
        title.type = "button";
        title.className = "cm-link-preview-title";
        title.textContent = preview ? preview.title : wl.target;
        title.title = "Open (Ctrl/Cmd-click: new tab)";
        title.addEventListener("mousedown", (e) => {
          e.preventDefault();
          host.open(wl.target, sub, openHow(e));
        });
        const body = document.createElement("div");
        body.className = "cm-link-preview-body prose-note";
        if (!preview) {
          body.textContent = "This note doesn't exist yet. Open the link to create it.";
        } else if (!preview.markdown.trim()) {
          body.textContent = sub ? "Nothing found at this heading or block." : "(empty note)";
        } else {
          body.textContent = preview.markdown; // until rendered
          void host.renderHtml?.(preview.markdown).then((html) => {
            body.innerHTML = html; // sanitized by the markdown pipeline
            fillAssets(body, host);
          });
        }
        // Links inside the card open like links anywhere else.
        body.addEventListener("click", (e) => {
          const a = (e.target as HTMLElement).closest("a");
          if (!a?.classList.contains("internal-link")) return;
          e.preventDefault();
          const parts = splitLinkText(a.dataset.href ?? "");
          host.open(parts.target, parts.heading ?? (parts.block ? `^${parts.block}` : undefined), openHow(e));
        });
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
  dragover(event, view) {
    // Accept files dragged from the file tree (the browser only accepts text by default).
    if (!view.state.facet(linkHost) || !event.dataTransfer?.types.includes(TREE_DRAG_TYPE)) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = "link";
    return true;
  },
  drop(event, view) {
    const host = view.state.facet(linkHost);
    // A note or file dragged from the file tree: insert a link to it.
    const dragged = event.dataTransfer?.getData(TREE_DRAG_TYPE);
    if (host && dragged) {
      event.preventDefault();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      const text = host.linkText ? host.linkText(dragged) : dragged.replace(/\.md$/i, "");
      if (!text) return true; // a folder: nothing to link
      const embed = /\.(png|jpe?g|gif|webp|svg|avif|bmp|excalidraw)$/i.test(dragged) || /\.excalidraw\.md$/i.test(dragged);
      const insert = host.formatLink?.(text, embed) ?? `${embed ? "!" : ""}[[${text}]]`;
      view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, userEvent: "input.drop" });
      view.focus();
      return true;
    }
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
  const insert = links.map((l) => host.formatLink?.(l, true) ?? `![[${l}]]`).join("\n") + tail;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length - tail.length },
    userEvent: "input.paste",
  });
}

/**
 * Typing "[" with text selected, right after another "[" that already wraps
 * it, makes "[[selection]]" and opens link suggestions for it, as in Obsidian.
 */
// Highest precedence: closeBrackets would otherwise wrap the selection in "[...]" again.
const wrapSelection = Prec.highest(EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "[" || from === to || !view.state.facet(linkHost)) return false;
  const doc = view.state.doc;
  if (doc.sliceString(from - 1, from) !== "[" || doc.sliceString(to, to + 1) !== "]") return false;
  if (doc.sliceString(from, to).includes("\n")) return false;
  view.dispatch({
    changes: [
      { from, insert: "[" },
      { from: to, insert: "]" },
    ],
    selection: EditorSelection.cursor(to + 1),
    userEvent: "input.type",
  });
  startCompletion(view);
  return true;
}));

/** Ctrl/Cmd+Shift+K: link the selection to a note picked from a list. */
const linkSelectionKey = Prec.high(
  keymap.of([
    {
      key: "Mod-Shift-k",
      run: (view) => {
        const host = view.state.facet(linkHost);
        if (!host?.linkSelection) return false;
        host.linkSelection();
        return true;
      },
    },
    {
      key: "Mod-Shift-Enter",
      run: (view) => {
        const host = view.state.facet(linkHost);
        if (!host?.askSelection || view.state.selection.main.empty) return false;
        host.askSelection();
        return true;
      },
    },
  ]),
);

/**
 * With markdown links chosen for the vault, a link picked from the [[
 * suggestions is turned into a markdown link as soon as it's complete.
 */
const markdownAfterComplete = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate) {
      if (!u.transactions.some((tr) => tr.isUserEvent("input.complete"))) return;
      const host = u.state.facet(linkHost);
      if (!host?.formatLink) return;
      const head = u.state.selection.main.head;
      const wl = head > 0 ? wikiLinkAt(u.state, head - 1, -1) : null;
      if (!wl || wl.to !== head) return;
      const embed = u.state.sliceDoc(wl.from, wl.from + 1) === "!";
      const replacement = host.formatLink(u.state.sliceDoc(wl.innerFrom, wl.innerTo), embed);
      if (!replacement) return;
      const view = u.view;
      // Can't dispatch during an update; do it right after.
      queueMicrotask(() => {
        if (view.state.sliceDoc(wl.from, wl.to) !== u.state.sliceDoc(wl.from, wl.to)) return;
        view.dispatch({
          changes: { from: wl.from, to: wl.to, insert: replacement },
          selection: { anchor: wl.from + replacement.length },
          userEvent: "input.complete.format",
        });
      });
    }
  },
);

export function wikilinkExtensions(): Extension {
  return [
    wrapSelection,
    linkSelectionKey,
    markdownAfterComplete,
    linkMarks,
    linkClicks,
    followKeys,
    trackMod,
    linkPreview,
    fileDrops,
  ];
}
