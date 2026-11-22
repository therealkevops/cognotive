import { parsePropertyQuery, valueText, type PropertyQuery } from "../links/property-query";
import { compareTasks, parseTasks, type Task } from "../tasks/tasks";
import { evaluate, parseExpr, QueryError, truthy, type Expr } from "./expr";

/**
 * Live queries: a code block that lists the notes (or tasks) matching a
 * query, kept up to date. Two ways to write one:
 *
 * ```query
 * tag:#project [status:active] garden
 * show: table status, due
 * sort: due
 * ```
 *
 * ```dataview
 * TABLE status, due FROM #project WHERE status = "active" SORT due ASC
 * ```
 *
 * The first uses the app's search syntax plus options; the second reads the
 * common part of Obsidian's Dataview (LIST, TABLE, TASK with FROM, WHERE,
 * SORT, LIMIT; no DataviewJS).
 */
export interface QuerySpec {
  view: "list" | "table" | "tasks";
  columns: Array<{ field: string; label: string }>;
  /** FROM: which notes to start from. */
  source?: (path: string) => boolean;
  where?: Expr;
  props: PropertyQuery["terms"];
  tags: Array<{ tag: string; not: boolean }>;
  /** Words to search for (all must match). */
  words: string;
  sort: Array<{ field: string; desc: boolean }>;
  limit?: number;
  taskStatus: "open" | "done" | "all";
}

export interface QueryContext {
  notes(): string[];
  content(path: string): string | undefined;
  properties(path: string): Record<string, unknown>;
  tags(path: string): string[];
  outlinks(path: string): string[];
  inlinks(path: string): string[];
  mtime(path: string): number | undefined;
  /** Notes matching all the words. */
  search(words: string): Set<string>;
  resolve(target: string): string | null;
  /** How a result links to a note ("[[Name]]", or a markdown link). */
  linkFor(path: string): string;
  name(path: string): string;
  today: string;
  /** The note holding the query: left out of its own list and table results. */
  self?: string;
}

export const MAX_RESULTS = 200;

const base = (): QuerySpec => ({ view: "list", columns: [], props: [], tags: [], words: "", sort: [], taskStatus: "open" });

function columnsFrom(src: string): QuerySpec["columns"] {
  return src
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const m = /^(.*?)\s+as\s+"?([^"]+)"?$/i.exec(c);
      return m ? { field: m[1].trim(), label: m[2].trim() } : { field: c, label: c.replace(/^file\./, "") };
    });
}

function sortFrom(src: string): QuerySpec["sort"] {
  return src
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.*?)(?:\s+(asc|ascending|desc|descending))?$/i.exec(s)!;
      return { field: m[1].trim(), desc: /^desc/i.test(m[2] ?? "") };
    });
}

