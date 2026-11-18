import { afterEach, describe, expect, it, vi } from "vitest";
import { excerpt, fitMessages, runAgent } from "./agent";
import type { ChatMessage } from "./openai-compatible";
import { testEnv } from "./tools.test";

type Reply = { text?: string; calls?: Array<{ name: string; args: unknown }> } | { status: number; error: string };

/** A scripted provider: each request gets the next reply, streamed in small pieces. */
function provider(replies: Reply[]) {
  const bodies: Array<{ messages: ChatMessage[]; tools?: unknown[] }> = [];
  const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    const r = replies.shift() ?? { text: "(no more replies)" };
    if ("status" in r) return new Response(JSON.stringify({ error: { message: r.error } }), { status: r.status });
    const events: unknown[] = [];
    for (const piece of (r.text ?? "").match(/[^]{1,4}/g) ?? []) events.push({ choices: [{ delta: { content: piece } }] });
    (r.calls ?? []).forEach((c, index) => {
      const args = JSON.stringify(c.args);
      events.push({ choices: [{ delta: { tool_calls: [{ index, id: `call${index}`, function: { name: c.name, arguments: args.slice(0, 5) } }] } }] });
      events.push({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(5) } }] } }] });
    });
    events.push({ choices: [{ delta: {}, finish_reason: r.calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  vi.stubGlobal("fetch", fetchFn);
  return { bodies, fetchFn };
}

const env = testEnv({
  "Bread.md": "# Bread\n\nSourdough needs a starter.\n",
  "Soup.md": "# Soup\n\nLentils.\n",
});
const ep = { baseUrl: "https://x.test/v1" };
const question: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "How do I make sourdough?" },
];

afterEach(() => vi.unstubAllGlobals());

describe("runAgent", () => {
  it("runs tools until the model answers", async () => {
    const { bodies } = provider([
      { text: "Let me look.", calls: [{ name: "search_notes", args: { query: "sourdough" } }] },
      { calls: [{ name: "read_note", args: { path: "Bread" } }] },
      { text: "Use a starter, as [[Bread]] says." },
    ]);
    const events: string[] = [];
    const r = await runAgent({ ep, model: "m", messages: question, env, onEvent: (e) => events.push(e.type) });
    expect(r.text).toBe("Use a starter, as [[Bread]] says.");
    expect(r.steps).toEqual(["Searched “sourdough”", "Read Bread"]);
    expect(r.read).toEqual(["Bread.md"]);
    expect(r.mode).toBe("tools");
    expect(r.usage).toEqual({ prompt: 30, completion: 15 });
    expect(events.filter((e) => e === "reset")).toHaveLength(2);
    // The results went back to the model, tied to their calls.
    const last = bodies[2].messages;
    expect(last.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant", "tool"]);
    expect(last[5]).toMatchObject({ role: "tool", tool_call_id: "call0" });
    expect(last[5].content).toContain("Sourdough needs a starter");
    expect(bodies[0].tools?.length).toBeGreaterThan(5);
  });

  it("stops at the step limit and asks for an answer", async () => {
    const loop = { calls: [{ name: "search_notes", args: { query: "x" } }] };
    const { bodies } = provider([loop, loop, { text: "Here's what I found." }]);
    const r = await runAgent({ ep, model: "m", messages: question, env, maxSteps: 2 });
    expect(r.limited).toBe(true);
    expect(r.text).toBe("Here's what I found.");
    expect(bodies[2].tools).toBeUndefined();
    expect(bodies[2].messages.at(-1)?.content).toContain("used all your steps");
  });

  it("answers from search results when the model can't use tools", async () => {
    const { bodies } = provider([{ status: 400, error: "llama3 does not support tools" }, { text: "From [[Bread]]: a starter." }]);
    const modes: string[] = [];
    const r = await runAgent({ ep, model: "m", messages: question, env, onEvent: (e) => e.type === "mode" && modes.push(e.mode) });
    expect(modes).toEqual(["search"]);
    expect(r.mode).toBe("search");
    expect(r.read).toEqual(["Bread.md"]);
    expect(bodies[1].tools).toBeUndefined();
    expect(bodies[1].messages.find((m) => m.content.includes('<note path="Bread.md"'))).toBeTruthy();
  });

  it("goes straight to search for models known not to use tools", async () => {
    const { bodies } = provider([{ text: "ok" }]);
    const r = await runAgent({ ep, model: "m", messages: question, env, tools: false });
    expect(r.mode).toBe("search");
    expect(bodies).toHaveLength(1);
  });

  it("passes other errors on, and stops when aborted", async () => {
    provider([{ status: 401, error: "bad key" }]);
    await expect(runAgent({ ep, model: "m", messages: question, env })).rejects.toMatchObject({ kind: "auth" });
    const ctrl = new AbortController();
    provider([{ calls: [{ name: "search_notes", args: { query: "x" } }] }]);
    const p = runAgent({ ep, model: "m", messages: question, env, signal: ctrl.signal, onEvent: (e) => e.type === "reset" && ctrl.abort() });
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
  });
});

describe("fitting the context", () => {
  it("drops the oldest tool results first", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "q" },
      { role: "tool", content: "a".repeat(100) },
      { role: "tool", content: "b".repeat(100) },
    ];
    fitMessages(msgs, 200);
    expect(msgs[1].content).toContain("Left out");
    expect(msgs[2].content).toBe("b".repeat(100));
  });

  it("searches a question by its keywords", async () => {
    const { keywords } = await import("./agent");
    expect(keywords("How do I make sourdough? What's the starter for?")).toBe("make sourdough what's starter");
  });

  it("excerpts the part of a long note that matches", () => {
    const text = "intro\n".repeat(2000) + "the sourdough part\n" + "outro\n".repeat(2000);
    const e = excerpt(text, "sourdough please", 1000);
    expect(e).toContain("sourdough part");
    expect(e.length).toBeLessThan(1100);
  });
});
