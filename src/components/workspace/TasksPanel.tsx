"use client";

import { ArrowUp, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { todayStamp } from "@/lib/links/health";
import { readPref, writePref } from "@/lib/prefs";
import { DUE_LABELS, compareTasks, dueGroup, filterTasks, parseTasks, type DueGroup, type Task } from "@/lib/tasks/tasks";
import { displayName, isNote } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";

type Status = "open" | "done" | "all";
type GroupBy = "due" | "note";

const GROUP_ORDER: DueGroup[] = ["overdue", "today", "tomorrow", "week", "later", "none"];
const PRIORITY_MARK: Partial<Record<Task["priority"], string>> = { highest: "🔺", high: "⏫", medium: "🔼", low: "🔽", lowest: "⏬" };

/** Every task in the repository's notes, by due date or by note, ticked off in place. */
export function TasksPanel({
  onOpen,
  onToggle,
}: {
  /** Opens a note with the cursor at `offset`. */
  onOpen(path: string, offset: number): void;
  /** Ticks or clears a task in its note; false if the note changed and the task wasn't found. */
  onToggle(task: Task, done: boolean): Promise<boolean>;
}) {
  const vault = useVault();
  const [status, setStatus] = useState<Status>("open");
  const [groupBy, setGroupByState] = useState<GroupBy>(() => (readPref<string>("tasks:groupBy", "due") === "note" ? "note" : "due"));
  const setGroupBy = (g: GroupBy) => {
    setGroupByState(g);
    writePref("tasks:groupBy", g);
  };
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const active = vault.active?.path;
  const today = todayStamp();

  // Other notes as saved (recomputed when the index changes), the open one as typed.
  const others = useMemo(
    () => vault.links.paths().filter((p) => isNote(p) && p !== active).flatMap((p) => parseTasks(p, vault.links.content(p) ?? "")),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
    [vault.links, vault.indexVersion, active],
  );
  const open = useMemo(() => (active && isNote(active) ? parseTasks(active, vault.activeText) : []), [active, vault.activeText]);
  const all = useMemo(() => [...others, ...open].sort(compareTasks), [others, open]);
  const counts = useMemo(() => ({ open: all.filter((t) => !t.done).length, done: all.filter((t) => t.done).length, all: all.length }), [all]);
  const shown = useMemo(() => filterTasks(all, { status, text: query }), [all, status, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; tasks: Task[]; tone?: string }>();
    if (groupBy === "due") {
      for (const g of GROUP_ORDER) map.set(g, { key: g, label: DUE_LABELS[g], tasks: [], tone: g === "overdue" ? "text-[#c2412d]" : undefined });
      for (const t of shown) map.get(dueGroup(t, today))!.tasks.push(t);
    } else {
      for (const t of [...shown].sort((a, b) => displayName(a.path).localeCompare(displayName(b.path)) || a.line - b.line)) {
        if (!map.has(t.path)) map.set(t.path, { key: t.path, label: displayName(t.path), tasks: [] });
        map.get(t.path)!.tasks.push(t);
      }
    }
    return [...map.values()].filter((g) => g.tasks.length);
  }, [shown, groupBy, today]);

  const toggle = async (t: Task, done: boolean) => {
    setMessage(null);
    if (!(await onToggle(t, done))) setMessage(`“${t.text}” changed in its note since. The list is up to date now; try again.`);
  };

  return (
    <section aria-label="Tasks" className="flex h-full flex-col text-sm">
      <div className="mb-2 flex flex-col gap-1.5 px-1">
        <div className="flex items-center gap-1.5">
          <input
            className="input min-w-0 flex-1 py-1 text-sm"
            type="search"
            aria-label="Filter tasks"
            placeholder="Filter tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="input w-auto shrink-0 py-1 pr-6 text-xs" aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="due">By date</option>
            <option value="note">By note</option>
          </select>
        </div>
        <div role="radiogroup" aria-label="Show" className="segmented flex text-xs">
          {(
            [
              ["open", "Open"],
              ["done", "Done"],
              ["all", "All"],
            ] as const
          ).map(([st, label]) => (
            <button key={st} type="button" role="radio" aria-checked={status === st} onClick={() => setStatus(st)}>
              {label} <span className="text-muted tabular-nums">{counts[st]}</span>
            </button>
          ))}
        </div>
      </div>
      {message && (
        <p role="status" className="mx-1 mb-2 rounded-md bg-accent/10 px-2 py-1 text-xs">
          {message}
        </p>
      )}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {groups.length === 0 && (
          <p className="px-2 py-4 text-muted">
            {all.length === 0
              ? "No tasks yet. Write “- [ ] something” in any note (Ctrl/Cmd+Shift+9 makes a task list); add 📅 2026-12-01 for a due date."
              : query
                ? "No tasks match."
                : status === "open"
                  ? "Nothing open. 🎉"
                  : "No tasks here."}
          </p>
        )}
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.key);
          return (
            <div key={g.key} role="group" aria-label={g.label} className="mb-2">
              <button
                type="button"
                className={`flex w-full items-center gap-1 px-1 py-0.5 text-left text-xs font-medium ${g.tone ?? "text-muted"} hover:text-foreground`}
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((c) => {
                    const n = new Set(c);
                    if (n.has(g.key)) n.delete(g.key);
                    else n.add(g.key);
                    return n;
                  })
                }
              >
                <ChevronRight size={11} aria-hidden className={`shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
                <span className="truncate">{g.label}</span>
                <span className="ml-auto tabular-nums">{g.tasks.length}</span>
              </button>
              {!isCollapsed && (
                <ul>
                  {g.tasks.map((t) => (
                    <TaskRow key={`${t.path}:${t.line}`} task={t} today={today} showNote={groupBy === "due"} onOpen={onOpen} onToggle={toggle} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** "Call [[Ann|Annie]] about [the plan](Plan.md)" shown as "Call Annie about the plan". */
export function taskLabel(text: string): string {
  return text
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias ?? target.split("#")[0])
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|==|~~|`)/g, "");
}

