import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { splitLinkText } from "../links/parse";
import { linkHost } from "./wikilinks";
import { describeDate } from "../dates/natural";

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-task-checkbox";
    box.setAttribute("aria-label", this.checked ? "Mark as not done" : "Mark as done");
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", (e) => {
      e.preventDefault();
      // pos is the "[" of "[ ]"; the state character is right after it.
      view.dispatch({
        changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" },
        userEvent: "input.toggle",
      });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    span.textContent = "•";
    return span;
  }
}

/** An image or drawing shown in place of its ![[embed]] link. */
class EmbedWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly width: string | undefined,
  ) {
    super();
  }
  eq(other: EmbedWidget) {
    return other.path === this.path && other.width === this.width;
  }
  toDOM(view: EditorView) {
    const img = document.createElement("img");
    img.className = "cm-embed";
    img.alt = this.path.split("/").pop() ?? "";
    if (this.width) img.style.width = `${this.width}px`;
    const host = view.state.facet(linkHost);
    void host?.fileUrl?.(this.path).then((url) => {
      if (url) img.src = url;
      else img.classList.add("cm-embed-missing");
    });
    return img;
  }
  ignoreEvent() {
    return false;
  }
}

/** A task's date or priority field ("[due:: 2026-11-27]") shown as "Due Fri 27 Nov" or "High priority". */
class TaskDateWidget extends WidgetType {
  constructor(
    readonly field: string,
    readonly iso: string,
  ) {
    super();
  }
  eq(other: TaskDateWidget) {
    return other.field === this.field && other.iso === this.iso;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-task-date cm-task-date-${this.field}`;
    const label = TASK_FIELD_LABELS[this.field] ?? this.field;
    if (this.field === "priority") {
      span.textContent = `${this.iso.charAt(0).toUpperCase()}${this.iso.slice(1)} priority`;
    } else {
      const [y, m, d] = this.iso.split("-").map(Number);
      const date = new Date(y, m - 1, d);
      span.textContent = Number.isNaN(date.getTime()) ? `${label} ${this.iso}` : `${label} ${describeDate(date)}`;
    }
    span.title = `${this.field}:: ${this.iso}`;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

const TASK_FIELD_LABELS: Record<string, string> = { due: "Due", scheduled: "Scheduled", start: "Starts", completion: "Done" };
const TASK_FIELD = /^\[(?:(due|scheduled|start|completion)::\s*(\d{4}-\d{2}-\d{2})|(priority)::\s*(highest|high|medium|low|lowest))\s*\]$/i;

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });

/** True if any selection range touches [from, to] (inclusive at both ends). */
function touches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

function onActiveLine(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  return touches(state, line.from, line.to);
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const decos: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (ref) => {
        const node: SyntaxNode = ref.node;
        const parent = node.parent;
        switch (node.name) {
          case "HeaderMark": {
            if (!parent?.name.startsWith("ATXHeading") || onActiveLine(state, node.from)) return;
            const end = state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            decos.push(hidden.range(node.from, end));
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
          case "HighlightMark":
            if (parent && !touches(state, parent.from, parent.to))
              decos.push(hidden.range(node.from, node.to));
            return;
          case "CodeMark":
            if (parent?.name === "InlineCode" && !touches(state, parent.from, parent.to))
              decos.push(hidden.range(node.from, node.to));
            return;
          case "Link": {
            if (touches(state, node.from, node.to)) return false;
            const field = TASK_FIELD.exec(state.sliceDoc(node.from, node.to));
            if (field) {
              const [name, value] = field[1] ? [field[1], field[2]] : ["priority", field[4].toLowerCase()];
              decos.push(Decoration.replace({ widget: new TaskDateWidget(name, value) }).range(node.from, node.to));
              return false;
            }
            // Hide "[", "](url \"title\")" and keep the label. Reference-style
            // links ("[text]" alone, as in callout heads) have no URL; leave them.
            const marks = node.getChildren("LinkMark");
            if (marks.length < 2 || !node.getChild("URL")) return false;
            const close = marks[1];
            decos.push(hidden.range(marks[0].from, marks[0].to));
            decos.push(hidden.range(close.from, node.to));
            return false;
          }
          case "WikiLink": {
            if (touches(state, node.from, node.to)) return false;
            const inner = node.getChild("WikiLinkTarget");
            if (!inner) return false;
            // ![[pic.png]] and ![[map.excalidraw]] show the picture itself.
            const host = state.facet(linkHost);
            if (state.sliceDoc(node.from, node.from + 1) === "!" && host?.embedPath) {
              const parts = splitLinkText(state.sliceDoc(inner.from, inner.to));
              const path = parts.target ? host.embedPath(parts.target) : null;
              if (path) {
                const width = parts.alias && /^\d+(x\d+)?$/.test(parts.alias) ? parts.alias.split("x")[0] : undefined;
                decos.push(Decoration.replace({ widget: new EmbedWidget(path, width) }).range(node.from, node.to));
                return false;
              }
            }
            // Hide "[[" / "![[" and "]]"; with an alias, show only the alias.
            decos.push(hidden.range(node.from, inner.from));
            const pipe = state.sliceDoc(inner.from, inner.to).search(/\\?\|/);
            if (pipe > 0) {
              const aliasStart = state.sliceDoc(inner.from + pipe, inner.from + pipe + 1) === "\\" ? pipe + 2 : pipe + 1;
              decos.push(hidden.range(inner.from, inner.from + aliasStart));
            }
            decos.push(hidden.range(inner.to, node.to));
            return false;
          }
          case "TaskMarker": {
            if (touches(state, node.from, node.to)) return;
            const checked = /x/i.test(state.sliceDoc(node.from + 1, node.from + 2));
            decos.push(
              Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }).range(
                node.from,
                node.to,
              ),
            );
            return;
          }
          case "ListMark": {
            if (parent?.parent?.name !== "BulletList" || onActiveLine(state, node.from)) return;
            // A task item keeps its dash hidden; the checkbox stands in for the bullet.
            const isTask = parent.getChild("Task") !== null;
            const end = isTask && state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            decos.push((isTask ? hidden : bullet).range(node.from, end));
            return;
          }
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

/**
 * Obsidian-style live preview: markdown syntax (heading hashes, emphasis
 * markers, link URLs, list dashes, task brackets) is hidden except where the
 * cursor or selection is, so the text reads as formatted while staying plain
 * markdown underneath.
 */
export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
