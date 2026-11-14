import { syntaxTree } from "@codemirror/language";
import { Decoration, MatchDecorator, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

const tagMark = Decoration.mark({ class: "cm-tag" });
const SKIP = /Code|URL|Link|HeaderMark|Frontmatter|Comment/;

/** #tags styled while you type (not inside code, links or URLs). */
const decorator = new MatchDecorator({
  regexp: /(?<=^|[\s(,;])#[\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*/gu,
  decorate(add, from, to, _match, view) {
    for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(view.state).resolveInner(from, 1); n; n = n.parent) {
      if (SKIP.test(n.name)) return;
    }
    add(from, to, tagMark);
  },
});

export const tagHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorator.createDeco(view);
    }
    update(u: ViewUpdate) {
      // updateDeco only rescans when the viewport jumps; a viewport that grows
      // (e.g. after switching to a shorter note) needs a full pass too.
      this.decorations = u.viewportChanged ? decorator.createDeco(u.view) : decorator.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);
