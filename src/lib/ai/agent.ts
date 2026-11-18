import { splitFrontmatter } from "../markdown/frontmatter";
import { displayName } from "../vault/paths";
import { AiError, streamChat, type ChatMessage, type Endpoint } from "./openai-compatible";
import { READ_TOOLS, runTool, WRITE_TOOLS, type ToolEnv } from "./tools";
import type { Proposal } from "./proposals";

/**
 * The agent loop: ask the model, run the tools it calls against the
 * repository, send back the results, and repeat until it answers (or the step
 * limit, or Stop). Models that can't use tools get search results instead.
 */
export type AgentEvent =
  | { type: "text"; delta: string }
  /** A step ended in tool calls: any text so far was the model thinking aloud. */
  | { type: "reset" }
  | { type: "step"; label: string; read: string[] }
  | { type: "mode"; mode: "search" }
  | { type: "proposal"; proposal: Proposal };

export interface AgentOptions {
  ep: Endpoint;
  model: string;
  /** System prompt, history and the new question. */
  messages: ChatMessage[];
  env: ToolEnv;
  /** False when the model is known not to support tools. */
  tools?: boolean;
  maxSteps?: number;
  signal?: AbortSignal;
  onEvent?(e: AgentEvent): void;
}

export interface AgentResult {
  text: string;
  /** Notes whose text was sent to the model, in the order read. */
  read: string[];
  steps: string[];
  mode: "tools" | "search";
  /** The step limit was reached and the model was asked to answer with what it had. */
  limited: boolean;
  usage: { prompt: number; completion: number };
}

export const DEFAULT_MAX_STEPS = 12;
/** Roughly how much text the conversation may hold before old tool results are dropped (characters). */
export const CONTEXT_BUDGET = 120_000;

export const WRITE_PROMPT = [
  "You can also propose changes: create_note, append_to_note, edit_note, set_property and add_link.",
  "The user reviews each one and applies or rejects it; nothing changes until then.",
  "Propose only what the user asked for, read a note before changing it, and say briefly what you proposed.",
].join(" ");

export const AGENT_PROMPT = [
  "You can search and read the user's notes with tools. Look things up rather than guessing:",
  "search first, then read the notes that matter (a section is enough when the note is long).",
  "Follow links and hubs to find related notes. Don't read the same note twice.",
  "Cite every note you use as a [[wikilink]] with its name, e.g. [[Project plan]].",
  "If the notes don't answer the question, say so.",
].join(" ");

/** Drops the oldest tool results once the conversation is too long. */
export function fitMessages(messages: ChatMessage[], budget = CONTEXT_BUDGET): ChatMessage[] {
  const size = () => messages.reduce((n, m) => n + m.content.length + JSON.stringify(m.tool_calls ?? "").length, 0);
  const DROPPED = "[Left out to save space. Call the tool again if you need it.]";
  for (const m of messages) {
    if (size() <= budget) break;
    if (m.role === "tool" && m.content !== DROPPED) m.content = DROPPED;
  }
  return messages;
}

/** The best part of a note for a query: the start, or the text around the first match. */
export function excerpt(text: string, query: string, size = 4000): string {
  if (text.length <= size) return text;
  const words = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const lower = text.toLowerCase();
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, text.lastIndexOf("\n", Math.max(0, at - size / 4)) + 1);
  return (start > 0 ? "[…]\n" : "") + text.slice(start, start + size) + "\n[…]";
}

const STOPWORDS = new Set(
  "the and for are but not you your with what when where which who how why does did have has had this that these those from into about was were will would can could should there their them they then than its it's i'm i've a an of to in on at by or is be do my me we our".split(" "),
);

/** The words of a question worth searching for. */
export function keywords(question: string): string {
  return (question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w)).join(" ");
}

/** For models without tools: the notes that best match the question, as context. */
export function searchContext(env: ToolEnv, question: string, limit = 5): { message: ChatMessage; read: string[] } {
  const hits = env.search.searchAny(keywords(question) || question, limit);
  const blocks = hits.map((h) => {
    const body = splitFrontmatter(env.links.content(h.path) ?? "").body;
    return `<note path="${h.path}" name="${displayName(h.path)}">\n${excerpt(body, question)}\n</note>`;
  });
  return {
    message: {
      role: "system",
      content: hits.length
        ? `Notes found by searching for the question (cite them as [[name]]):\n\n${blocks.join("\n\n")}`
        : "Searching the notes for the question found nothing.",
    },
    read: hits.map((h) => h.path),
  };
}

const toolsUnsupported = (e: unknown) =>
  e instanceof AiError && (e.kind === "bad-request" || e.kind === "model") && /tool|function/i.test(e.message);

export async function runAgent(o: AgentOptions): Promise<AgentResult> {
  const maxSteps = o.maxSteps ?? DEFAULT_MAX_STEPS;
  const emit = (e: AgentEvent) => o.onEvent?.(e);
  const read: string[] = [];
  const steps: string[] = [];
  const usage = { prompt: 0, completion: 0 };
  const messages = o.messages.map((m) => ({ ...m }));
  const addRead = (paths: string[]) => paths.forEach((p) => !read.includes(p) && read.push(p));
  const ask = async (tools: boolean) => {
    const r = await streamChat(o.ep, {
      model: o.model,
      messages: fitMessages(messages),
      tools: tools ? (o.env.proposals ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS) : undefined,
      signal: o.signal,
      onText: (delta) => emit({ type: "text", delta }),
    });
    usage.prompt += r.usage?.prompt_tokens ?? 0;
    usage.completion += r.usage?.completion_tokens ?? 0;
    return r;
  };

  const bySearch = async (): Promise<AgentResult> => {
    emit({ type: "mode", mode: "search" });
    const question = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const ctx = searchContext(o.env, question);
    addRead(ctx.read);
    const label = `Searched for the question: ${ctx.read.length} ${ctx.read.length === 1 ? "note" : "notes"}`;
    steps.push(label);
    emit({ type: "step", label, read: ctx.read });
    messages.splice(messages.length - 1, 0, ctx.message);
    const r = await ask(false);
    return { text: r.text, read, steps, mode: "search", limited: false, usage };
  };

  if (o.tools === false) return bySearch();

  for (let step = 0; step < maxSteps; step++) {
    let r;
    try {
      r = await ask(true);
    } catch (e) {
      if (step === 0 && toolsUnsupported(e)) return bySearch();
      throw e;
    }
    if (!r.toolCalls.length) return { text: r.text, read, steps, mode: "tools", limited: false, usage };
    emit({ type: "reset" });
    messages.push({ role: "assistant", content: r.text, tool_calls: r.toolCalls });
    for (const call of r.toolCalls) {
      if (o.signal?.aborted) throw new AiError("Stopped.", "aborted");
      const res = runTool(o.env, call.function.name, call.function.arguments);
      addRead(res.read);
      steps.push(res.label);
      emit({ type: "step", label: res.label, read: res.read });
      if (res.proposal) emit({ type: "proposal", proposal: res.proposal });
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: res.content });
    }
  }
  // Out of steps: answer with what's been found.
  messages.push({ role: "system", content: "You've used all your steps. Answer now from what you found, and say what's missing." });
  const r = await ask(false);
  return { text: r.text, read, steps, mode: "tools", limited: true, usage };
}
