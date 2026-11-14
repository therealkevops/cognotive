import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  placeholder,
  rectangularSelection,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import {
  insertLink,
  setHeading,
  toggleBold,
  toggleHighlight,
  toggleInlineCode,
  toggleItalic,
  toggleLinePrefix,
  toggleStrikethrough,
  toggleTaskDone,
} from "./formatting";
import { highlightTag, HighlightSyntax } from "./highlight-syntax";
import { livePreview } from "./live-preview";

/** Formatting shortcuts. "Mod" is Cmd on macOS and Ctrl elsewhere. */
export const formattingKeymap = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-Shift-x", run: toggleStrikethrough },
  { key: "Mod-Shift-h", run: toggleHighlight },
  { key: "Mod-`", run: toggleInlineCode },
  { key: "Mod-k", run: insertLink },
  { key: "Mod-Alt-0", run: setHeading(0) },
  { key: "Mod-Alt-1", run: setHeading(1) },
  { key: "Mod-Alt-2", run: setHeading(2) },
  { key: "Mod-Alt-3", run: setHeading(3) },
  { key: "Mod-Shift-7", run: toggleLinePrefix("ordered") },
  { key: "Mod-Shift-8", run: toggleLinePrefix("bullet") },
  { key: "Mod-Shift-9", run: toggleLinePrefix("task") },
  { key: "Mod-Enter", run: toggleTaskDone },
];

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.75em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.45em", fontWeight: "700" },
  { tag: t.heading3, fontSize: "1.25em", fontWeight: "650" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "650" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: highlightTag, class: "cm-md-highlight" },
  { tag: t.link, class: "cm-md-link" },
  { tag: t.url, class: "cm-md-url" },
  { tag: t.monospace, class: "cm-md-code" },
  { tag: t.quote, class: "cm-md-quote" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], class: "cm-md-syntax" },
  // Code inside fenced blocks (via language-data).
  { tag: [t.keyword, t.modifier, t.operatorKeyword], class: "cm-tok-keyword" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "cm-tok-string" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "cm-tok-number" },
  { tag: [t.comment, t.lineComment, t.blockComment], class: "cm-tok-comment" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "cm-tok-fn" },
  { tag: [t.typeName, t.className], class: "cm-tok-type" },
]);

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "16px",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-sans), system-ui, sans-serif",
    lineHeight: "1.65",
  },
  ".cm-content": {
    maxWidth: "46rem",
    margin: "0 auto",
    padding: "2rem 1.5rem 40vh",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-placeholder": { color: "var(--muted)" },
  ".cm-panels": { backgroundColor: "var(--surface)", color: "var(--foreground)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 20%, transparent)" },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)" },
});

/** Live preview on or off. Reconfigure with `livePreviewMode.reconfigure(...)`. */
export const livePreviewMode = new Compartment();

export function livePreviewExtension(on: boolean): Extension {
  return on ? [livePreview, EditorView.contentAttributes.of({ class: "cm-live-preview" })] : [];
}

export function editorExtensions(opts: { livePreview: boolean; onChange: (doc: string) => void }): Extension {
  return [
    history(),
    drawSelection(),
    rectangularSelection(),
    indentOnInput(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: false }),
    EditorView.lineWrapping,
    placeholder("Start writing…"),
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [HighlightSyntax] }),
    syntaxHighlighting(markdownHighlight),
    keymap.of([
      ...formattingKeymap,
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    livePreviewMode.of(livePreviewExtension(opts.livePreview)),
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
  ];
}
