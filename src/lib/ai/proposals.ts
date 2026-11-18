import { diffComm } from "node-diff3";
import { mergeText } from "../sync/engine";

/**
 * Changes the agent proposes. Nothing is written until the user applies one;
 * each records the file as it was when proposed, so it can still be applied
 * on top of edits made since (or refused if they clash).
 */
export type ProposalKind = "create" | "append" | "edit" | "property" | "link";

export interface Proposal {
  id: string;
  kind: ProposalKind;
  path: string;
  /** One line for the list, e.g. "Add to the end of Ideas". */
  summary: string;
  /** Text changes: the file when proposed (null: a new file) and as proposed. */
  before: string | null;
  after: string;
  /** Property changes: the key, the new value (undefined removes it), and the old one. */
  property?: { key: string; value: unknown; old: unknown };
  status: "pending" | "applied" | "rejected" | "failed";
  /** Why applying failed. */
  error?: string;
}

export type DiffLine = { kind: "same" | "add" | "del"; text: string } | { kind: "skip"; count: number };

/** A line diff, with long runs of unchanged lines folded to `context` lines around each change. */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  const a = before ? before.split("\n") : [];
  const b = after.split("\n");
  const raw: Array<{ kind: "same" | "add" | "del"; text: string }> = [];
  for (const part of diffComm(a, b)) {
    if ("common" in part && part.common) raw.push(...part.common.map((text) => ({ kind: "same" as const, text })));
    else {
      const p = part as { buffer1: string[]; buffer2: string[] };
      raw.push(...p.buffer1.map((text) => ({ kind: "del" as const, text })), ...p.buffer2.map((text) => ({ kind: "add" as const, text })));
    }
  }
  const near = (i: number) => {
    for (let j = Math.max(0, i - context); j <= Math.min(raw.length - 1, i + context); j++) if (raw[j].kind !== "same") return true;
    return false;
  };
  const out: DiffLine[] = [];
  let skipped = 0;
  raw.forEach((l, i) => {
    if (l.kind !== "same" || near(i)) {
      if (skipped) out.push({ kind: "skip", count: skipped });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ kind: "skip", count: skipped });
  return out;
}

/**
 * The text to write for a proposal, given the file as it is now: the proposal
 * as is when nothing changed, the proposal merged with changes made since, or
 * null when they clash (or a "new" file now exists).
 */
export function rebase(p: Pick<Proposal, "before" | "after">, current: string | undefined): string | null {
  if (p.before === null) return current === undefined ? p.after : null;
  if (current === undefined) return null;
  if (current === p.before) return p.after;
  return mergeText(p.after, p.before, current);
}

/** `text` added at the end of the note, or at the end of the section under `heading`. Null: no such heading. */
export function appendText(content: string, text: string, heading?: string): string | null {
  const add = text.replace(/^\n+|\s+$/g, "");
  if (!heading) {
    const body = content.replace(/\s+$/, "");
    return `${body}${body ? "\n\n" : ""}${add}\n`;
  }
  const want = heading.replace(/^#+\s*/, "").trim().toLowerCase();
  const lines = content.split("\n");
  const start = lines.findIndex((l) => {
    const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    return m && m[2].toLowerCase() === want;
  });
  if (start === -1) return null;
  const level = /^\s{0,3}(#{1,6})/.exec(lines[start])![1].length;
  let end = start + 1;
  while (end < lines.length) {
    const m = /^\s{0,3}(#{1,6})\s/.exec(lines[end]);
    if (m && m[1].length <= level) break;
    end++;
  }
  let at = end;
  while (at > start + 1 && !lines[at - 1].trim()) at--;
  const insert = ["", ...add.split("\n")];
  if (at < lines.length && lines[at].trim() !== "") insert.push("");
  lines.splice(at, 0, ...insert);
  return lines.join("\n");
}

/** `find` replaced by `replace`; it must appear exactly once. */
export function replaceOnce(content: string, find: string, replace: string): { text: string } | { error: string } {
  if (!find) return { error: "Say what text to replace." };
  const first = content.indexOf(find);
  if (first === -1) return { error: "That text isn't in the note. Read the note again and copy the text exactly." };
  if (content.indexOf(find, first + 1) !== -1) return { error: "That text appears more than once. Include more of the surrounding text." };
  return { text: content.slice(0, first) + replace + content.slice(first + find.length) };
}

/** A path for a new note from what the model wrote: ".md" added, slashes tidied. */
export function notePathFrom(ref: string): string {
  const p = ref.trim().replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  return /\.md$/i.test(p) ? p : `${p}.md`;
}

let n = 0;
export const proposalId = () => `p${Date.now().toString(36)}${(n++).toString(36)}`;
