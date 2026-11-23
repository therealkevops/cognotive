import { startCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSection } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { DATE_PHRASES, describeDate, isoDate, parseNaturalDate, relativeDay } from "../dates/natural";
import { insertHorizontalRule, insertTableOf, setHeading, toggleLinePrefix } from "./formatting";
import { addProperty } from "./properties-panel";
import { linkHost, type LinkHost } from "./wikilinks";

/**
 * The "/" menu: typing "/" at the start of a line or after a space lists commands, in
 * sections. Some act at once (/divider), some take a choice typed after them (/callout tip,
 * /table 3x4, /code python), and the date commands take a date in words (/due this tue) and
 * show the date it means before anything is written. "24/11", "and/or" and web addresses
 * don't open it.
 */

type Apply = (view: EditorView, from: number, to: number) => void;

interface Choice {
  label: string;
  detail?: string;
  apply: Apply;
}

interface Env {
  host: LinkHost | null;
  now: Date;
}

export interface SlashCommand {
  name: string;
  aliases: string[];
  label: string;
  /** What it does, shown beside the menu. */
  info: string;
  section: "blocks" | "insert" | "tasks" | "ai";
  /** Acts straight away. */
  run?: Apply;
  /** Takes what's typed after "/name " and offers ways to finish (first is the default). */
  choices?: (typed: string, env: Env) => Choice[];
  /** Only offered when the app can do it (e.g. saving attachments). */
  available?: (host: LinkHost | null) => boolean;
}

const SECTIONS: Record<SlashCommand["section"], CompletionSection> = {
  blocks: { name: "Blocks", rank: 0 },
  insert: { name: "Insert", rank: 1 },
  tasks: { name: "Tasks and dates", rank: 2 },
  ai: { name: "AI", rank: 3 },
};

/* ---------- Edits ---------- */

/** Replaces what was typed ("/due this tue") with `insert`, the cursor after it (or at `cursor`). */
function replaceTyped(view: EditorView, from: number, to: number, insert: string, cursor = insert.length) {
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + cursor }, userEvent: "input.complete", scrollIntoView: true });
}

/**
 * Puts a block (a table, a code block) where the command was typed: in its place if the
 * line held nothing else, otherwise on its own lines after it. A blank line separates it
 * from text above, so it isn't read as part of a paragraph.
 */
export function placeBlock(view: EditorView, from: number, to: number, text: string, cursor: number) {
  const { state } = view;
  const line = state.doc.lineAt(from);
  const rest = (line.text.slice(0, from - line.from) + line.text.slice(to - line.from)).replace(/\s+$/, "");
  let insert: string;
  let start: number;
  if (rest.trim()) {
    insert = `${rest}\n\n${text}`;
    start = rest.length + 2;
  } else {
    const above = line.number > 1 ? state.doc.line(line.number - 1).text.trim() : "";
    const gap = above ? "\n" : "";
    insert = gap + text;
    start = gap.length;
  }
  const after = line.to < state.doc.length && state.doc.lineAt(line.to + 1).text.trim() ? "\n" : "";
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: insert + after },
    selection: { anchor: line.from + start + cursor },
    userEvent: "input.complete",
    scrollIntoView: true,
  });
}

/** Removes what was typed, then runs an editor command at that spot. */
function thenRun(command: (view: EditorView) => boolean): Apply {
  return (view, from, to) => {
    replaceTyped(view, from, to, "");
    command(view);
  };
}

/** Sets a "[field:: value]" on the line, replacing the same field already there. */
function setField(view: EditorView, from: number, to: number, field: string, value: string | null) {
  // Removing it: take the space before the command too.
  if (value === null && from > 0 && view.state.sliceDoc(from - 1, from) === " ") from--;
  const changes: Array<{ from: number; to: number; insert: string }> = [{ from, to, insert: value === null ? "" : `[${field}:: ${value}]` }];
  const line = view.state.doc.lineAt(from);
  for (const m of line.text.matchAll(new RegExp(String.raw`\s?\[${field}::\s*[^\]]*\]`, "g"))) {
    const start = line.from + m.index!;
    const end = start + m[0].length;
    if (end <= from || start >= to) changes.push({ from: start, to: end, insert: "" });
  }
  const set = view.state.changes(changes);
  view.dispatch({ changes: set, selection: { anchor: set.mapPos(to, 1) }, userEvent: "input.complete" });
}

/** "[[Note]]" or a markdown link, by the repository's link format. */
const linkTo = (host: LinkHost | null, inner: string, embed: boolean) => host?.formatLink?.(inner, embed) ?? `${embed ? "!" : ""}[[${inner}]]`;

