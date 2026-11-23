import { addressSpaceHint, normalizeBaseUrl } from "./providers";

/**
 * A small client for OpenAI-compatible Chat Completions, called from the
 * browser. Streams text as it arrives and collects tool calls, so the agent
 * loop (phase B) can build on it.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Endpoint {
  baseUrl: string;
  apiKey?: string;
  /** Set for OpenRouter: it shows the app's name in the user's activity. */
  openRouter?: boolean;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  signal?: AbortSignal;
  onText?(delta: string): void;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** A failure explained in plain words, with what kind of failure it was. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "credits" | "rate" | "model" | "network" | "server" | "bad-request" | "aborted",
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export function requestHeaders(ep: Endpoint): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (ep.apiKey) h.Authorization = `Bearer ${ep.apiKey}`;
  if (ep.openRouter) {
    if (typeof location !== "undefined") h["HTTP-Referer"] = location.origin;
    h["X-Title"] = "Cognotive.ai";
  }
  return h;
}

/** Turns an HTTP error from a provider into something a person can act on. */
export function errorFor(status: number, body: string): AiError {
  let detail = "";
  try {
    const j = JSON.parse(body);
    detail = String(j?.error?.message ?? j?.message ?? j?.error ?? "");
  } catch {
    detail = body.slice(0, 200);
  }
  const tail = detail ? ` (${detail})` : "";
  if (status === 401) return new AiError("The API key was refused. Check it in Settings → AI.", "auth", status);
  if (status === 402) return new AiError("Your account is out of credits. Add some with the provider, or pick a free model.", "credits", status);
  if (status === 403) return new AiError(`The provider refused the request${tail}.`, "auth", status);
  if (status === 404) return new AiError(`The model wasn't found. Pick another in Settings → AI${tail}.`, "model", status);
  if (status === 429) return new AiError("Too many requests just now. Wait a moment and try again.", "rate", status);
  if (status >= 500) return new AiError(`The provider had a problem (HTTP ${status}). Try again shortly.`, "server", status);
  return new AiError(`The request failed (HTTP ${status})${tail}.`, "bad-request", status);
}

/** Splits an SSE buffer into complete events' data, returning the rest. */
export function drainEvents(buffer: string, onData: (data: string) => void): string {
  let m = /\r?\n\r?\n/.exec(buffer);
  while (m) {
    const frame = buffer.slice(0, m.index);
    buffer = buffer.slice(m.index + m[0].length);
    const data = frame
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (data) onData(data);
    m = /\r?\n\r?\n/.exec(buffer);
  }
  return buffer;
}

/** Folds streamed chunks into text and whole tool calls. */
export class ChunkAccumulator {
  text = "";
  finishReason: string | null = null;
  usage: ChatResult["usage"];
  private calls: ToolCall[] = [];

  /** Returns the text added by this chunk. */
  add(chunk: unknown): string {
    const c = chunk as {
      choices?: { delta?: { content?: string | null; tool_calls?: unknown[] }; finish_reason?: string | null }[];
      usage?: ChatResult["usage"];
      error?: { message?: string };
    };
    if (c?.error) throw new AiError(c.error.message || "The provider reported an error.", "server");
    if (c?.usage) this.usage = c.usage;
    const choice = c?.choices?.[0];
    if (!choice) return "";
    if (choice.finish_reason) this.finishReason = choice.finish_reason;
    const delta = choice.delta ?? {};
    for (const raw of delta.tool_calls ?? []) {
      const t = raw as { index?: number; id?: string; function?: { name?: string; arguments?: string } };
      const i = t.index ?? this.calls.length;
      const call = (this.calls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      if (t.id) call.id = t.id;
      if (t.function?.name) call.function.name += t.function.name;
      if (t.function?.arguments) call.function.arguments += t.function.arguments;
    }
    const text = typeof delta.content === "string" ? delta.content : "";
    this.text += text;
    return text;
  }

  toolCalls(): ToolCall[] {
    return this.calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i}` }));
  }
}

/** Sends a chat and streams the reply. Throws AiError on failure (kind "aborted" when stopped). */
export async function streamChat(ep: Endpoint, req: ChatRequest): Promise<ChatResult> {
  const base = normalizeBaseUrl(ep.baseUrl);
  if (!base) throw new AiError("Set the provider's address in Settings → AI.", "bad-request");
  const url = `${base}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: requestHeaders(ep),
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        // OpenRouter reports tokens used at the end of the stream when asked.
        ...(ep.openRouter ? { stream_options: { include_usage: true } } : {}),
      }),
      signal: req.signal,
      ...addressSpaceHint(url),
    } as RequestInit);
  } catch (e) {
    if (req.signal?.aborted) throw new AiError("Stopped.", "aborted");
    throw new AiError(`Couldn't reach ${new URL(url).host}. ${(e as Error).message || ""}`.trim(), "network");
  }
  if (!res.ok) throw errorFor(res.status, await res.text().catch(() => ""));

  const acc = new ChunkAccumulator();
  const onData = (data: string) => {
    if (data === "[DONE]") return;
    let chunk: unknown;
    try {
      chunk = JSON.parse(data);
    } catch {
      return; // keep-alive comments and partial junk
    }
    const t = acc.add(chunk);
    if (t) req.onText?.(t);
  };

  const type = res.headers.get("content-type") ?? "";
  if (!res.body || type.includes("application/json")) {
    // A server that ignored stream: true and sent one whole reply.
    const j = (await res.json()) as {
      choices?: { message?: { content?: string; tool_calls?: ToolCall[] }; finish_reason?: string }[];
      usage?: ChatResult["usage"];
    };
    const m = j.choices?.[0]?.message;
    const text = m?.content ?? "";
    if (text) req.onText?.(text);
    return { text, toolCalls: m?.tool_calls ?? [], finishReason: j.choices?.[0]?.finish_reason ?? null, usage: j.usage };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = drainEvents(buffer + decoder.decode(value, { stream: true }), onData);
    }
    drainEvents(buffer + decoder.decode() + "\n\n", onData);
  } catch (e) {
    if (req.signal?.aborted) throw new AiError("Stopped.", "aborted");
    if (e instanceof AiError) throw e;
    throw new AiError(`The reply was cut off. ${(e as Error).message || ""}`.trim(), "network");
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
  return { text: acc.text, toolCalls: acc.toolCalls(), finishReason: acc.finishReason, usage: acc.usage };
}
