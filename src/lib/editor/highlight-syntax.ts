import { Tag, tags } from "@lezer/highlight";
import type { DelimiterType, MarkdownConfig } from "@lezer/markdown";

/** Highlight tag for `==text==`, styled by the editor theme. */
export const highlightTag = Tag.define();

const HighlightDelim: DelimiterType = { resolve: "Highlight", mark: "HighlightMark" };
const EQUALS = 61;
const PUNCT = /[!-/:-@[-`{-~¡-¿‐-‧‰-⁞]/;

/**
 * Lezer markdown extension parsing Obsidian's `==highlight==`, using the same
 * flanking rules as GFM strikethrough.
 */
export const HighlightSyntax: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": highlightTag } },
    { name: "HighlightMark", style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS)
          return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = PUNCT.test(before);
        const pAfter = PUNCT.test(after);
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter),
        );
      },
      after: "Emphasis",
    },
  ],
};
