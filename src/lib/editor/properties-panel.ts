import { startCompletion } from "@codemirror/autocomplete";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { parse as parseYaml } from "yaml";
import type { Command } from "./formatting";
import { frontmatterLines, PROPERTY_DOCS } from "./properties";
import { livePreviewOn } from "./wikilinks";

/**
 * Live preview shows a note's properties (its YAML frontmatter) as a panel of
 * name and value rows, like a form. Clicking a row shows the YAML at that
 * line to edit (with suggestions); "Add property" starts a new line and
 * offers names; a hub: true/false value is a checkbox.
 */

const KEY = /^([A-Za-z][\w-]*)\s*:/;

interface Row {
  key: string;
  value: unknown;
  /** Where the row's line is, and where its value ends (to put the cursor). */
  line: number;
  valueEnd: number;
}

/** The frontmatter as rows, or null when it can't be shown as a panel (invalid YAML, say). */
function readRows(state: EditorState, first: number, last: number): Row[] | null {
  if (last < first) return [];
  const doc = state.doc;
  const text = doc.sliceString(doc.line(first).from, doc.line(last).to);
  let data: unknown;
  try {
    data = parseYaml(text);
  } catch {
    return null;
  }
  if (data !== null && (typeof data !== "object" || Array.isArray(data))) return null;
  const values = (data ?? {}) as Record<string, unknown>;
  const rows: Row[] = [];
  for (let n = first; n <= last; n++) {
    const l = doc.line(n);
    const m = KEY.exec(l.text);
    if (!m) continue;
    // A value on the following indented lines (a "- item" list) ends with them.
    let end = n;
    while (end < last && /^\s+\S/.test(doc.line(end + 1).text)) end++;
    rows.push({ key: m[1], value: values[m[1]], line: n, valueEnd: doc.line(end).to });
  }
  return rows;
}

class PropertiesWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly rows: Row[],
  ) {
    super();
  }

  eq(other: PropertiesWidget) {
    return other.source === this.source;
  }

  toDOM(view: EditorView) {
    const outer = document.createElement("div");
    outer.className = "cm-properties-wrap";
    const wrap = document.createElement("div");
    wrap.className = "cm-properties";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Properties");
    outer.append(wrap);

    const list = document.createElement("dl");
    for (const row of this.rows) {
      const kind = PROPERTY_DOCS[row.key]?.kind;
      const item = document.createElement("div");
      item.className = "cm-property-row";
      item.title = PROPERTY_DOCS[row.key]?.doc ?? "";

      const dt = document.createElement("dt");
      dt.textContent = row.key;
      const dd = document.createElement("dd");

      if (kind === "boolean") {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = row.value === true || /^(true|yes)$/i.test(String(row.value ?? ""));
        box.setAttribute("aria-label", row.key);
        box.addEventListener("mousedown", (e) => e.stopPropagation());
        box.addEventListener("change", () => {
          const l = view.state.doc.line(row.line);
          const colon = l.text.indexOf(":");
          view.dispatch({ changes: { from: l.from + colon + 1, to: l.to, insert: ` ${box.checked}` }, userEvent: "input" });
        });
        dd.append(box);
      } else if (Array.isArray(row.value)) {
        if (row.value.length === 0) dd.append(empty());
        for (const v of row.value) {
          const chip = document.createElement("span");
          chip.className = row.key === "tags" ? "cm-property-chip cm-property-tag" : "cm-property-chip";
          chip.textContent = row.key === "tags" ? `#${String(v)}` : String(v);
          dd.append(chip);
        }
      } else if (row.value === null || row.value === undefined || row.value === "") {
        dd.append(empty());
      } else {
        dd.textContent = typeof row.value === "object" ? JSON.stringify(row.value) : String(row.value);
      }

      item.append(dt, dd);
      // Click a row to edit its YAML, with the cursor at the end of its value.
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        view.dispatch({ selection: { anchor: Math.min(row.valueEnd, view.state.doc.length) }, scrollIntoView: true });
        view.focus();
      });
      list.append(item);
    }
    wrap.append(list);

    const add = document.createElement("button");
    add.type = "button";
    add.className = "cm-property-add";
    add.textContent = "+ Add property";
    add.addEventListener("mousedown", (e) => {
      e.preventDefault();
      addProperty(view);
      view.focus();
    });
    wrap.append(add);
    return outer;

    function empty() {
      const s = document.createElement("span");
      s.className = "cm-property-empty";
      s.textContent = "empty";
      return s;
    }
  }

  ignoreEvent() {
    return true;
  }

  get estimatedHeight() {
    return 40 + this.rows.length * 28;
  }
}

function build(state: EditorState): DecorationSet {
  if (!state.facet(livePreviewOn)) return Decoration.none;
  const fm = frontmatterLines(state);
  if (!fm || !fm.closed) return Decoration.none;
  const from = 0;
  const to = state.doc.line(fm.last + 1).to;
  if (state.selection.ranges.some((r) => r.from <= to && r.to >= from)) return Decoration.none;
  const rows = readRows(state, fm.first, fm.last);
  // Invalid YAML stays as text, where the problem is underlined.
  if (!rows) return Decoration.none;
  const deco: Range<Decoration>[] = [
    Decoration.replace({ widget: new PropertiesWidget(state.sliceDoc(from, to), rows), block: true }).range(from, to),
  ];
  return Decoration.set(deco);
}

/** The properties panel in live preview. */
export const propertiesPanel = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.reconfigured || tr.effects.length) return build(tr.state);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Starts a new property: a new line at the end of the properties block (or a
 * new block at the top of the note), with the cursor there and property names
 * offered.
 */
export const addProperty: Command = (target) => {
  const { state, dispatch } = target;
  const fm = frontmatterLines(state);
  let anchor: number;
  if (fm && fm.closed) {
    const closing = state.doc.line(fm.last + 1);
    dispatch(state.update({ changes: { from: closing.from, insert: "\n" }, selection: { anchor: closing.from }, scrollIntoView: true, userEvent: "input" }));
    anchor = closing.from;
  } else if (!fm) {
    dispatch(state.update({ changes: { from: 0, insert: "---\n\n---\n" }, selection: { anchor: 4 }, scrollIntoView: true, userEvent: "input" }));
    anchor = 4;
  } else return false;
  if (target instanceof EditorView) {
    const view = target;
    setTimeout(() => {
      if (view.state.selection.main.head === anchor) startCompletion(view);
    }, 0);
  }
  return true;
};
