import { splitFrontmatter } from "../markdown/frontmatter";

/**
 * Tasks: every "- [ ] …" in the repository's notes. Dates and priorities are
 * read the way Obsidian's Tasks and Dataview plugins write them, so a
 * repository that already uses them shows the same tasks here:
 * "📅 2026-11-20" or "[due:: 2026-11-20]", "⏳"/"🛫" for scheduled/start,
 * "✅ 2026-11-20" for done, and ⏫ 🔼 🔽 (or 🔺 ⏬) for priority.
 */
export interface Task {
  path: string;
  /** 0-based line in the note (counting frontmatter). */
  line: number;
  /** Offset of the line's start in the note. */
  offset: number;
  /** The character in the box: " " open, "x" done, others ("/", "-", ">") as Obsidian themes use them. */
  mark: string;
  done: boolean;
  /** "-" (cancelled) tasks count as done but aren't shown with open ones. */
  cancelled: boolean;
  /** The text after the box, without dates and priority markers. */
  text: string;
  /** The line as written, to check it's still there before changing it. */
  raw: string;
  due?: string;
  scheduled?: string;
  completed?: string;
  priority: Priority;
  tags: string[];
  /** The heading it's under, if any. */
  heading?: string;
  /** Nesting depth (0 = top level). */
  depth: number;
}

export type Priority = "highest" | "high" | "medium" | "none" | "low" | "lowest";
export const PRIORITY_ORDER: Priority[] = ["highest", "high", "medium", "none", "low", "lowest"];

const TASK = /^(\s*)(?:[-*+]|\d+[.)])\s+\[(.)\]\s?(.*)$/;
const DATE = String.raw`(\d{4}-\d{2}-\d{2})`;
const FIELDS: Array<[keyof Pick<Task, "due" | "scheduled" | "completed">, RegExp[]]> = [
  ["due", [new RegExp(`(?:📅|🗓️?)\\s*${DATE}`, "u"), new RegExp(String.raw`\[due::\s*${DATE}\]`), new RegExp(String.raw`\bdue::\s*${DATE}`)]],
  ["scheduled", [new RegExp(`(?:⏳|🛫)\\s*${DATE}`, "u"), new RegExp(String.raw`\[(?:scheduled|start)::\s*${DATE}\]`)]],
  ["completed", [new RegExp(`✅\\s*${DATE}`, "u"), new RegExp(String.raw`\[completion::\s*${DATE}\]`)]],
];
const PRIORITIES: Array<[string, Priority]> = [
  ["🔺", "highest"],
  ["⏫", "high"],
  ["🔼", "medium"],
  ["🔽", "low"],
  ["⏬", "lowest"],
];

/** The tasks in one note. Code blocks and frontmatter are skipped. */
export function parseTasks(path: string, content: string): Task[] {
  const { frontmatter } = splitFrontmatter(content);
  const lines = content.split("\n");
  const skip = frontmatter !== null ? content.slice(0, content.length - splitFrontmatter(content).body.length).split("\n").length - 1 : 0;
  const tasks: Task[] = [];
  let offset = 0;
  let fence: string | null = null;
  let heading: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = offset;
    offset += line.length + 1;
    if (i < skip) continue;
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      heading = h[1];
      continue;
    }
    const m = TASK.exec(line);
    if (!m) continue;
    const [, indent, mark, rest] = m;
    let text = rest;
    const task: Task = {
      path,
      line: i,
      offset: start,
      mark,
      done: mark.toLowerCase() === "x" || mark === "-",
      cancelled: mark === "-",
      text: "",
      raw: line,
      priority: "none",
      tags: [...rest.matchAll(/(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu)].map((t) => t[1].toLowerCase()),
      depth: Math.floor(indent.replace(/\t/g, "    ").length / 2),
      ...(heading ? { heading } : {}),
    };
    for (const [key, patterns] of FIELDS) {
      for (const re of patterns) {
        const d = re.exec(text);
        if (d) {
          task[key] = d[1];
          text = text.replace(re, "");
          break;
        }
      }
    }
    for (const [sym, p] of PRIORITIES) {
      if (text.includes(sym)) {
        task.priority = p;
        text = text.replace(sym, "");
        break;
      }
    }
    // Other Tasks-plugin markers (recurrence 🔁 …, created ➕ date) are left out of the text.
    task.text = text
      .replace(/🔁[^📅⏳🛫✅➕]*/u, "")
      .replace(new RegExp(`➕\\s*${DATE}`, "u"), "")
      .replace(/\s{2,}/g, " ")
      .trim();
    tasks.push(task);
  }
  return tasks;
}

/** The note with one task's box ticked or cleared; null if the line has changed since. */
export function toggleTask(content: string, task: Pick<Task, "line" | "raw">, done: boolean, today?: string): string | null {
  const lines = content.split("\n");
  if (lines[task.line] !== task.raw) return null;
  const m = TASK.exec(task.raw);
  if (!m) return null;
  const box = task.raw.indexOf(`[${m[2]}]`, m[1].length);
  let line = task.raw.slice(0, box) + (done ? "[x]" : "[ ]") + task.raw.slice(box + 3);
  // Tasks written in the Tasks plugin's style (with 📅 ⏳ 🛫 dates) also record when they were done.
  if (today && done && /📅|⏳|🛫/u.test(line) && !/✅\s*\d{4}-\d{2}-\d{2}/u.test(line)) line = `${line.replace(/\s+$/, "")} ✅ ${today}`;
  if (!done) line = line.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, "");
  lines[task.line] = line;
  return lines.join("\n");
}

export type DueGroup = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export const DUE_LABELS: Record<DueGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Next 7 days",
  later: "Later",
  none: "No date",
};

const dayNumber = (d: string) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000);

/** Which group a task's due (or scheduled) date puts it in, as of `today` (YYYY-MM-DD). */
export function dueGroup(task: Pick<Task, "due" | "scheduled">, today: string): DueGroup {
  const d = task.due ?? task.scheduled;
  if (!d) return "none";
  const diff = dayNumber(d) - dayNumber(today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= 7) return "week";
  return "later";
}

/** Earliest date first, then priority, then where it is. */
export function compareTasks(a: Task, b: Task): number {
  const da = a.due ?? a.scheduled ?? "9999";
  const db = b.due ?? b.scheduled ?? "9999";
  return (
    da.localeCompare(db) ||
    PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
    a.path.localeCompare(b.path) ||
    a.line - b.line
  );
}

export interface TaskQuery {
  status?: "open" | "done" | "all";
  /** Words that must all appear in the task's text, note name or tags. */
  text?: string;
  /** Tasks due (or scheduled) on or before this date. */
  dueBefore?: string;
}

export function filterTasks(tasks: Task[], q: TaskQuery): Task[] {
  const words = (q.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return tasks.filter((t) => {
    if ((q.status ?? "open") === "open" && t.done) return false;
    if (q.status === "done" && !t.done) return false;
    if (q.dueBefore) {
      const d = t.due ?? t.scheduled;
      if (!d || d > q.dueBefore) return false;
    }
    const hay = `${t.text} ${t.path} ${t.tags.map((x) => "#" + x).join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w.replace(/^#/, "#")));
  });
}