/* ---------- Choices ---------- */

/** Date choices for a phrase: the date it means, then phrases that finish what's typed. */
function dateChoices(typed: string, env: Env, label: (when: string) => string, write: (date: Date) => Apply): Choice[] {
  const starters = ["today", "tomorrow", "this weekend", "next week", "end of month", "in 2 weeks"];
  const out: Choice[] = [];
  const seen = new Set<string>();
  const add = (phrase: string) => {
    const date = parseNaturalDate(phrase, env.now);
    // One suggestion per date: "next mon" and "next week" are often the same day.
    if (!date || seen.has(isoDate(date))) return;
    seen.add(isoDate(date));
    out.push({ label: label(describeDate(date, env.now)), detail: `${phrase} · ${relativeDay(date, env.now)}`, apply: write(date) });
  };
  if (!typed) starters.forEach(add);
  else {
    add(typed);
    DATE_PHRASES.filter((p) => p.startsWith(typed) && p !== typed).forEach(add);
  }
  return out;
}

const dateField = (field: "due" | "scheduled" | "start", word: string) => (typed: string, env: Env) =>
  dateChoices(typed, env, (when) => `${word} ${when}`, (date) => (view, from, to) => setField(view, from, to, field, isoDate(date)));

/** Picks from a fixed list by what's typed (the first match is the default). */
function fromList<T extends { key: string; label: string }>(items: T[], typed: string, apply: (item: T) => Apply, detail?: (item: T) => string): Choice[] {
  const match = items.filter((i) => !typed || i.key.startsWith(typed) || i.label.toLowerCase().startsWith(typed));
  return match.map((i) => ({ label: i.label, ...(detail ? { detail: detail(i) } : {}), apply: apply(i) }));
}

const CALLOUTS = ["note", "tip", "info", "warning", "danger", "question", "example", "quote", "todo", "success"].map((key) => ({
  key,
  label: key.charAt(0).toUpperCase() + key.slice(1),
}));

