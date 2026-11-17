import { startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";
import { parse as parseYaml } from "yaml";
import type { LinkIndex } from "../links/link-index";
import { linkHost } from "./wikilinks";

/**
 * Help with a note's properties (the YAML frontmatter at the top), as an IDE
 * helps with code: property names and values offered as you type, a note on
 * what each property does when you hover over it, and mistakes underlined.
 */

/** What the repository's notes use: property names (with how many notes use each), values, tags. */
export interface PropertyInfo {
  keys: Array<{ key: string; count: number }>;
  /** Values used for a property across the repository, most used first. */
  values(key: string): string[];
  tags: string[];
}

/** Gathers what the repository's notes use, for suggestions. */
export function collectPropertyInfo(index: LinkIndex): PropertyInfo {
  const keys = new Map<string, number>();
  const values = new Map<string, Map<string, number>>();
  for (const path of index.paths()) {
    const props = index.get(path)?.properties;
    if (!props) continue;
    for (const [key, raw] of Object.entries(props)) {
      keys.set(key, (keys.get(key) ?? 0) + 1);
      const list = Array.isArray(raw) ? raw : [raw];
      for (const v of list) {
        if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
        const s = String(v).trim();
        if (!s || s.length > 60 || s.includes("\n")) continue;
        let m = values.get(key);
        if (!m) values.set(key, (m = new Map()));
        m.set(s, (m.get(s) ?? 0) + 1);
      }
    }
  }
  const tags = [...index.tags()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  return {
    keys: [...keys].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    values: (key) => [...(values.get(key) ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v).slice(0, 50),
    tags,
  };
}

type Kind = "list" | "date" | "boolean" | "text";

/** Properties noted-ai understands. */
export const PROPERTY_DOCS: Record<string, { kind: Kind; doc: string }> = {
  tags: { kind: "list", doc: "Tags for the note, as in tags: [idea, work]. Same as writing #idea in the text." },
  aliases: { kind: "list", doc: "Other names for the note. [[Links]] and the quick switcher find it by these too." },
  created: { kind: "date", doc: "When the note was written (YYYY-MM-DD)." },
  reviewed: {
    kind: "date",
    doc: "When you last checked the note was still accurate (YYYY-MM-DD). Keeps a hub off Repository health's stale list.",
  },
  hub: {
    kind: "boolean",
    doc: "true pins the note to the sidebar as a hub; false stops it being counted as one.",
  },
  "template-folder": { kind: "text", doc: "In a template: the folder that notes made from it go in." },
  "template-name": { kind: "text", doc: 'In a template: the name for notes made from it, e.g. "{{date}} {{input:Topic}}".' },
};

const KEY = /^([A-Za-z][\w-]*)\s*:/;

/** The lines of the frontmatter block (between the "---" lines), if the note starts with one. */
export function frontmatterLines(state: EditorState): { first: number; last: number; closed: boolean } | null {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") return null;
  for (let n = 2; n <= doc.lines; n++) {
    const t = doc.line(n).text.trimEnd();
    if (t === "---" || t === "...") return { first: 2, last: n - 1, closed: true };
  }
  return { first: 2, last: doc.lines, closed: false };
}

/** The property a frontmatter line belongs to: its own key, or the key above an indented list item. */
function keyFor(state: EditorState, lineNo: number, first: number): string | null {
  for (let n = lineNo; n >= first; n--) {
    const text = state.doc.line(n).text;
    const m = KEY.exec(text);
    if (m) return m[1];
    if (!/^\s/.test(text) && text.trim()) return null;
  }
  return null;
}

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Suggests property names at the start of a frontmatter line, and values after "name:". */
export function completeProperties(ctx: CompletionContext): CompletionResult | null {
  const fm = frontmatterLines(ctx.state);
  if (!fm) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  if (line.number < fm.first || line.number > fm.last) return null;
  const info = ctx.state.facet(linkHost)?.propertyInfo?.();
  const before = line.text.slice(0, ctx.pos - line.from);

  // A property name.
  if (/^[A-Za-z][\w-]*$|^$/.test(before) && !line.text.includes(":")) {
    if (!before && !ctx.explicit) return null;
    const present = new Set<string>();
    for (let n = fm.first; n <= fm.last; n++) {
      if (n === line.number) continue;
      const m = KEY.exec(ctx.state.doc.line(n).text);
      if (m) present.add(m[1]);
    }
    const counts = new Map(info?.keys.map((k) => [k.key, k.count]) ?? []);
    const names = [...new Set([...Object.keys(PROPERTY_DOCS), ...counts.keys()])].filter((k) => !present.has(k));
    const options: Completion[] = names.map((key) => {
      const known = PROPERTY_DOCS[key];
      const used = counts.get(key) ?? 0;
      return {
        label: key,
        type: "property",
        detail: known ? known.kind : `used in ${used} ${used === 1 ? "note" : "notes"}`,
        info: known?.doc,
        boost: (known ? 10 : 0) + Math.min(9, used),
        apply: (view: EditorView, _c: Completion, from: number, to: number) => {
          const kind = known?.kind;
          const value = kind === "date" ? today() : kind === "list" ? "[]" : "";
          const insert = `${key}: ${value}`;
          const cursor = from + insert.length - (kind === "list" ? 1 : 0);
          view.dispatch({ changes: { from, to: Math.max(to, line.to), insert }, selection: { anchor: cursor }, userEvent: "input.complete" });
          // Offer values straight away where there are some to offer.
          // (After this completion has closed, or it would close the new one.)
          if (kind === "boolean" || kind === "list" || (!kind && (info?.values(key).length ?? 0) > 0)) {
            setTimeout(() => startCompletion(view), 0);
          }
        },
      };
    });
    return { from: line.from, options, validFor: /^[\w-]*$/ };
  }

  // A value: after "name:", inside "[a, b", or on an indented "- item" line.
  const key = keyFor(ctx.state, line.number, fm.first);
  if (!key) return null;
  const own = KEY.exec(before);
  // Editing the name of an existing "name: value" line, not its value.
  if (!own && KEY.test(line.text)) return null;
  let valuePart = own ? before.slice(own[0].length) : before.replace(/^\s*-\s*/, "");
  const bracket = Math.max(valuePart.lastIndexOf("["), valuePart.lastIndexOf(","));
  if (bracket !== -1) valuePart = valuePart.slice(bracket + 1);
  const typed = valuePart.replace(/^\s+/, "");
  if (/[\]"']/.test(typed)) return null;
  const from = ctx.pos - typed.length;
  const kind = PROPERTY_DOCS[key]?.kind;

  let values: Array<{ label: string; info?: string; detail?: string }> = [];
  if (kind === "boolean") {
    values = [
      { label: "true", info: PROPERTY_DOCS[key]?.doc },
      { label: "false", info: PROPERTY_DOCS[key]?.doc },
    ];
  } else if (kind === "date") {
    values = [{ label: today(), detail: "today" }];
  } else if (key === "tags") {
    const written = new Set(
      line.text
        .slice(line.text.indexOf(":") + 1)
        .split(/[[\],\s]+/)
        .filter(Boolean),
    );
    values = (info?.tags ?? []).filter((t) => !written.has(t)).map((t) => ({ label: t, detail: "tag" }));
  } else if (key !== "aliases" && kind !== "text") {
    values = (info?.values(key) ?? []).map((v) => ({ label: v, detail: "used before" }));
  }
  if (values.length === 0) return null;
  return {
    from,
    options: values.map((v, i) => ({ ...v, type: "constant", boost: -i / 1000 })),
    validFor: /^[\w\/.-]*$/,
  };
}

/** Hovering over a property name explains what it does. */
const propertyHover = hoverTooltip((view, pos) => {
  const fm = frontmatterLines(view.state);
  if (!fm) return null;
  const line = view.state.doc.lineAt(pos);
  if (line.number < fm.first || line.number > fm.last) return null;
  const m = KEY.exec(line.text);
  if (!m || pos > line.from + m[1].length) return null;
  const known = PROPERTY_DOCS[m[1]];
  const used = view.state.facet(linkHost)?.propertyInfo?.().keys.find((k) => k.key === m[1])?.count ?? 0;
  if (!known && !used) return null;
  return {
    pos: line.from,
    end: line.from + m[1].length,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-property-doc";
      const title = document.createElement("strong");
      title.textContent = m[1];
      const body = document.createElement("p");
      body.textContent = known ? known.doc : `Your own property, used in ${used} ${used === 1 ? "note" : "notes"}.`;
      dom.append(title, body);
      return { dom };
    },
  };
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Mistakes in a note's properties, underlined like errors in code. */
export function checkProperties(state: EditorState): Diagnostic[] {
  const fm = frontmatterLines(state);
  if (!fm) return [];
  const out: Diagnostic[] = [];
  const doc = state.doc;
  if (!fm.closed) {
    const l = doc.line(1);
    out.push({ from: l.from, to: l.to, severity: "warning", message: "These properties never end: add a line with --- after them." });
    return out;
  }
  // A name listed twice makes the whole block invalid YAML: say which.
  const firstSeen = new Set<string>();
  for (let n = fm.first; n <= fm.last; n++) {
    const l = doc.line(n);
    const m = KEY.exec(l.text);
    if (!m) continue;
    if (firstSeen.has(m[1])) {
      out.push({
        from: l.from,
        to: l.from + m[1].length,
        severity: "error",
        message: `${m[1]} is listed twice, so none of these properties apply. Remove one.`,
      });
    }
    firstSeen.add(m[1]);
  }
  if (out.length) return out;
  const text = doc.sliceString(doc.line(fm.first).from, fm.last >= fm.first ? doc.line(fm.last).to : doc.line(fm.first).from);
  try {
    parseYaml(text);
  } catch (e) {
    const linePos = (e as { linePos?: Array<{ line: number }> }).linePos?.[0]?.line;
    const n = Math.min(fm.last, Math.max(fm.first, fm.first + (linePos ? linePos - 1 : 0)));
    const l = doc.line(n);
    out.push({
      from: l.from,
      to: Math.max(l.to, l.from + 1),
      severity: "error",
      message: `These properties aren't valid YAML, so none of them apply: ${(e as Error).message.split("\n")[0]}`,
    });
    return out;
  }
  for (let n = fm.first; n <= fm.last; n++) {
    const l = doc.line(n);
    const m = KEY.exec(l.text);
    if (!m) continue;
    const key = m[1];
    const value = l.text.slice(m[0].length).trim().replace(/^["']|["']$/g, "");
    const valueRange = { from: l.from + l.text.indexOf(":") + 1, to: l.to };
    const kind = PROPERTY_DOCS[key]?.kind;
    if (!value) continue;
    if (kind === "boolean" && !/^(true|false|yes|no)$/i.test(value)) {
      out.push({ ...valueRange, severity: "warning", message: `${key} should be true or false.` });
    } else if (kind === "date" && !DATE.test(value)) {
      out.push({ ...valueRange, severity: "warning", message: `${key} should be a date like ${today()}.` });
    } else if (key === "tags") {
      const items = value.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean);
      const bad = items.find((t) => /\s/.test(t.replace(/^["']|["']$/g, "")));
      if (bad) out.push({ ...valueRange, severity: "warning", message: `Tags can't contain spaces ("${bad}"); use - or / instead.` });
    }
  }
  return out;
}

export function propertyExtensions(): Extension {
  return [propertyHover, linter((view) => checkProperties(view.state), { delay: 400 })];
}
