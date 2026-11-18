import { afterEach, describe, expect, it, vi } from "vitest";
import { chatStore } from "./chat-store";

const stream = (chunks: string[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });
const ep = { baseUrl: "http://localhost:11434/v1" };

afterEach(() => {
  vi.unstubAllGlobals();
  chatStore.reset("");
});

describe("chatStore", () => {
  it("asks with the open note and keeps the conversation", async () => {
    const fetchFn = vi.fn(async () => stream(["Two ", "ideas."]));
    vi.stubGlobal("fetch", fetchFn);
    await chatStore.send(ep, "m", "What's here?", { path: "Ideas.md", text: "- a\n- b" });
    expect(chatStore.get().turns).toEqual([
      { role: "user", content: "What's here?", note: "Ideas.md" },
      { role: "assistant", content: "Two ideas." },
    ]);
    await chatStore.send(ep, "m", "And?", null);
    const body = JSON.parse((fetchFn.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });

  it("records errors and retries the question", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 429 }));
    await chatStore.send(ep, "m", "Hi", null);
    expect(chatStore.get().turns.at(-1)?.error).toContain("Too many requests");
    vi.stubGlobal("fetch", async () => stream(["Hello"]));
    await chatStore.send(ep, "m", null, null);
    expect(chatStore.get().turns.map((t) => t.content)).toEqual(["Hi", "Hello"]);
  });
});