/** FROM sources: #tag, "Folder", [[Note]] (notes linking to it), outgoing([[Note]]), with and, or, - and (). */
export function parseSource(src: string, ctx: Pick<QueryContext, "tags" | "outlinks" | "inlinks" | "resolve">): (path: string) => boolean {
  const toks = src.match(/outgoing\(\s*\[\[[^\]]+\]\]\s*\)|\[\[[^\]]+\]\]|"[^"]*"|#[\p{L}\p{N}_\-/]+|\(|\)|-|!|\band\b|\bor\b|\S+/giu) ?? [];
  let p = 0;
  const term = (): ((path: string) => boolean) => {
    const t = toks[p++];
    if (!t) throw new QueryError("FROM ends too soon.");
    if (t === "-" || t === "!") {
      const f = term();
      return (x) => !f(x);
    }
    if (t === "(") {
      const f = expr();
      if (toks[p++] !== ")") throw new QueryError('A "(" in FROM isn\'t closed.');
      return f;
    }
    if (t.startsWith("#")) {
      const tag = t.slice(1).toLowerCase();
      return (x) => ctx.tags(x).some((g) => g === tag || g.startsWith(tag + "/"));
    }
    if (t.startsWith('"')) {
      const folder = t.slice(1, -1).replace(/^\/+|\/+$/g, "");
      return (x) => !folder || x.startsWith(folder + "/") || x === folder || x === `${folder}.md`;
    }
    const out = /^outgoing\(\s*\[\[([^\]|#]+)/i.exec(t);
    if (out) {
      const target = ctx.resolve(out[1].trim());
      const linked = new Set(target ? ctx.outlinks(target) : []);
      return (x) => linked.has(x);
    }
    const link = /^\[\[([^\]|#]+)/.exec(t);
    if (link) {
      const target = ctx.resolve(link[1].trim());
      const linking = new Set(target ? ctx.inlinks(target) : []);
      return (x) => linking.has(x);
    }
    throw new QueryError(`FROM doesn't understand "${t}". Use #tag, "Folder" or [[Note]].`);
  };
  const expr = (): ((path: string) => boolean) => {
    let f = term();
    while (p < toks.length && /^(and|or)$/i.test(toks[p])) {
      const op = toks[p++].toLowerCase();
      const g = term();
      const prev = f;
      f = op === "and" ? (x) => prev(x) && g(x) : (x) => prev(x) || g(x);
    }
    return f;
  };
  const f = expr();
  if (p < toks.length) throw new QueryError(`FROM doesn't understand "${toks[p]}".`);
  return f;
}

/** A ```query block: search syntax, then options (show, sort, limit, from, where). */
export function parseQueryBlock(text: string, ctx: Pick<QueryContext, "tags" | "outlinks" | "inlinks" | "resolve">): QuerySpec {
  const spec = base();
  const filter: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const opt = /^(show|view|sort|limit|from|where)\s*:\s*(.*)$/i.exec(line);
    if (!opt) {
      filter.push(line);
      continue;
    }
    const [, key, value] = opt;
    const k = key.toLowerCase();
    if (k === "show" || k === "view") {
      const m = /^(list|table|tasks|open tasks|done tasks|all tasks)\b\s*(.*)$/i.exec(value.trim());
      if (!m) throw new QueryError(`show: should be list, table (with columns) or tasks, not "${value}".`);
      const what = m[1].toLowerCase();
      spec.view = what === "list" ? "list" : what === "table" ? "table" : "tasks";
      if (what.endsWith("tasks")) spec.taskStatus = what.startsWith("done") ? "done" : what.startsWith("all") ? "all" : "open";
      if (spec.view === "table") spec.columns = columnsFrom(m[2]);
    } else if (k === "sort") spec.sort = sortFrom(value);
    else if (k === "limit") spec.limit = Math.max(1, Math.floor(Number(value)) || MAX_RESULTS);
    else if (k === "from") {
      const v = value.trim();
      spec.source = /^(#|"|\[\[|outgoing\(|-|!|\()/.test(v) ? parseSource(v, ctx) : parseSource(`"${v.replace(/"/g, "")}"`, ctx);
    } else if (k === "where") spec.where = parseExpr(value);
  }
  let rest = filter.join(" ");
  const pq = parsePropertyQuery(rest);
  if (pq) {
    spec.props = pq.terms;
    rest = pq.text;
  }
  rest = rest.replace(/(^|\s)(-?)(?:tag:\s*#?|#)([\p{L}\p{N}_\-/]+)/gu, (_, sp: string, neg: string, tag: string) => {
    spec.tags.push({ tag: tag.toLowerCase(), not: neg === "-" });
    return sp;
  });
  spec.words = rest.replace(/\s+/g, " ").trim();
  return spec;
}

const CLAUSE = /^(FROM|WHERE|SORT|LIMIT|GROUP BY|FLATTEN)\b/i;

/** A ```dataview block (the common part of Obsidian's Dataview query language). */
export function parseDataview(text: string, ctx: Pick<QueryContext, "tags" | "outlinks" | "inlinks" | "resolve">): QuerySpec {
  const spec = base();
  // Split into clauses wherever a keyword starts one, on any line.
  const src = text.replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").trim();
  const parts = src.split(/\s(?=(?:FROM|WHERE|SORT|LIMIT|GROUP BY|FLATTEN)\b)/i);
  const head = parts.shift() ?? "";
  const m = /^(LIST|TABLE|TASK|CALENDAR)\b(?:\s+WITHOUT ID)?\s*(.*)$/i.exec(head);
  if (!m) throw new QueryError("A dataview query starts with LIST, TABLE or TASK.");
  const kind = m[1].toUpperCase();
  if (kind === "CALENDAR") throw new QueryError("CALENDAR views aren't supported; use LIST or TABLE.");
  spec.view = kind === "TABLE" ? "table" : kind === "TASK" ? "tasks" : "list";
  if (kind === "TASK") spec.taskStatus = "all";
  if (kind === "TABLE") spec.columns = columnsFrom(m[2]);
  for (const part of parts) {
    const c = CLAUSE.exec(part)![1].toUpperCase();
    const value = part.slice(c.length).trim();
    if (c === "FROM") spec.source = parseSource(value, ctx);
    else if (c === "WHERE") spec.where = spec.where ? { k: "bin", op: "and", a: spec.where, b: parseExpr(value) } : parseExpr(value);
    else if (c === "SORT") spec.sort = sortFrom(value);
    else if (c === "LIMIT") spec.limit = Math.max(1, Math.floor(Number(value)) || MAX_RESULTS);
    else throw new QueryError(`${c} isn't supported yet.`);
  }
  return spec;
}

/** A note's field, as queries name them. */
export function pageField(path: string, name: string, ctx: QueryContext): unknown {
  const n = name.toLowerCase();
  switch (n) {
    case "file.name":
    case "name":
    case "title":
      return ctx.name(path);
    case "file.path":
    case "path":
      return path;
    case "file.folder":
    case "folder":
      return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    case "file.link":
    case "link":
      return ctx.linkFor(path);
    case "file.mtime":
    case "modified": {
      const t = ctx.mtime(path);
      return t ? new Date(t).toISOString().slice(0, 10) : undefined;
    }
    case "file.tags":
    case "tags":
      return ctx.tags(path);
    case "file.outlinks":
      return ctx.outlinks(path);
    case "file.inlinks":
      return ctx.inlinks(path);
  }
  const props = ctx.properties(path);
  const key = Object.keys(props).find((k) => k.toLowerCase() === n);
  return key === undefined ? undefined : props[key];
}

function taskField(t: Task, name: string, ctx: QueryContext): unknown {
  switch (name.toLowerCase()) {
    case "completed":
    case "done":
      return t.done;
    case "text":
      return t.text;
    case "due":
      return t.due;
    case "scheduled":
      return t.scheduled;
    case "completion":
      return t.completed;
    case "priority":
      return t.priority === "none" ? undefined : t.priority;
    case "status":
      return t.mark;
  }
  return pageField(t.path, name, ctx);
}

function order(a: unknown, b: unknown): number {
  const missing = (v: unknown) => v === undefined || v === null || v === "";
  if (missing(a) || missing(b)) return missing(a) ? (missing(b) ? 0 : 1) : -1;
  const sa = valueText(a);
  const sb = valueText(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
}

export type QueryResult =
  | { view: "list" | "table"; columns: QuerySpec["columns"]; rows: string[]; total: number }
  | { view: "tasks"; tasks: Task[]; total: number };

export function runQuery(spec: QuerySpec, ctx: QueryContext): QueryResult {
  const found = spec.words ? ctx.search(spec.words) : null;
  const pages = ctx.notes().filter((p) => {
    if (spec.source && !spec.source(p)) return false;
    if (found && !found.has(p)) return false;
    const tags = ctx.tags(p);
    for (const t of spec.tags) {
      const has = tags.some((g) => g === t.tag || g.startsWith(t.tag + "/"));
      if (has === t.not) return false;
    }
    for (const term of spec.props) {
      const v = pageField(p, term.key, ctx);
      if (v === undefined) return false;
      if (term.value !== undefined) {
        const items = Array.isArray(v) ? v : [v];
        if (!items.some((i) => valueText(i).toLowerCase().includes(term.value!.toLowerCase()))) return false;
      }
    }
    return true;
  });
  const limit = Math.min(spec.limit ?? MAX_RESULTS, MAX_RESULTS);

  if (spec.view === "tasks") {
    let tasks = pages.flatMap((p) => parseTasks(p, ctx.content(p) ?? ""));
    if (spec.taskStatus === "open") tasks = tasks.filter((t) => !t.done);
    if (spec.taskStatus === "done") tasks = tasks.filter((t) => t.done);
    if (spec.where) tasks = tasks.filter((t) => truthy(evaluate(spec.where!, (n) => taskField(t, n, ctx), ctx.today)));
    tasks.sort(spec.sort.length ? (a, b) => sortBy(spec.sort, (n) => taskField(a, n, ctx), (n) => taskField(b, n, ctx)) : compareTasks);
    return { view: "tasks", tasks: tasks.slice(0, limit), total: tasks.length };
  }

  let rows = pages.filter((p) => p !== ctx.self);
  if (spec.where) rows = rows.filter((p) => truthy(evaluate(spec.where!, (n) => pageField(p, n, ctx), ctx.today)));
  const sort = spec.sort.length ? spec.sort : [{ field: "file.name", desc: false }];
  rows.sort((a, b) => sortBy(sort, (n) => pageField(a, n, ctx), (n) => pageField(b, n, ctx)));
  return { view: spec.view, columns: spec.columns, rows: rows.slice(0, limit), total: rows.length };
}

function sortBy(sort: QuerySpec["sort"], a: (n: string) => unknown, b: (n: string) => unknown): number {
  for (const s of sort) {
    const c = order(a(s.field), b(s.field));
    if (c) return s.desc ? -c : c;
  }
  return 0;
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

function display(v: unknown, field: string): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map((x) => display(x, field)).join(field.toLowerCase().endsWith("tags") ? " " : ", ");
  if (field.toLowerCase().endsWith("tags") && typeof v === "string") return v.startsWith("#") ? v : `#${v}`;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return valueText(v);
}

/** The results as markdown, so they render (and link) like the rest of the note. */
export function resultMarkdown(r: QueryResult, ctx: QueryContext): string {
  const more = r.total > (r.view === "tasks" ? r.tasks.length : r.rows.length) ? `\n\n*…and ${r.total - (r.view === "tasks" ? r.tasks.length : r.rows.length)} more.*` : "";
  if (r.view === "tasks") {
    if (!r.tasks.length) return "*No tasks match this query.*";
    return (
      r.tasks.map((t) => `- [${t.done ? "x" : " "}] ${t.text}${t.due ? ` (due ${t.due})` : ""} · ${ctx.linkFor(t.path)}`).join("\n") + more
    );
  }
  if (!r.rows.length) return "*No notes match this query.*";
  if (r.view === "list" || !r.columns.length) return r.rows.map((p) => `- ${ctx.linkFor(p)}`).join("\n") + more;
  const head = `| Note | ${r.columns.map((c) => cell(c.label)).join(" | ")} |`;
  const rule = `| --- | ${r.columns.map(() => "---").join(" | ")} |`;
  const body = r.rows.map((p) => `| ${cell(ctx.linkFor(p))} | ${r.columns.map((c) => cell(display(pageField(p, c.field, ctx), c.field))).join(" | ")} |`);
  return [head, rule, ...body].join("\n") + more;
}

/** Runs a query block's source, giving markdown: the results, or what's wrong with the query. */
export function queryToMarkdown(source: string, lang: "query" | "dataview", ctx: QueryContext): string {
  try {
    const spec = lang === "dataview" ? parseDataview(source, ctx) : parseQueryBlock(source, ctx);
    return resultMarkdown(runQuery(spec, ctx), ctx);
  } catch (e) {
    return `*Query error: ${e instanceof QueryError ? e.message : (e as Error).message}*`;
  }
}

/** Replaces query blocks in a note's markdown with their results (for the reading view). */
export function expandQueries(markdown: string, run: (source: string, lang: "query" | "dataview") => string): string {
  return markdown.replace(/^(```|~~~)[ \t]*(query|dataview)[ \t]*\n([\s\S]*?)^\1[ \t]*$/gim, (_, _f: string, lang: string, body: string) => {
    // The comments (dropped when rendering) keep one result's list from joining the next.
    return `\n<!-- query -->\n\n${run(body, lang.toLowerCase() as "query" | "dataview")}\n\n<!-- /query -->\n`;
  });
}
