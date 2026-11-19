// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { claudeRunner, HARDENING_ARGS } from "./claude";
import { createBridge, originAllowed } from "./server";
import { readOrCreateToken, tokenMatches } from "./token";

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../test/fake-claude.mjs");
const TOKEN = "a".repeat(48);
const APP = "https://notes.example.com";
let bridge: ReturnType<typeof createBridge> | null = null;

async function start(env: Record<string, string> = {}) {
  bridge = createBridge({
    port: 0,
    token: TOKEN,
    origins: [APP],
    runner: claudeRunner({ command: [process.execPath, FAKE], env: { ...process.env, ...env } }),
  });
  await bridge.start();
  return bridge;
}
const call = (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  fetch(bridge!.url + p, { ...init, headers: { Origin: APP, Authorization: `Bearer ${TOKEN}`, ...init.headers } });
const chat = (body: unknown, headers: Record<string, string> = {}) =>
  call("/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

async function events(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((f) => f.startsWith("data: ") && f !== "data: [DONE]")
    .map((f) => JSON.parse(f.slice(6)));
}

afterEach(async () => {
  await bridge?.close();
  bridge = null;
});

describe("guards", () => {
  it("allow only the app, localhost, and the pairing code", async () => {
    await start();
    expect((await fetch(bridge!.url + "/bridge/ping", { headers: { Origin: APP } })).status).toBe(200);
    const evil = await fetch(bridge!.url + "/bridge/ping", { headers: { Origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    expect((await call("/v1/models", { headers: { Authorization: "Bearer wrong" } })).status).toBe(401);
    const pre = await fetch(bridge!.url + "/v1/models", { method: "OPTIONS", headers: { Origin: APP } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe(APP);
    expect(pre.headers.get("access-control-allow-private-network")).toBe("true");
    expect(originAllowed("http://localhost:3000", [])).toBe(true);
    expect(originAllowed("http://localhost.evil.com", [])).toBe(false);
  });

  it("refuse other Host names (DNS rebinding)", async () => {
    await start();
    const http = await import("node:http");
    const status = await new Promise<number>((resolve) => {
      http.get({ host: "127.0.0.1", port: bridge!.port, path: "/bridge/ping", headers: { Host: "attacker.example:80" } }, (r) => resolve(r.statusCode!));
    });
    expect(status).toBe(403);
  });
});

describe("models and status", () => {
  it("lists Claude Code's models when signed in", async () => {
    await start();
    const j = await (await call("/v1/models")).json();
    expect(j.data.map((m: { id: string }) => m.id)).toEqual(["claude/sonnet", "claude/opus", "claude/haiku"]);
    expect((await (await call("/bridge/status")).json()).claude).toEqual({ installed: true, signedIn: true, plan: "max" });
  });

  it("says when Claude Code is signed out or missing", async () => {
    await start({ FAKE_CLAUDE_SIGNED_OUT: "1" });
    const r = await call("/v1/models");
    expect(r.status).toBe(503);
    expect((await r.json()).error.message).toContain("claude /login");
    await bridge!.close();
    bridge = createBridge({ port: 0, token: TOKEN, origins: [APP], runner: claudeRunner({ command: ["/nonexistent/claude"] }) });
    await bridge.start();
    expect((await (await call("/v1/models")).json()).error.message).toContain("isn't installed");
  });
});

describe("chat", () => {
  it("streams an answer, with Claude Code's own tools switched off", async () => {
    const argsFile = path.join(os.tmpdir(), `bridge-args-${Date.now()}.json`);
    await start({ FAKE_CLAUDE_REPLY: JSON.stringify(["Hello from your plan."]), FAKE_CLAUDE_ARGS_FILE: argsFile });
    const res = await chat({ model: "claude/sonnet", stream: true, messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }] });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const ev = await events(res);
    expect(ev.map((e) => e.choices[0].delta.content ?? "").join("")).toBe("Hello from your plan.");
    expect(ev.at(-1)).toMatchObject({ choices: [{ finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "sonnet"]);
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("Be brief.");
    for (const a of HARDENING_ARGS) expect(args).toContain(a);
  });

  it("turns tool-call blocks into tool calls, and sends tool results back as text", async () => {
    const promptFile = path.join(os.tmpdir(), `bridge-prompt-${Date.now()}.txt`);
    await start({
      FAKE_CLAUDE_REPLY: JSON.stringify(['Searching.\n<tool_call>{"name": "search_notes", "arguments": {"query": "garden"}}</tool_call>', "Found [[Garden]]."]),
      FAKE_CLAUDE_PROMPT_FILE: promptFile,
    });
    const tools = [{ type: "function", function: { name: "search_notes", description: "Search", parameters: { type: "object" } } }];
    const first = await events(await chat({ model: "claude/sonnet", stream: true, tools, messages: [{ role: "user", content: "Garden?" }] }));
    expect(first.map((e) => e.choices[0].delta.content ?? "").join("")).toBe("Searching.\n");
    const callChunk = first.find((e) => e.choices[0].delta.tool_calls)!;
    const call0 = callChunk.choices[0].delta.tool_calls[0];
    expect(call0.function).toEqual({ name: "search_notes", arguments: '{"query":"garden"}' });
    expect(first.at(-1).choices[0].finish_reason).toBe("tool_calls");

    const second = await chat({
      model: "claude/sonnet",
      tools,
      messages: [
        { role: "user", content: "Garden?" },
        { role: "assistant", content: "", tool_calls: [{ id: call0.id, type: "function", function: call0.function }] },
        { role: "tool", tool_call_id: call0.id, content: '{"results":[{"path":"Garden.md"}]}' },
      ],
    });
    const j = await second.json();
    expect(j.choices[0]).toMatchObject({ message: { content: "Found [[Garden]]." }, finish_reason: "stop" });
    expect(fs.readFileSync(promptFile, "utf8")).toContain('<tool_result name="search_notes">\n{"results":[{"path":"Garden.md"}]}');
  });

  it("reports failures and unknown models", async () => {
    await start({ FAKE_CLAUDE_FAIL: "Claude AI usage limit reached", FAKE_CLAUDE_STATUS: "429" });
    const r = await chat({ model: "claude/sonnet", messages: [{ role: "user", content: "Hi" }] });
    expect(r.status).toBe(429);
    expect((await r.json()).error.message).toContain("usage limit");
    expect((await chat({ model: "gpt-4", messages: [{ role: "user", content: "Hi" }] })).status).toBe(404);
  });

  it("refuses to run if Claude Code starts with tools", async () => {
    await start({ FAKE_CLAUDE_TOOLS: "1" });
    const r = await chat({ model: "claude/sonnet", messages: [{ role: "user", content: "Hi" }] });
    expect(r.status).toBe(500);
    expect((await r.json()).error.message).toContain("tools turned on");
  });

  it("stops Claude Code when the page stops waiting", async () => {
    await start({ FAKE_CLAUDE_DELAY: "50", FAKE_CLAUDE_REPLY: JSON.stringify(["x".repeat(600)]) });
    const res = await chat({ model: "claude/sonnet", stream: true, messages: [{ role: "user", content: "Long" }] });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 100));
    // The bridge is still healthy afterwards.
    expect((await fetch(bridge!.url + "/bridge/ping", { headers: { Origin: APP } })).status).toBe(200);
  });
});

describe("pairing code", () => {
  it("is created once, kept private, and compared safely", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "noted-ai-home-"));
    const a = await readOrCreateToken({ env: { NOTED_AI_HOME: home } });
    const b = await readOrCreateToken({ env: { NOTED_AI_HOME: home } });
    expect(a.created).toBe(true);
    expect(b).toEqual({ token: a.token, created: false });
    expect(fs.statSync(path.join(home, "bridge-token")).mode & 0o777).toBe(0o600);
    expect((await readOrCreateToken({ env: { NOTED_AI_HOME: home }, renew: true })).token).not.toBe(a.token);
    expect(tokenMatches(a.token, `Bearer ${a.token}`)).toBe(true);
    expect(tokenMatches(a.token, a.token)).toBe(false);
  });
});