function TaskRow({
  task: t,
  today,
  showNote,
  onOpen,
  onToggle,
}: {
  task: Task;
  today: string;
  showNote: boolean;
  onOpen(path: string, offset: number): void;
  onToggle(t: Task, done: boolean): void;
}) {
  const label = taskLabel(t.text) || "(empty task)";
  const date = t.due ?? t.scheduled;
  const overdue = !t.done && date !== undefined && date < today;
  return (
    <li className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-foreground/5" style={{ paddingLeft: `${0.25 + Math.min(t.depth, 4) * 0.75}rem` }}>
      <input
        type="checkbox"
        className="mt-0.5 shrink-0 accent-[var(--accent)]"
        aria-label={`Done: ${label}`}
        checked={t.done}
        onChange={(e) => onToggle(t, e.target.checked)}
      />
      <button type="button" className="min-w-0 flex-1 text-left" title={`Open in ${displayName(t.path)}`} onClick={() => onOpen(t.path, t.offset)}>
        <span className={`block break-words ${t.done ? "text-muted line-through" : ""}`}>
          {PRIORITY_MARK[t.priority] && <span aria-label={`${t.priority} priority`}>{PRIORITY_MARK[t.priority]} </span>}
          {label}
        </span>
        <span className="flex flex-wrap gap-x-2 text-[11px] text-muted">
          {date && (
            <span className={overdue ? "text-[#c2412d]" : ""}>
              {t.due ? "Due" : "Scheduled"} {date}
            </span>
          )}
          {showNote && <span className="truncate">{displayName(t.path)}</span>}
          {t.heading && <span className="truncate">› {t.heading}</span>}
        </span>
      </button>
      <ArrowUp size={12} aria-hidden className="mt-1 shrink-0 rotate-45 text-muted opacity-0 group-hover:opacity-100" />
    </li>
  );
}
