import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, ChunkAccumulator, drainEvents, errorFor, requestHeaders, streamChat } from "./openai-compatible";

const sse = (events: unknown[], { split = 7 } = {}) => {
  const text = events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        // Arrive in awkward pieces, as a network would deliver them.
        for (let i = 0; i < bytes.length; i += split) c.enqueue(bytes.slice(i, i + split));
        c.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
};
const delta = (content: string) => ({ choices: [{ delta: { content } }] });

afterEach(() => vi.unstubAllGlobals());

describe("drainEvents", () => {
  it("returns data of whole events and keeps the rest", () => {
    const got: string[] = [];
    const rest = drainEvents('data: {"a":1}\n\n: keep-alive\n\ndata: x\r\ndata: y\r\n\r\ndata: par', (d) => got.push(d));
    expect(got).toEqual(['{"a":1}', "x\ny"]);
    expect(rest).toBe("data: par");
  });
});

describe("ChunkAccumulator", () => {
  it("joins text and tool-call fragments", () => {
    const acc = new ChunkAccumulator();
    acc.add(delta("Hel"));
    acc.add(delta("lo"));
    acc.add({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "search", arguments: '{"q"' } }] } }] });
    acc.add({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':"x"}' } }] }, finish_reason: "tool_calls" }] });
    expect(acc.text).toBe("Hello");
    expect(acc.finishReason).toBe("tool_calls");
    expect(acc.toolCalls()).toEqual([{ id: "c1", type: "function", function: { name: "search", arguments: '{"q":"x"}' } }]);
  });

  it("throws errors sent mid-stream", () => {
    expect(() => new ChunkAccumulator().add({ error: { message: "overloaded" } })).toThrow("overloaded");
  });
});

describe("errorFor", () => {
  it("explains common failures", () => {
    expect(errorFor(401, "").kind).toBe("auth");
    expect(errorFor(402, "").kind).toBe("credits");
    expect(errorFor(429, "").kind).toBe("rate");
    expect(errorFor(404, '{"error":{"message":"No such model"}}').message).toContain("No such model");
    expect(errorFor(503, "").kind).toBe("server");
  });
});

describe("requestHeaders", () => {
  it("adds the key and OpenRouter's app headers", () => {
    const h = requestHeaders({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-or-1", openRouter: true });
    expect(h.Authorization).toBe("Bearer sk-or-1");
    expect(h["X-Title"]).toBe("Cognotive.ai");
    expect(requestHeaders({ baseUrl: "http://localhost:11434/v1" }).Authorization).toBeUndefined();
  });
});

describe("streamChat", () => {
  it("streams text deltas", async () => {
    const fetchFn = vi.fn(async () => sse([delta("Hi "), delta("there"), { choices: [{ delta: {}, finish_reason: "stop" }] }, "[DONE]"]));
    vi.stubGlobal("fetch", fetchFn);
    const parts: string[] = [];
    const r = await streamChat(
      { baseUrl: "http://localhost:11434/v1/" },
      { model: "llama3.2", messages: [{ role: "user", content: "hi" }], onText: (t) => parts.push(t) },
    );
    expect(r.text).toBe("Hi there");
    expect(r.finishReason).toBe("stop");
    expect(parts.join("")).toBe("Hi there");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit & { targetAddressSpace?: string }];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init.targetAddressSpace).toBe("loopback");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "llama3.2", stream: true });
  });

  it("accepts a whole (non-streamed) reply", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ choices: [{ message: { content: "Whole" }, finish_reason: "stop" }] }));
    const r = await streamChat({ baseUrl: "https://x.test/v1" }, { model: "m", messages: [] });
    expect(r.text).toBe("Whole");
  });

  it("reports HTTP errors and unreachable servers", async () => {
    vi.stubGlobal("fetch", async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    await expect(streamChat({ baseUrl: "https://x.test/v1" }, { model: "m", messages: [] })).rejects.toMatchObject({ kind: "auth" });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(streamChat({ baseUrl: "https://x.test/v1" }, { model: "m", messages: [] })).rejects.toMatchObject({ kind: "network" });
  });

  it("reports a stop as aborted", async () => {
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      ctrl.abort();
      throw init.signal?.reason ?? new DOMException("aborted", "AbortError");
    });
    const e = await streamChat({ baseUrl: "https://x.test/v1" }, { model: "m", messages: [], signal: ctrl.signal }).catch((e) => e);
    expect(e).toBeInstanceOf(AiError);
    expect(e.kind).toBe("aborted");
  });

  it("needs an address", async () => {
    await expect(streamChat({ baseUrl: "" }, { model: "m", messages: [] })).rejects.toThrow("address");
  });
});
