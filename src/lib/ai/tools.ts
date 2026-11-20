import { yamlValue } from "../markdown/yaml-value";
import { setFrontmatterProperty, splitFrontmatter } from "../markdown/frontmatter";
import { formatLink, type LinkFormat } from "../links/format";
import { addToHub } from "../links/hubs";
import { sectionUnder } from "../markdown/remark-links";
import { vaultHealth } from "../links/health";
import { hubsFor, pinnedHubs } from "../links/hubs";
import { appendText, notePathFrom, replaceOnce, type Proposal } from "./proposals";
import { compareTasks, filterTasks, parseTasks } from "../tasks/tasks";
import type { LinkIndex } from "../links/link-index";
import { filesWithProperties, parsePropertyQuery, valueText } from "../links/property-query";
import type { NoteIndex } from "../search/note-index";
import { displayName, isNote, validateName } from "../vault/paths";
import type { ToolSpec } from "./openai-compatible";

/**
 * What the agent may look at: read-only views of the repository. Handlers are
 * plain functions over these, so they're tested without a browser.
 */
export interface ToolEnv {
  links: LinkIndex;
  search: NoteIndex;
  /** Every file path in the repository. */
  files(): string[];
  mtime(path: string): number | undefined;
  /** Notes Repository health leaves out. */
  ignored?(path: string): boolean;
  /** Present when the agent may propose changes. */
  proposals?: ProposalSink;
}

/** Where proposed changes go, and the repository as it would be with the pending ones. */
export interface ProposalSink {
  /** A file's text with pending proposals applied (undefined: no such file). */
  textOf(path: string): string | undefined;
  exists(path: string): boolean;
  linkFormat: LinkFormat;
  add(p: Omit<Proposal, "id" | "status">): Proposal;
}

/** One tool's answer: text for the model, and the notes whose text it sent. */
export interface ToolResult {
  content: string;
  read: string[];
  /** A short line for the chat, e.g. "Searched “budget”". */
  label: string;
  proposal?: Proposal;
}

/** Most text one tool result may hold (characters), to keep the context small. */
export const RESULT_LIMIT = 12_000;

const cap = (s: string, n = RESULT_LIMIT) => (s.length > n ? s.slice(0, n) + "\n[…cut short]" : s);
const json = (v: unknown) => cap(JSON.stringify(v));
const str = (v: unknown, d = "") => (typeof v === "string" ? v : v === undefined || v === null ? d : String(v));
const num = (v: unknown, d: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : d;
};

/** Finds a file from what a model wrote: a path, a name, with or without ".md". */
export function findFile(env: ToolEnv, ref: string): string | null {
  const r = ref.trim().replace(/^\[\[|\]\]$/g, "").replace(/^\/+/, "");
  if (!r) return null;
  if (env.links.has(r)) return r;
  if (env.links.has(r + ".md")) return r + ".md";
  return env.links.resolve(r.replace(/\.md$/i, "")) ?? env.links.resolve(r);
}

const notFound = (ref: string, label: string): ToolResult => ({
  content: `No note found for "${ref}". Use search_notes to find the right one.`,
  read: [],
  label,
});

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolSpec => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

