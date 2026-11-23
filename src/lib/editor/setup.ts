import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, Prec, type Extension } from "@codemirror/state";
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
  exitEmptyListItem,
} from "./formatting";
import { FrontmatterSyntax } from "./frontmatter-syntax";
import { highlightTag, HighlightSyntax } from "./highlight-syntax";
import { liveBlocks } from "./live-blocks";
import { livePreview } from "./live-preview";
import { tableGridExtensions, tableGridOn } from "./table-grid";
import { tableEditing } from "./table-keys";
import { tagHighlighter } from "./tags";
import { completeProperties, propertyExtensions } from "./properties";
import { propertiesPanel } from "./properties-panel";
import { completeLinks, linkHost, livePreviewOn, WikiLinkSyntax, wikilinkExtensions, type LinkHost } from "./wikilinks";
import { completeSlash } from "./slash";

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
  { tag: [t.processingInstruction, t.contentSeparator], class: "cm-md-syntax" },
  { tag: t.meta, class: "cm-md-frontmatter" },
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
    fontSize: "var(--editor-font-size, 16px)",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--note-font)",
    lineHeight: "1.65",
  },
  ".cm-content": {
    maxWidth: "var(--line-width, 46rem)",
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

/** The browser's spell checker on or off. Reconfigure with `spellcheckMode.reconfigure(...)`. */
export const spellcheckMode = new Compartment();

/** CodeMirror turns spell checking off by default; this turns it (and phone autocorrect) back on. */
export function spellcheckExtension(on: boolean): Extension {
  return EditorView.contentAttributes.of(
    on
      ? { spellcheck: "true", autocorrect: "on", autocapitalize: "sentences" }
      : { spellcheck: "false", autocorrect: "off", autocapitalize: "off" },
  );
}

/** Live preview on or off. Reconfigure with `livePreviewMode.reconfigure(...)`. */
export const livePreviewMode = new Compartment();

/** Live preview, with tables edited as grids unless `tables` is "markdown". */
export function livePreviewExtension(on: boolean, tables: "grid" | "markdown" = "grid"): Extension {
  return on
    ? [
        livePreview,
        liveBlocks,
        propertiesPanel,
        livePreviewOn.of(true),
        tableGridOn.of(tables === "grid"),
        EditorView.contentAttributes.of({ class: "cm-live-preview" }),
      ]
    : [];
}

export function editorExtensions(opts: {
  livePreview: boolean;
  tables?: "grid" | "markdown";
  onChange: (doc: string) => void;
  links?: LinkHost;
  spellcheck?: boolean;
}): Extension {
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
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [FrontmatterSyntax, HighlightSyntax, WikiLinkSyntax] }),
    syntaxHighlighting(markdownHighlight),
    tagHighlighter,
    ...(opts.links ? [linkHost.of(opts.links), wikilinkExtensions()] : []),
    autocompletion({ override: [completeLinks, completeProperties, (ctx) => completeSlash(ctx)], icons: false }),
    // Ahead of the markdown keymap's Enter, which would make the list "loose" instead of
    // ending it; after autocompletion's, so Enter still picks a suggestion.
    Prec.highest(keymap.of([{ key: "Enter", run: exitEmptyListItem }])),
    propertyExtensions(),
    tableGridExtensions(),
    tableEditing(),
    keymap.of([
      ...completionKeymap,
      ...formattingKeymap,
      ...closeBracketsKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    livePreviewMode.of(livePreviewExtension(opts.livePreview, opts.tables)),
    spellcheckMode.of(spellcheckExtension(opts.spellcheck ?? true)),
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
  ];
}
