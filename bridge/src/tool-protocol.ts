/**
 * Tool calling for models reached through a command-line agent, which takes
 * plain text in and gives plain text out. The OpenAI-style tool schemas go in
 * the system prompt; the model asks for a tool by writing a
 * <tool_call>{"name": …, "arguments": {…}}</tool_call> block, which is turned
 * back into a tool_calls reply. Earlier calls and their results are written
 * into the transcript the same way.
 */
export interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | Array<{ type: string; text?: string }> | null;
  tool_calls?: Array<{ id: string; type?: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export interface WireTool {
  type: "function";
  function: { name: string; description?: string; parameters?: unknown };
}

export interface ParsedCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const OPEN = "<tool_call>";
const CLOSE = "</tool_call>";

export function textOf(content: WireMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p) => p?.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

/** Instructions for calling the tools, for the end of the system prompt. */
export function toolsPrompt(tools: WireTool[]): string {
  if (!tools.length) return "";
  const list = tools
    .map((t) => `- ${t.function.name}: ${t.function.description ?? ""}\n  Parameters (JSON Schema): ${JSON.stringify(t.function.parameters ?? {})}`)
    .join("\n");
  return [
    "You can call these tools:",
    list,
    "",
    `To call tools, reply with one or more blocks like this, and nothing after them:`,
    `${OPEN}{"name": "search_notes", "arguments": {"query": "garden"}}${CLOSE}`,
    "The results come back in <tool_result> blocks. When you have what you need, answer normally, with no tool_call blocks.",
  ].join("\n");
}

/** The system prompt: the request's system messages, then how to call tools. */
export function systemPrompt(messages: WireMessage[], tools: WireTool[]): string {
  return [...messages.filter((m) => m.role === "system").map((m) => textOf(m.content)), toolsPrompt(tools)].filter(Boolean).join("\n\n");
}

const escapeAttr = (s: string) => s.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);

/** The conversation so far as text, with tool calls and results in place. */
export function transcript(messages: WireMessage[]): string {
  const names = new Map<string, string>();
  const turns: string[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") turns.push(`<user>\n${textOf(m.content)}\n</user>`);
    else if (m.role === "assistant") {
      const calls = (m.tool_calls ?? []).map((c) => {
        names.set(c.id, c.function.name);
        let args: unknown = {};
        try {
          args = JSON.parse(c.function.arguments || "{}");
        } catch {
          args = c.function.arguments;
        }
        return `${OPEN}${JSON.stringify({ name: c.function.name, arguments: args })}${CLOSE}`;
      });
      turns.push(`<assistant>\n${[textOf(m.content), ...calls].filter(Boolean).join("\n")}\n</assistant>`);
    } else if (m.role === "tool") {
      const name = m.name ?? names.get(m.tool_call_id ?? "") ?? "tool";
      turns.push(`<tool_result name="${escapeAttr(name)}">\n${textOf(m.content)}\n</tool_result>`);
    }
  }
  return `${turns.join("\n\n")}\n\nContinue as the assistant.`;
}

/** Splits a reply into its text and the tool calls it asks for. */
export function parseReply(text: string, tools: WireTool[]): { text: string; calls: ParsedCall[] } {
  const known = new Set(tools.map((t) => t.function.name));
  const calls: ParsedCall[] = [];
  const rest = text.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (block, body: string) => {
    try {
      const j = JSON.parse(body) as { name?: unknown; arguments?: unknown };
      if (typeof j.name !== "string" || !known.has(j.name)) return block;
      const args = typeof j.arguments === "string" ? j.arguments : JSON.stringify(j.arguments ?? {});
      calls.push({ id: `call_${calls.length}_${Math.random().toString(36).slice(2, 8)}`, type: "function", function: { name: j.name, arguments: args } });
      return "";
    } catch {
      return block;
    }
  });
  return { text: calls.length ? rest.trim() : text, calls };
}

/**
 * Passes streamed text through until a tool call starts, holding back
 * anything that might be the start of "<tool_call>" until it's clear.
 */
export class ToolCallFilter {
  private held = "";
  private stopped = false;

  constructor(private readonly emit: (text: string) => void) {}

  push(chunk: string) {
    if (this.stopped) return;
    const text = this.held + chunk;
    const at = text.indexOf(OPEN);
    if (at !== -1) {
      if (at > 0) this.emit(text.slice(0, at));
      this.held = "";
      this.stopped = true;
      return;
    }
    // Keep a tail that could still grow into "<tool_call>".
    let keep = 0;
    for (let n = Math.min(OPEN.length - 1, text.length); n > 0; n--) {
      if (OPEN.startsWith(text.slice(-n))) {
        keep = n;
        break;
      }
    }
    if (text.length > keep) this.emit(text.slice(0, text.length - keep));
    this.held = text.slice(text.length - keep);
  }

  end() {
    if (!this.stopped && this.held) this.emit(this.held);
    this.held = "";
  }
}
