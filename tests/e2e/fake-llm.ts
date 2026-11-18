import type { Page, Route } from "@playwright/test";

type Message = { role: string; content: string; tool_call_id?: string; tool_calls?: unknown[] };
/** A scripted reply: text, or tool calls (with optional text first). */
export type Reply = string | { text?: string; calls: Array<{ name: string; args: Record<string, unknown> }> };
export interface ChatCall {
  host: string;
  model: string;
  messages: Message[];
  /** Names of the tools offered. */
  tools: string[];
  auth?: string;
  headers: Record<string, string>;
}

/**
 * OpenAI-compatible AI providers, served to the browser through Playwright
 * route interception: OpenRouter (https://openrouter.ai/api/v1) and a local
 * Ollama (http://localhost:11434/v1). Tests never reach a real provider.
 */
export class FakeLLM {
  calls: ChatCall[] = [];
  /** OpenRouter keys that work. */
  keys = new Set(["sk-or-v1-good-key-0123456789abcdefghij"]);
  /** Ollama answers without CORS headers, as it does when OLLAMA_ORIGINS doesn't allow the site. */
  localBlocksOrigin = false;
  localModels = ["llama3.2:latest", "qwen3:8b"];
  /** The local server refuses tools, as Ollama does for models without tool support. */
  localNoTools = false;
  /** Replies used in order before falling back to `reply`. */
  script: Reply[] = [];
  /** Replies: a function of the request, or the default (echoes the question and the note it saw). */
  reply: (call: ChatCall) => Reply = (call) => {
    const q = [...call.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const note = call.messages.find((m) => m.role === "system" && m.content.includes("<note path="));
    const path = note ? /<note path="([^"]+)"/.exec(note.content)![1] : null;
    return `You asked **${q}**.${path ? ` I read [[${path.replace(/\.md$/, "")}]].` : " No note was sent."}`;
  };
  /** Next chat requests wait for `release()` (to test Stop), or fail with this status. */
  private holding: (() => void)[] | null = null;
  failNext: { status: number; body: unknown } | null = null;

  hold() {
    this.holding = [];
  }
  release() {
    const h = this.holding ?? [];
    this.holding = null;
    h.forEach((r) => r());
  }

  async install(page: Page) {
    await page.route("https://openrouter.ai/api/v1/**", (r) => this.handle(r, "openrouter"));
    await page.route("http://localhost:11434/**", (r) => this.handle(r, "local"));
  }

  private async handle(route: Route, host: "openrouter" | "local") {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1|^\/v1/, "");
    const cors: Record<string, string> =
      host === "local" && this.localBlocksOrigin ? {} : { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body, headers: cors });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "GET,POST" } });

    // Without CORS headers the browser hides the reply from the page; a no-cors
    // request (sent without an Origin header) still gets through.
    if (host === "local" && this.localBlocksOrigin && req.headers()["origin"]) return route.abort("failed");
    const auth = req.headers()["authorization"];
    const keyOk = host === "local" || (auth && this.keys.has(auth.replace(/^Bearer /, "")));

    if (path === "/models" && req.method() === "GET") {
      if (host === "local") return json({ object: "list", data: this.localModels.map((id) => ({ id, object: "model" })) });
      return json({
        data: [
          {
            id: "anthropic/claude-sonnet-4.5",
            name: "Anthropic: Claude Sonnet 4.5",
            context_length: 200000,
            supported_parameters: ["tools"],
            pricing: { prompt: "0.000003", completion: "0.000015" },
          },
          { id: "openai/gpt-5", name: "OpenAI: GPT-5", supported_parameters: ["tools"], pricing: { prompt: "0.00000125", completion: "0.00001" } },
          { id: "meta-llama/llama-3.3-8b:free", name: "Meta: Llama 3.3 8B (free)", supported_parameters: [], pricing: { prompt: "0", completion: "0" } },
        ],
      });
    }
    if (path === "/key" && host === "openrouter") {
      if (!keyOk) return json({ error: { message: "No auth credentials found", code: 401 } }, 401);
      return json({ data: { label: "sk-or-v1-goo...hij", usage: 0.42, limit: 5, is_free_tier: false } });
    }
    if (path === "/chat/completions" && req.method() === "POST") {
      if (!keyOk) return json({ error: { message: "No auth credentials found", code: 401 } }, 401);
      const body = JSON.parse(req.postData() ?? "{}");
      const tools = (body.tools ?? []).map((t: { function: { name: string } }) => t.function.name);
      const call: ChatCall = { host, model: body.model, messages: body.messages, tools, auth, headers: req.headers() };
      this.calls.push(call);
      if (host === "local" && this.localNoTools && tools.length) {
        return json({ error: { message: `registry.ollama.ai/library/${body.model} does not support tools` } }, 400);
      }
      if (this.failNext) {
        const f = this.failNext;
        this.failNext = null;
        return json(f.body, f.status);
      }
      if (this.holding) {
        await new Promise<void>((r) => this.holding!.push(r));
        // The page stopped waiting: nothing more to send.
        return route.abort().catch(() => {});
      }
      const r = this.script.length ? this.script.shift()! : this.reply(call);
      const reply = typeof r === "string" ? { text: r, calls: [] } : r;
      const words = (reply.text ?? "").split(/(?<= )/).filter(Boolean);
      const events: unknown[] = words.map((w) => ({ choices: [{ index: 0, delta: { content: w } }] }));
      reply.calls.forEach((c, index) => {
        // Arguments arrive in pieces, as real providers send them.
        const args = JSON.stringify(c.args);
        const cut = Math.ceil(args.length / 2);
        events.push({ choices: [{ index: 0, delta: { tool_calls: [{ index, id: `call_${this.calls.length}_${index}`, type: "function", function: { name: c.name, arguments: args.slice(0, cut) } }] } }] });
        events.push({ choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: args.slice(cut) } }] } }] });
      });
      events.push({ choices: [{ index: 0, delta: {}, finish_reason: reply.calls.length ? "tool_calls" : "stop" }], usage: { prompt_tokens: 900, completion_tokens: 100 } });
      return route.fulfill({
        status: 200,
        headers: { ...cors, "Content-Type": "text/event-stream" },
        body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + ": keep-alive\n\ndata: [DONE]\n\n",
      });
    }
    return json({ error: { message: `Not found: ${path}` } }, 404);
  }
}
