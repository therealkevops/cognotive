import { AGENT_PROMPT } from "./agent";
import type { ChatMessage } from "./openai-compatible";

/** About how much note text goes with a question (characters; ~6k tokens). */
export const NOTE_BUDGET = 24_000;

export interface NoteContext {
  path: string;
  text: string;
}

export const SYSTEM_PROMPT = [
  "You are the assistant inside noted-ai, a markdown notes app.",
  "Answer from the user's notes when they're given, and say so when the notes don't cover something.",
  "Write in markdown. Refer to notes with [[wikilinks]] using their names.",
  "Be concise.",
].join(" ");

/** Cuts long text at a line break near the budget, saying it was cut. */
export function fitText(text: string, budget = NOTE_BUDGET): { text: string; cut: boolean } {
  if (text.length <= budget) return { text, cut: false };
  const at = text.lastIndexOf("\n", budget);
  return { text: text.slice(0, at > budget * 0.8 ? at : budget) + "\n\n[…the rest of the note was left out]", cut: true };
}

/**
 * The messages sent for a conversation: instructions, the open note, then the
 * turns so far. `agent`: the model can use tools to read notes. `openPath`: the
 * note on screen when its text isn't sent, so "this note" can still be looked up.
 */
export function buildMessages(
  turns: ChatMessage[],
  note: NoteContext | null,
  opts: { agent?: boolean; openPath?: string | null } = {},
): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: opts.agent ? `${SYSTEM_PROMPT} ${AGENT_PROMPT}` : SYSTEM_PROMPT }];
  if (!note && opts.openPath && opts.agent) {
    out.push({ role: "system", content: `The user has "${opts.openPath}" open, but didn't include it. Read it only if the question is about it.` });
  }
  if (note) {
    const { text } = fitText(note.text);
    out.push({
      role: "system",
      content: `The user has this note open, "${note.path}":\n\n<note path="${note.path}">\n${text}\n</note>`,
    });
  }
  return [...out, ...turns];
}

/** A short title for a conversation, from its first question. */
export function chatTitle(question: string): string {
  const line = question.trim().split("\n")[0].replace(/[\\/:*?"<>|#^[\]]/g, "").trim();
  return line.length > 60 ? line.slice(0, 57).trimEnd() + "…" : line || "Chat";
}