const LANGUAGES = [
  ["", "Plain text"],
  ["js", "JavaScript"],
  ["ts", "TypeScript"],
  ["python", "Python"],
  ["bash", "Shell"],
  ["json", "JSON"],
  ["sql", "SQL"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["yaml", "YAML"],
  ["markdown", "Markdown"],
].map(([key, label]) => ({ key, label }));

const PRIORITIES = ["highest", "high", "medium", "low", "lowest"].map((key) => ({ key, label: `${key.charAt(0).toUpperCase() + key.slice(1)} priority` }));

const TABLE_SIZES = [
  [2, 2],
  [3, 2],
  [3, 3],
  [4, 3],
  [4, 4],
] as const;

/** "/table 3x4": 3 columns, 4 rows. */
function tableChoices(typed: string): Choice[] {
  const size = (cols: number, rows: number): Choice => ({
    label: `Table, ${cols} × ${rows}`,
    detail: `${cols} columns, ${rows} rows`,
    apply: thenRun((v) => insertTableOf(rows, cols)(v)),
  });
  const m = /^(\d{1,2})\s*[x×*]\s*(\d{1,2})$/.exec(typed);
  if (m) {
    const [cols, rows] = [Number(m[1]), Number(m[2])];
    return cols >= 1 && rows >= 1 && cols <= 20 && rows <= 50 ? [size(cols, rows)] : [];
  }
  return TABLE_SIZES.filter(([c]) => !typed || String(c).startsWith(typed)).map(([c, r]) => size(c, r));
}

/* ---------- The commands ---------- */

const hasTask = (view: EditorView, from: number) => /^\s*[-*+]\s+\[.\]\s/.test(view.state.doc.lineAt(from).text);

/** Opens the file picker and embeds what's chosen where the command was typed. */
function attach(view: EditorView, from: number, to: number) {
  replaceTyped(view, from, to, "");
  const host = view.state.facet(linkHost);
  if (!host?.saveFiles) return;
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.addEventListener("change", async () => {
    const files = [...(input.files ?? [])];
    if (!files.length) return;
    const links = await host.saveFiles!(files);
    const at = Math.min(view.state.selection.main.head, view.state.doc.length);
    const insert = links.map((l) => linkTo(host, l, true)).join("\n");
    view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: "input" });
    view.focus();
  });
  input.click();
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Blocks
  ...([1, 2, 3] as const).map(
    (level): SlashCommand => ({
      name: `h${level}`,
      aliases: [`heading${level}`, "heading", ...(level === 1 ? ["title"] : [])],
      label: `Heading ${level}`,
      info: `Makes this line a level ${level} heading`,
      section: "blocks",
      run: thenRun((v) => setHeading(level)(v)),
    }),
  ),
  {
    name: "callout",
    aliases: ["admonition", "aside"],
    label: "Callout",
    info: "A highlighted box: note, tip, warning, question… e.g. /callout tip",
    section: "blocks",
    choices: (typed) =>
      fromList(CALLOUTS, typed, (c) => (view, from, to) => placeBlock(view, from, to, `> [!${c.key}]\n> `, `> [!${c.key}]\n> `.length), (c) => `> [!${c.key}]`),
  },
  {
    name: "quote",
    aliases: ["blockquote"],
    label: "Quote",
    info: "Makes this line a quote",
    section: "blocks",
    run: thenRun((v) => toggleLinePrefix("quote")(v)),
  },
  {
    name: "code",
    aliases: ["codeblock", "snippet"],
    label: "Code block",
    info: "A block of code, with highlighting for its language, e.g. /code python",
    section: "blocks",
    choices: (typed) => {
      const list = fromList(LANGUAGES, typed, (l) => (view, from, to) => placeBlock(view, from, to, "```" + l.key + "\n\n```", 4 + l.key.length), (l) => l.key || "no language");
      // Any other language name works too.
      if (typed && /^[\w+#-]+$/.test(typed) && !LANGUAGES.some((l) => l.key === typed))
        list.push({ label: typed, detail: "language", apply: (view, from, to) => placeBlock(view, from, to, "```" + typed + "\n\n```", 4 + typed.length) });
      return list;
    },
  },
  {
    name: "table",
    aliases: ["grid"],
    label: "Table",
    info: "A table, edited as a grid; /table 3x4 for 3 columns and 4 rows",
    section: "blocks",
    choices: tableChoices,
  },
  {
    name: "math",
    aliases: ["latex", "equation", "formula"],
    label: "Maths block",
    info: "A LaTeX formula on its own lines",
    section: "blocks",
    run: (view, from, to) => placeBlock(view, from, to, "$$\n\n$$", 3),
  },
  {
    name: "diagram",
    aliases: ["mermaid", "flowchart", "chart"],
    label: "Diagram",
    info: "A Mermaid diagram, drawn from text",
    section: "blocks",
    run: (view, from, to) => placeBlock(view, from, to, "```mermaid\ngraph LR\n  A --> B\n```", "```mermaid\ngraph LR\n  ".length),
  },
  {
    name: "query",
    aliases: ["dataview", "live"],
    label: "Live query",
    info: "A list or table of the notes that match, kept up to date",
    section: "blocks",
    run: (view, from, to) => placeBlock(view, from, to, QUERY_BLOCK, "```query\n".length),
  },
  {
    name: "divider",
    aliases: ["hr", "rule", "line", "separator"],
    label: "Divider",
    info: "A horizontal line",
    section: "blocks",
    run: thenRun((v) => insertHorizontalRule(v)),
  },

  // Insert
  {
    name: "link",
    aliases: ["wikilink", "note"],
    label: "Link to a note",
    info: "Starts a [[link]] and suggests notes",
    section: "insert",
    run: (view, from, to) => {
      replaceTyped(view, from, to, "[[]]", 2);
      startCompletion(view);
    },
  },
  {
    name: "embed",
    aliases: ["transclude"],
    label: "Embed a note or image",
    info: "Shows another note, a section of one, or a picture here",
    section: "insert",
    run: (view, from, to) => {
      replaceTyped(view, from, to, "![[]]", 3);
      startCompletion(view);
    },
  },
  {
    name: "attach",
    aliases: ["file", "image", "photo", "picture", "upload"],
    label: "Attach a file or photo",
    info: "Adds files (on a phone, a photo from the camera) and embeds them here",
    section: "insert",
    available: (host) => !!host?.saveFiles,
    run: attach,
  },
  {
    name: "drawing",
    aliases: ["sketch", "excalidraw", "whiteboard"],
    label: "New drawing",
    info: "Makes an empty drawing and embeds it here; click it to draw",
    section: "insert",
    available: (host) => !!host?.newDrawing,
    run: (view, from, to) => {
      replaceTyped(view, from, to, "");
      const host = view.state.facet(linkHost);
      void host?.newDrawing?.().then((link) => {
        if (!link) return;
        const at = Math.min(view.state.selection.main.head, view.state.doc.length);
        const insert = linkTo(host, link, true);
        view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: "input" });
      });
    },
  },
  {
    name: "template",
    aliases: ["templates"],
    label: "Insert a template",
    info: "Picks a template and inserts it here",
    section: "insert",
    available: (host) => !!host?.insertTemplate,
    run: (view, from, to) => {
      replaceTyped(view, from, to, "");
      view.state.facet(linkHost)?.insertTemplate?.();
    },
  },
  {
    name: "property",
    aliases: ["frontmatter", "metadata"],
    label: "Add a property",
    info: "Adds a property (status, tags, a date…) to this note",
    section: "insert",
    run: thenRun((v) => addProperty(v)),
  },

  // Tasks and dates
  {
    name: "task",
    aliases: ["todo", "checkbox"],
    label: "Task",
    info: "Turns this line into a task",
    section: "tasks",
    run: (view, from, to) => {
      replaceTyped(view, from, to, "");
      if (!hasTask(view, from)) toggleLinePrefix("task")(view);
    },
  },
  { name: "due", aliases: ["deadline"], label: "Due date", info: "Sets a task's due date, e.g. /due this tue", section: "tasks", choices: dateField("due", "Due") },
  { name: "scheduled", aliases: ["schedule", "sched"], label: "Scheduled date", info: "When to work on it, e.g. /scheduled mon", section: "tasks", choices: dateField("scheduled", "Scheduled") },
  { name: "start", aliases: ["starts", "begin"], label: "Start date", info: "When it can start, e.g. /start next week", section: "tasks", choices: dateField("start", "Start") },
  {
    name: "priority",
    aliases: ["prio", "importance"],
    label: "Priority",
    info: "Sets a task's priority, e.g. /priority high",
    section: "tasks",
    choices: (typed) => [
      ...fromList(PRIORITIES, typed, (p) => (view, from, to) => setField(view, from, to, "priority", p.key), (p) => `[priority:: ${p.key}]`),
      ...(!typed || "none".startsWith(typed) ? [{ label: "No priority", detail: "removes it", apply: ((view, from, to) => setField(view, from, to, "priority", null)) as Apply }] : []),
    ],
  },
  {
    name: "date",
    aliases: [],
    label: "Date",
    info: "Inserts a date, e.g. /date tomorrow",
    section: "tasks",
    choices: (typed, env) => dateChoices(typed, env, (when) => when, (date) => (view, from, to) => replaceTyped(view, from, to, isoDate(date))),
  },
  {
    name: "daily",
    aliases: ["journal", "dailynote"],
    label: "Link a daily note",
    info: "Links the daily note for a date, e.g. /daily this fri",
    section: "tasks",
    available: (host) => !!host?.dailyNoteLink,
    choices: (typed, env) =>
      dateChoices(
        typed,
        env,
        (when) => `Daily note ${when}`,
        (date) => (view, from, to) => replaceTyped(view, from, to, view.state.facet(linkHost)?.dailyNoteLink?.(date) ?? isoDate(date)),
      ),
  },
];