export const READ_TOOLS: ToolSpec[] = [
  fn(
    "search_notes",
    "Keyword search over the notes. Returns paths, titles and snippets. Also understands tag:name and [property:value] filters.",
    { query: { type: "string" }, limit: { type: "integer", description: "At most 20; default 8" } },
    ["query"],
  ),
  fn(
    "read_note",
    "Reads a note's markdown and properties, whole or one heading's section.",
    { path: { type: "string", description: "A path or note name" }, section: { type: "string", description: "A heading in the note" } },
    ["path"],
  ),
  fn(
    "get_links",
    "A note's connections: links out, backlinks (with the linking line), unlinked mentions, related notes and canvas arrows.",
    { path: { type: "string" } },
    ["path"],
  ),
  fn(
    "traverse",
    "Notes within a few links of a note (either direction), with their distance.",
    { path: { type: "string" }, depth: { type: "integer", description: "1 to 3; default 2" } },
    ["path"],
  ),
  fn("list_hubs", "The repository's hubs (notes that hold topics together), pinned ones first, and missing notes many notes link to.", {}),
  fn("hub_for", "The pinned hubs a note is in, or the ones it probably belongs in.", { path: { type: "string" } }, ["path"]),
  fn("find_by_tag", "Notes with a tag (or a tag nested under it). Without a tag: every tag and how often it's used.", {
    tag: { type: "string" },
  }),
  fn(
    "find_by_property",
    "Files with a property, optionally whose value contains some text. Without a key: every property name and how often it's used.",
    { key: { type: "string" }, value: { type: "string" } },
  ),
  fn("list_folder", "Files and folders in a folder (\"\" for the top).", { path: { type: "string" } }),
  fn(
    "list_tasks",
    "Tasks (- [ ] items) across the notes, earliest due first, with their note, due date, priority and heading.",
    {
      status: { type: "string", enum: ["open", "done", "all"], description: "Default open" },
      due_before: { type: "string", description: "Only tasks due on or before this date, YYYY-MM-DD" },
      text: { type: "string", description: "Words, #tags or a note name to match" },
      limit: { type: "integer", description: "At most 100; default 40" },
    },
  ),
  fn("repository_health", "How well connected the notes are: score, orphans, dead ends, broken links, stale hubs, hubs to write.", {}),
];

