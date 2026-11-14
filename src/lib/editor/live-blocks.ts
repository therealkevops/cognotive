import { ensureSyntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { fillAssets, linkHost, livePreviewOn } from "./wikilinks";

/**
 * A block of markdown shown rendered in live preview: a table, or an embedded
 * note. Rendering goes through the host (which lazy-loads the markdown
 * pipeline); clicking the block puts the cursor in its source to edit it.
 */
class RenderedBlock extends WidgetType {
  constructor(
    readonly markdown: string,
    readonly from: number,
    readonly kind: "table" | "embed",
    readonly title?: string,
  ) {
    super();
  }
  eq(other: RenderedBlock) {
    return other.markdown === this.markdown && other.from === this.from && other.kind === this.kind;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = `cm-rendered-block cm-rendered-${this.kind}`;
    if (this.title) {
      const t = document.createElement("div");
      t.className = "cm-rendered-title";
      t.textContent = this.title;
      wrap.append(t);
    }
    const body = document.createElement("div");
    body.className = "prose-note";
    body.textContent = this.markdown; // until rendered
    wrap.append(body);
    const host = view.state.facet(linkHost);
    void host?.renderHtml?.(this.markdown).then((html) => {
      body.innerHTML = html; // sanitized by the markdown pipeline
      fillAssets(body, host);
    });
    wrap.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
  get estimatedHeight() {
    return this.markdown.split("\n").length * 28;
  }
}

function touched(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

const EMBED_LINE = /^!\[\[([^\]\n]+?)\]\]\s*$/;

function build(state: EditorState): DecorationSet {
  if (!state.facet(livePreviewOn)) return Decoration.none;
  const host = state.facet(linkHost);
  const out: Range<Decoration>[] = [];
  const tree = ensureSyntaxTree(state, state.doc.length, 50);
  tree?.iterate({
    enter: (n) => {
      if (n.name !== "Table") return;
      const from = state.doc.lineAt(n.from).from;
      const to = state.doc.lineAt(n.to).to;
      if (!touched(state, from, to)) {
        out.push(
          Decoration.replace({ widget: new RenderedBlock(state.sliceDoc(from, to), from, "table"), block: true }).range(from, to),
        );
      }
      return false;
    },
  });
  // Lines that are only "![[Note]]" embed that note (images and drawings are inline widgets).
  if (host?.noteEmbed) {
    for (let i = 1; i <= state.doc.lines; i++) {
      const line = state.doc.line(i);
      const m = EMBED_LINE.exec(line.text);
      if (!m || touched(state, line.from, line.to)) continue;
      const embed = host.noteEmbed(m[1]);
      if (embed) {
        out.push(
          Decoration.replace({
            widget: new RenderedBlock(embed.markdown, line.from, "embed", embed.title),
            block: true,
          }).range(line.from, line.to),
        );
      }
    }
  }
  return Decoration.set(out, true);
}

/** Tables and note embeds rendered in place while editing in live preview. */
export const liveBlocks = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.reconfigured || tr.effects.length) return build(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
