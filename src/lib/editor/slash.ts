import { startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { DATE_PHRASES, describeDate, isoDate, parseNaturalDate, relativeDay } from "../dates/natural";

/**
 * The "/" menu: typing "/" at the start of a line or after a space lists commands; a date
 * command then takes a date in words ("/due this tue") and shows the date it means before
 * anything is written. "24/11", "and/or" and web addresses don't open it.
 */

interface SlashCommand {
  name: string;
  aliases: string[];
  label: string;
  /** What it does, shown in the menu. */
  info: string;
  /** The task field it sets (written as "[due:: 2026-11-24]"); none inserts a plain date. */
  field?: "due" | "scheduled" | "start";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "due", aliases: ["deadline"], label: "Due date", info: "Sets a task's due date, e.g. /due this tue", field: "due" },
  { name: "scheduled", aliases: ["schedule", "sched"], label: "Scheduled date", info: "When to work on it, e.g. /scheduled mon", field: "scheduled" },
  { name: "start", aliases: ["starts", "begin"], label: "Start date", info: "When it can start, e.g. /start next week", field: "start" },
  { name: "date", aliases: ["day"], label: "Date", info: "Inserts a date, e.g. /date tomorrow" },
];

/** What to suggest right after "/due " before anything is typed. */
const STARTERS = ["today", "tomorrow", "this weekend", "next week", "end of month", "in 2 weeks"];

const MAX_OPTIONS = 7;

/** Inside code, frontmatter, links or HTML a "/" is just a character. */
function inPlainText(ctx: CompletionContext, pos: number): boolean {
  for (let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(ctx.state).resolveInner(pos, 1); node; node = node.parent) {
    if (/Code|Frontmatter|URL|Link|HTML|Comment|Autolink/.test(node.name)) return false;
  }
  return true;
}

const findCommand = (typed: string) => SLASH_COMMANDS.find((c) => c.name === typed || c.aliases.includes(typed));

/** Replaces "/due this tue" with the field (dropping the same field elsewhere on the line). */
function insertDate(command: SlashCommand, date: Date) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const iso = isoDate(date);
    const insert = command.field ? `[${command.field}:: ${iso}]` : iso;
    const changes = [{ from, to, insert }];
    if (command.field) {
      const line = view.state.doc.lineAt(from);
      const same = new RegExp(String.raw`\s?\[${command.field}::\s*[^\]]*\]`, "g");
      for (const m of line.text.matchAll(same)) {
        const start = line.from + m.index!;
        const end = start + m[0].length;
        if (end <= from || start >= to) changes.push({ from: start, to: end, insert: "" });
      }
    }
    const change = view.state.changes(changes);
    view.dispatch({ changes: change, selection: { anchor: change.mapPos(to, 1) }, userEvent: "input.complete" });
  };
}

function dateOption(command: SlashCommand, phrase: string, date: Date, now: Date, boost: number): Completion {
  const when = describeDate(date, now);
  return {
    label: command.field ? `${command.label.replace(/ date$/, "")} ${when}` : when,
    detail: `${phrase} · ${relativeDay(date, now)}`,
    type: "date",
    boost,
    apply: insertDate(command, date),
  };
}

export function completeSlash(ctx: CompletionContext, now = new Date()): CompletionResult | null {
  const m = ctx.matchBefore(/(?:^|\s)\/([a-z]*)((?: [^\n[\]]*)?)$/i);
  if (!m) return null;
  const from = m.from + m.text.indexOf("/");
  if (!inPlainText(ctx, from)) return null;
  const typed = (/\/([a-z]*)/i.exec(m.text)?.[1] ?? "").toLowerCase();
  const rest = m.text.slice(m.text.indexOf("/") + 1 + typed.length);

  // "/", "/du": the commands.
  if (!rest) {
    const options: Completion[] = SLASH_COMMANDS.filter((c) => [c.name, ...c.aliases].some((n) => n.startsWith(typed))).map((c, i) => ({
      label: c.label,
      detail: `/${c.name}`,
      info: c.info,
      type: "command",
      boost: -i,
      apply: (view: EditorView, _c: Completion, f: number, t: number) => {
        const insert = `/${c.name} `;
        view.dispatch({ changes: { from: f, to: t, insert }, selection: { anchor: f + insert.length }, userEvent: "input.complete" });
        startCompletion(view); // straight on to the dates
      },
    }));
    return options.length ? { from, options, filter: false } : null;
  }

  // "/due this tue": the date it means, and phrases that finish what's typed.
  const command = findCommand(typed);
  if (!command) return null;
  const phrase = rest.trim().toLowerCase().replace(/\s+/g, " ");
  const options: Completion[] = [];
  const seen = new Set<string>();
  const add = (p: string, boost: number) => {
    const date = parseNaturalDate(p, now);
    // One suggestion per date: "next mon" and "next week" are often the same day.
    if (!date || seen.has(isoDate(date))) return;
    seen.add(isoDate(date));
    options.push(dateOption(command, p, date, now, boost));
  };
  if (!phrase) STARTERS.forEach((p, i) => add(p, -i));
  else {
    add(phrase, 100);
    DATE_PHRASES.filter((p) => p.startsWith(phrase) && p !== phrase).forEach((p, i) => add(p, -i));
  }
  return options.length ? { from, options: options.slice(0, MAX_OPTIONS), filter: false } : null;
}