export const WRITE_TOOLS: ToolSpec[] = [
  fn(
    "create_note",
    "Proposes a new note. It can't replace an existing one.",
    {
      path: { type: "string", description: "e.g. Projects/Garden plan.md" },
      content: { type: "string", description: "Markdown, without frontmatter" },
      properties: { type: "object", description: "Properties for its frontmatter, e.g. {\"tags\": [\"garden\"]}" },
    },
    ["path", "content"],
  ),
  fn(
    "append_to_note",
    "Proposes adding text at the end of a note, or at the end of one heading's section.",
    { path: { type: "string" }, text: { type: "string" }, under_heading: { type: "string" } },
    ["path", "text"],
  ),
  fn(
    "edit_note",
    "Proposes replacing text in a note. `find` must match the note's text exactly, once: read the note first.",
    { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" } },
    ["path", "find", "replace"],
  ),
  fn(
    "set_property",
    "Proposes setting a property of any file (null removes it). Lists are JSON arrays.",
    { path: { type: "string" }, key: { type: "string" }, value: { description: "Text, number, true/false, a list, or null" } },
    ["path", "key", "value"],
  ),
  fn(
    "add_link",
    "Proposes linking one note from another: an unlinked mention becomes a link, otherwise the link is listed (in a hub's Notes section, or at the end).",
    { from: { type: "string" }, to: { type: "string" } },
    ["from", "to"],
  ),
];

const proposed = (r: Proposal, label: string): ToolResult => ({
  content: `Proposed (${r.id}): ${r.summary}. The user will review it; nothing changes until they apply it. Don't propose it again.`,
  read: [],
  label,
  proposal: r,
});

/** A file for writing: an existing one (by name or path), or one proposed in this conversation. */
function writable(env: ToolEnv, sink: ProposalSink, ref: string): string | null {
  const found = findFile(env, ref);
  if (found) return found;
  const asNote = notePathFrom(ref);
  return sink.textOf(asNote) !== undefined ? asNote : null;
}

const WRITE_HANDLERS: Record<string, (env: ToolEnv, sink: ProposalSink, args: Record<string, unknown>) => ToolResult> = {
  create_note(env, sink, a) {
    const path = notePathFrom(str(a.path));
    const label = `Proposed ${displayName(path)}`;
    const bad = path.split("/").map((seg) => validateName(seg.replace(/\.md$/i, ""))).find(Boolean);
    if (bad) return { content: `Can't use "${path}": ${bad}`, read: [], label: "Tried to create a note" };
    if (sink.exists(path) || findFile(env, path)) {
      return { content: `"${path}" already exists. Use append_to_note or edit_note to change it.`, read: [], label: "Tried to create a note" };
    }
    let text = str(a.content).replace(/^\n+/, "");
    if (!text.endsWith("\n")) text += "\n";
    const props = a.properties && typeof a.properties === "object" && !Array.isArray(a.properties) ? (a.properties as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(props)) if (/^[A-Za-z][\w-]*$/.test(k)) text = setFrontmatterProperty(text, k, yamlValue(v));
    return proposed(sink.add({ kind: "create", path, summary: `Create ${displayName(path)}`, before: null, after: text }), label);
  },

  append_to_note(env, sink, a) {
    const ref = str(a.path);
    const path = writable(env, sink, ref);
    if (!path || !isNote(path)) return notFound(ref, "Tried to add to a note");
    const before = sink.textOf(path) ?? "";
    const heading = str(a.under_heading).trim();
    const after = appendText(before, str(a.text), heading || undefined);
    if (after === null) return { content: `"${path}" has no heading "${heading}".`, read: [], label: "Tried to add to a note" };
    const where = heading ? `under “${heading}” in ${displayName(path)}` : `to the end of ${displayName(path)}`;
    return proposed(sink.add({ kind: "append", path, summary: `Add ${where}`, before, after }), `Proposed adding to ${displayName(path)}`);
  },

  edit_note(env, sink, a) {
    const ref = str(a.path);
    const path = writable(env, sink, ref);
    if (!path || !isNote(path)) return notFound(ref, "Tried to edit a note");
    const before = sink.textOf(path) ?? "";
    const r = replaceOnce(before, str(a.find), str(a.replace));
    if ("error" in r) return { content: r.error, read: [], label: `Tried to edit ${displayName(path)}` };
    return proposed(sink.add({ kind: "edit", path, summary: `Edit ${displayName(path)}`, before, after: r.text }), `Proposed an edit to ${displayName(path)}`);
  },

  set_property(env, sink, a) {
    const ref = str(a.path);
    const path = findFile(env, ref);
    if (!path) return notFound(ref, "Tried to set a property");
    const key = str(a.key).trim();
    if (!/^[A-Za-z][\w-]*$/.test(key)) return { content: `"${key}" isn't a valid property name.`, read: [], label: "Tried to set a property" };
    const value = a.value === null ? undefined : a.value;
    const old = env.links.get(path)?.properties[key];
    const summary = value === undefined ? `Remove ${key} from ${displayName(path)}` : `Set ${key} of ${displayName(path)} to ${valueText(value)}`;
    const line = (v: unknown) => (v === undefined ? "" : `${key}: ${yamlValue(v)}`);
    return proposed(
      sink.add({ kind: "property", path, summary, before: line(old), after: line(value), property: { key, value, old } }),
      `Proposed ${key} for ${displayName(path)}`,
    );
  },

  add_link(env, sink, a) {
    const from = writable(env, sink, str(a.from));
    if (!from || !isNote(from)) return notFound(str(a.from), "Tried to add a link");
    const toRef = str(a.to).replace(/^\[\[|\]\]$/g, "");
    const to = findFile(env, toRef);
    const target = to ? env.links.linkText(to) : toRef.replace(/\.md$/i, "");
    const before = sink.textOf(from) ?? "";
    const label = `Proposed a link to ${to ? displayName(to) : target}`;
    // An unlinked mention of the note becomes the link.
    const mention = to ? env.links.unlinkedMentions(to).find((m) => m.source === from && before.slice(m.from, m.from + m.text.length) === m.text) : undefined;
    let after: string;
    if (mention) {
      const link = formatLink(sink.linkFormat, from, { path: to, target, alias: target === mention.text ? undefined : mention.text }, target);
      after = before.slice(0, mention.from) + link + before.slice(mention.from + mention.text.length);
    } else {
      after = addToHub(before, formatLink(sink.linkFormat, from, { path: to, target }, target));
    }
    const summary = `Link ${to ? displayName(to) : target} from ${displayName(from)}`;
    return proposed(sink.add({ kind: "link", path: from, summary, before, after }), label);
  },
};

type Handler = (env: ToolEnv, args: Record<string, unknown>) => ToolResult;

const HANDLERS: Record<string, Handler> = {
  search_notes(env, a) {
    const query = str(a.query).trim();
    const limit = num(a.limit, 8, 20);
    const label = `Searched “${query}”`;
    if (!query) return { content: "Give a query.", read: [], label };
    let pool: string[] | null = null;
    let text = query;
    const pq = parsePropertyQuery(text);
    if (pq) {
      pool = filesWithProperties(env.links, pq.terms);
      text = pq.text;
    }
    text = text.replace(/(?:^|\s)tag:#?([\w/-]+)/g, (_, t: string) => {
      const tagged = new Set(env.links.withTag(t));
      pool = (pool ?? env.links.paths()).filter((p) => tagged.has(p));
      return " ";
    });
    text = text.trim();
    const inPool = (h: { path: string }) => !pool || pool.includes(h.path);
    let found = text ? env.search.search(text, 200).filter(inPool) : [];
    // Every word didn't match: any word will do.
    if (text && !found.length) found = env.search.searchAny(text, 200).filter(inPool);
    const hits = text
      ? found
      : (pool ?? []).map((path) => ({ path, title: displayName(path), snippet: plainStart(env, path) }));
    const results = hits.slice(0, limit).map((h) => ({
      path: h.path,
      title: h.title,
      snippet: h.snippet,
      ...(env.links.get(h.path)?.tags.length ? { tags: env.links.get(h.path)!.tags } : {}),
    }));
    return {
      content: results.length ? json({ total: hits.length, results }) : `No notes match "${query}".`,
      read: [],
      label,
    };
  },

  read_note(env, a) {
    const ref = str(a.path);
    const path = findFile(env, ref);
    if (!path) return notFound(ref, `Looked for “${ref}”`);
    const raw = env.links.content(path) ?? "";
    const label = `Read ${displayName(path)}`;
    const section = str(a.section).trim();
    const props = env.links.get(path)?.properties ?? {};
    let body = isNote(path) ? splitFrontmatter(raw).body : raw;
    if (section) {
      const part = sectionUnder(body, section.replace(/^#+\s*/, ""));
      if (part === null) {
        const headings = env.links.get(path)?.headings.map((h) => h.text) ?? [];
        return { content: `"${path}" has no heading "${section}". Its headings: ${headings.join(", ") || "none"}.`, read: [], label };
      }
      body = part;
    }
    const head = Object.keys(props).length ? `Properties: ${JSON.stringify(props)}\n\n` : "";
    return { content: cap(`Path: ${path}\n${head}${body}`), read: [path], label: section ? `${label} › ${section}` : label };
  },

  get_links(env, a) {
    const ref = str(a.path);
    const path = findFile(env, ref);
    if (!path) return notFound(ref, `Looked for “${ref}”`);
    const out = env.links.outgoing(path).map((o) => o.resolved ?? `${o.link.target} (missing)`);
    const backlinks = env.links.backlinks(path).slice(0, 30).map((b) => ({ from: b.source, line: b.context.trim().slice(0, 200) }));
    const mentions = env.links.unlinkedMentions(path).slice(0, 15).map((m) => ({ in: m.source, line: m.context.trim().slice(0, 200) }));
    const related = env.links.related(path, 8).map((r) => ({ path: r.path, via: r.via }));
    const canvas = env.links.canvasRelations(path).map((r) => ({ canvas: r.canvas, other: r.other, label: r.label, direction: r.direction }));
    return {
      content: json({ path, linksOut: [...new Set(out)], backlinks, unlinkedMentions: mentions, related, ...(canvas.length ? { canvas } : {}) }),
      read: [],
      label: `Followed links of ${displayName(path)}`,
    };
  },

  traverse(env, a) {
    const ref = str(a.path);
    const start = findFile(env, ref);
    if (!start) return notFound(ref, `Looked for “${ref}”`);
    const depth = num(a.depth, 2, 3);
    const seen = new Map<string, number>([[start, 0]]);
    let frontier = [start];
    for (let d = 1; d <= depth && seen.size < 60; d++) {
      const next: string[] = [];
      for (const p of frontier) {
        const near = [
          ...env.links.outgoing(p).flatMap((o) => (o.resolved ? [o.resolved] : [])),
          ...env.links.backlinks(p).map((b) => b.source),
        ];
        for (const n of near) {
          if (seen.has(n) || seen.size >= 60) continue;
          seen.set(n, d);
          next.push(n);
        }
      }
      frontier = next;
    }
    const notes = [...seen].filter(([p]) => p !== start).map(([path, distance]) => ({ path, distance }));
    return { content: json({ from: start, notes }), read: [], label: `Explored around ${displayName(start)}` };
  },

  list_hubs(env) {
    const h = health(env);
    const pinned = pinnedHubs(env.links);
    const hubs = [
      ...pinned.map((path) => ({ path, pinned: true, linksIn: h.hubs.find((x) => x.path === path)?.links ?? 0 })),
      ...h.hubs.filter((x) => !pinned.includes(x.path)).map((x) => ({ path: x.path, kind: x.kind, linksIn: x.links, linksOut: x.out })),
    ];
    return {
      content: json({ hubs, toWrite: h.hubCandidates.slice(0, 10).map((c) => ({ missing: c.target, linkedFrom: c.sources.length })) }),
      read: [],
      label: "Listed hubs",
    };
  },

  hub_for(env, a) {
    const ref = str(a.path);
    const path = findFile(env, ref);
    if (!path) return notFound(ref, `Looked for “${ref}”`);
    const { connected, suggestions } = hubsFor(env.links, path);
    return {
      content: json({ path, inHubs: connected, couldJoin: suggestions.slice(0, 5).map((s) => ({ hub: s.hub, reasons: s.reasons })) }),
      read: [],
      label: `Checked hubs for ${displayName(path)}`,
    };
  },

  find_by_tag(env, a) {
    const tag = str(a.tag).replace(/^#/, "").trim();
    if (!tag) {
      const tags = [...env.links.tags()].sort((x, y) => y[1] - x[1]).slice(0, 100);
      return { content: json(Object.fromEntries(tags)), read: [], label: "Listed tags" };
    }
    const paths = env.links.withTag(tag);
    return { content: paths.length ? json({ tag, notes: paths.slice(0, 100), total: paths.length }) : `No notes tagged #${tag}.`, read: [], label: `Found #${tag}` };
  },

  find_by_property(env, a) {
    const key = str(a.key).trim();
    if (!key) {
      const count = new Map<string, number>();
      for (const p of env.links.paths()) for (const k of Object.keys(env.links.get(p)?.properties ?? {})) count.set(k, (count.get(k) ?? 0) + 1);
      return { content: json(Object.fromEntries([...count].sort((x, y) => y[1] - x[1]))), read: [], label: "Listed properties" };
    }
    const value = str(a.value).trim();
    const paths = filesWithProperties(env.links, [value ? { key, value } : { key }]);
    const files = paths.slice(0, 100).map((p) => {
      const props = env.links.get(p)?.properties ?? {};
      const k = Object.keys(props).find((x) => x.toLowerCase() === key.toLowerCase())!;
      return { path: p, [k]: valueText(props[k]) };
    });
    return {
      content: files.length ? json({ total: paths.length, files }) : `No files have ${key}${value ? ` containing "${value}"` : ""}.`,
      read: [],
      label: `Found ${key}${value ? `: ${value}` : ""}`,
    };
  },

  list_folder(env, a) {
    const folder = str(a.path).replace(/^\/+|\/+$/g, "");
    const files: string[] = [];
    const folders = new Set<string>();
    for (const f of env.files()) {
      if (f.split("/").some((s) => s.startsWith("."))) continue;
      if (folder && !f.startsWith(folder + "/")) continue;
      const rest = folder ? f.slice(folder.length + 1) : f;
      const i = rest.indexOf("/");
      if (i === -1) files.push(f);
      else folders.add((folder ? folder + "/" : "") + rest.slice(0, i));
    }
    if (!files.length && !folders.size) return { content: `No folder "${folder}".`, read: [], label: `Listed ${folder || "the top folder"}` };
    return { content: json({ folder, folders: [...folders].sort(), files: files.sort().slice(0, 200) }), read: [], label: `Listed ${folder || "the top folder"}` };
  },

  list_tasks(env, a) {
    const status = a.status === "done" || a.status === "all" ? a.status : "open";
    const dueBefore = /^\d{4}-\d{2}-\d{2}$/.test(str(a.due_before)) ? str(a.due_before) : undefined;
    const all = env.links
      .paths()
      .filter(isNote)
      .flatMap((p) => parseTasks(p, env.links.content(p) ?? ""));
    const found = filterTasks(all, { status, text: str(a.text), dueBefore }).sort(compareTasks);
    const tasks = found.slice(0, num(a.limit, 40, 100)).map((t) => ({
      task: t.text,
      note: t.path,
      ...(t.done ? { done: true } : {}),
      ...(t.due ? { due: t.due } : {}),
      ...(t.scheduled ? { scheduled: t.scheduled } : {}),
      ...(t.priority !== "none" ? { priority: t.priority } : {}),
      ...(t.heading ? { under: t.heading } : {}),
    }));
    const label = dueBefore ? `Listed tasks due by ${dueBefore}` : `Listed ${status === "all" ? "" : status + " "}tasks`;
    return { content: tasks.length ? json({ total: found.length, tasks }) : "No tasks match.", read: [], label };
  },

  repository_health(env) {
    const h = health(env);
    const top = <T,>(xs: T[]) => xs.slice(0, 10);
    return {
      content: json({
        score: h.score,
        stats: h.stats,
        orphans: { total: h.orphans.length, some: top(h.orphans) },
        deadEnds: { total: h.deadEnds.length, some: top(h.deadEnds) },
        brokenLinks: top(h.broken).map((b) => ({ missing: b.target, from: b.sources.slice(0, 5) })),
        staleHubs: top(h.stale).map((s) => ({ path: s.path, linksIn: s.links, lastChanged: new Date(s.mtime).toISOString().slice(0, 10) })),
        hubsToWrite: top(h.hubCandidates).map((c) => ({ missing: c.target, linkedFrom: c.sources.length })),
      }),
      read: [],
      label: "Checked repository health",
    };
  },
};

function health(env: ToolEnv) {
  return vaultHealth(env.links, { mtime: env.mtime, ignore: env.ignored });
}

function plainStart(env: ToolEnv, path: string): string {
  const raw = env.links.content(path) ?? "";
  return (isNote(path) ? splitFrontmatter(raw).body : "").replace(/\s+/g, " ").trim().slice(0, 140);
}

/** Runs a tool call. Unknown tools and bad arguments come back as text the model can correct. */
export function runTool(env: ToolEnv, name: string, rawArgs: string): ToolResult {
  const sink = env.proposals;
  const write = Object.hasOwn(WRITE_HANDLERS, name) ? WRITE_HANDLERS[name] : undefined;
  const handler: Handler | undefined = Object.hasOwn(HANDLERS, name) ? HANDLERS[name] : write && sink ? (e, a) => write(e, sink, a) : undefined;
  if (!handler) return { content: `There's no tool "${name}".`, read: [], label: `Tried ${name}` };
  let args: Record<string, unknown> = {};
  if (rawArgs.trim()) {
    try {
      const parsed = JSON.parse(rawArgs);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
    } catch {
      return { content: `The arguments for ${name} weren't valid JSON: ${rawArgs.slice(0, 200)}`, read: [], label: `Tried ${name}` };
    }
  }
  try {
    return handler(env, args);
  } catch (e) {
    return { content: `${name} failed: ${(e as Error).message}`, read: [], label: `Tried ${name}` };
  }
}