/* ---------- AI ---------- */

/**
 * The passage "/ask" is about: the paragraph the cursor is in (lines up to a blank line), or,
 * typed on an empty line, the paragraph above it.
 */
export function passageAt(view: EditorView, pos: number): { from: number; to: number; text: string } | null {
  const doc = view.state.doc;
  let n = doc.lineAt(pos).number;
  if (!doc.line(n).text.trim()) {
    while (n > 1 && !doc.line(n).text.trim()) n--;
    if (!doc.line(n).text.trim()) return null;
  }
  let first = n;
  let last = n;
  while (first > 1 && doc.line(first - 1).text.trim()) first--;
  while (last < doc.lines && doc.line(last + 1).text.trim()) last++;
  const raw = doc.sliceString(doc.line(first).from, doc.line(last).to);
  const text = raw.trim();
  if (!text) return null;
  const from = doc.line(first).from + raw.indexOf(text);
  return { from, to: from + text.length, text };
}

const QUICK_QUESTIONS = ["Explain this", "Summarise this", "What else in my notes relates to this?", "What's missing or unclear here?"];

/** Removes what was typed, then asks about the paragraph there. */
const askHere = (question?: string): Apply => (view, from, to) => {
  replaceTyped(view, from, to, "");
  const passage = passageAt(view, from);
  if (passage) view.state.facet(linkHost)?.askAbout?.(passage, question);
};

const aiAction = (kind: Parameters<NonNullable<LinkHost["aiAction"]>>[0]): Apply => (view, from, to) => {
  replaceTyped(view, from, to, "");
  view.state.facet(linkHost)?.aiAction?.(kind);
};

const aiReady = (host: LinkHost | null) => !!host?.aiReady?.();

SLASH_COMMANDS.push(
  {
    name: "ask",
    aliases: ["ai", "question", "explain"],
    label: "Ask AI about this paragraph",
    info: "Asks about the paragraph you're in; type a question after it, e.g. /ask what does this mean",
    section: "ai",
    available: aiReady,
    choices: (typed) =>
      typed
        ? [{ label: `Ask: ${typed.charAt(0).toUpperCase()}${typed.slice(1)}`, detail: "about this paragraph", apply: askHere(typed) }]
        : [
            { label: "Ask about this paragraph…", detail: "type or pick a question", apply: askHere() },
            ...QUICK_QUESTIONS.map((q) => ({ label: q, apply: askHere(q) })),
          ],
  },
  {
    name: "summarise",
    aliases: ["summarize", "summary", "tldr"],
    label: "Summarise this note",
    info: "The AI sums up the note's main points, decisions and open questions, in the chat",
    section: "ai",
    available: aiReady,
    run: aiAction("summarise"),
  },
  {
    name: "links",
    aliases: ["connect", "linkify"],
    label: "Suggest links",
    info: "The AI proposes links to other notes; nothing changes until you apply them",
    section: "ai",
    available: aiReady,
    run: aiAction("suggest-links"),
  },
  {
    name: "tags",
    aliases: ["properties", "autotag"],
    label: "Suggest tags and properties",
    info: "The AI proposes tags and properties, using the ones already in use",
    section: "ai",
    available: aiReady,
    run: aiAction("suggest-properties"),
  },
  {
    name: "review",
    aliases: ["week", "weekly"],
    label: "Review my week",
    info: "What you worked on this week, from the notes you changed, in the chat",
    section: "ai",
    available: aiReady,
    run: aiAction("daily-review"),
  },
);

/** The starting live query: notes with a tag and a status, as a table (shared with the command palette). */
export const QUERY_BLOCK = "```query\n#tag [status:active]\nshow: table status, due\nsort: due\n```";

/* ---------- The menu ---------- */

const MAX_CHOICES = 8;

/** Inside code, frontmatter, links or HTML a "/" is just a character. */
function inPlainText(ctx: CompletionContext, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(ctx.state).resolveInner(pos, 1); node; node = node.parent) {
    if (/Code|Frontmatter|URL|Link|HTML|Comment|Autolink/.test(node.name)) return false;
  }
  return true;
}

export function completeSlash(ctx: CompletionContext, now = new Date()): CompletionResult | null {
  const m = ctx.matchBefore(/(?:^|\s)\/([a-z0-9]*)((?: [^\n[\]]*)?)$/i);
  if (!m) return null;
  const from = m.from + m.text.indexOf("/");
  if (!inPlainText(ctx, from)) return null;
  const typed = (/\/([a-z0-9]*)/i.exec(m.text)?.[1] ?? "").toLowerCase();
  const rest = m.text.slice(m.text.indexOf("/") + 1 + typed.length);
  const host = ctx.state.facet(linkHost);
  const env: Env = { host, now };
  const usable = SLASH_COMMANDS.filter((c) => !c.available || c.available(host));

  // "/", "/ta": the commands, by section.
  if (!rest) {
    const options: Completion[] = usable
      .filter((c) => [c.name, ...c.aliases].some((n) => n.startsWith(typed)))
      .map((c, i) => ({
        label: c.label,
        detail: `/${c.name}`,
        info: c.info,
        type: "command",
        section: SECTIONS[c.section],
        // An exact name first ("/h1", "/code"), then the list's own order.
        boost: c.name === typed || c.aliases.includes(typed) ? 99 : -i,
        apply: (view: EditorView, _c: Completion, f: number, t: number) => {
          if (c.run) return c.run(view, f, t);
          const insert = `/${c.name} `;
          view.dispatch({ changes: { from: f, to: t, insert }, selection: { anchor: f + insert.length }, userEvent: "input.complete" });
          startCompletion(view); // straight on to the choices
        },
      }));
    return options.length ? { from, options, filter: false } : null;
  }

  // "/due this tue", "/callout ti", "/table 3x4": the command's choices.
  const command = usable.find((c) => c.name === typed || c.aliases.includes(typed));
  if (!command?.choices) return null;
  const phrase = rest.trim().toLowerCase().replace(/\s+/g, " ");
  const choices = command.choices(phrase, env).slice(0, MAX_CHOICES);
  if (!choices.length) return null;
  return {
    from,
    filter: false,
    options: choices.map((c, i) => ({
      label: c.label,
      ...(c.detail ? { detail: c.detail } : {}),
      type: "choice",
      boost: -i,
      apply: (view: EditorView, _o: Completion, f: number, t: number) => c.apply(view, f, t),
    })),
  };
}
