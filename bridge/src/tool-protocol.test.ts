// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseReply, systemPrompt, ToolCallFilter, transcript, type WireTool } from "./tool-protocol";

const tools: WireTool[] = [
  { type: "function", function: { name: "search_notes", description: "Search", parameters: { type: "object", properties: { query: { type: "string" } } } } },
];

describe("tool protocol", () => {
  it("puts the tools in the system prompt", () => {
    const s = systemPrompt([{ role: "system", content: "Be brief." }], tools);
    expect(s).toMatch(/^Be brief\.\n\nYou can call these tools:\n- search_notes: Search/);
    expect(s).toContain("<tool_call>");
    expect(systemPrompt([{ role: "system", content: "Hi" }], [])).toBe("Hi");
  });

  it("writes calls and results into the transcript", () => {
    const t = transcript([
      { role: "system", content: "ignored" },
      { role: "user", content: "Find garden" },
      { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "search_notes", arguments: '{"query":"garden"}' } }] },
      { role: "tool", tool_call_id: "c1", content: '{"results":[]}' },
    ]);
    expect(t).toBe(
      '<user>\nFind garden\n</user>\n\n<assistant>\n<tool_call>{"name":"search_notes","arguments":{"query":"garden"}}</tool_call>\n</assistant>\n\n<tool_result name="search_notes">\n{"results":[]}\n</tool_result>\n\nContinue as the assistant.',
    );
  });

  it("reads tool calls out of a reply, ignoring unknown tools and bad JSON", () => {
    const r = parseReply('Let me look.\n<tool_call>{"name": "search_notes", "arguments": {"query": "x"}}</tool_call>', tools);
    expect(r.text).toBe("Let me look.");
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].function).toEqual({ name: "search_notes", arguments: '{"query":"x"}' });
    expect(parseReply('<tool_call>{"name": "rm", "arguments": {}}</tool_call>', tools).calls).toEqual([]);
    expect(parseReply("<tool_call>{oops</tool_call>", tools)).toEqual({ text: "<tool_call>{oops</tool_call>", calls: [] });
    expect(parseReply("Just an answer.", tools)).toEqual({ text: "Just an answer.", calls: [] });
  });

  it("streams text until a tool call starts", () => {
    const out: string[] = [];
    const f = new ToolCallFilter((t) => out.push(t));
    for (const c of ["Hello ", "wor", "ld <", "tool", "_call>{...", "more"]) f.push(c);
    f.end();
    expect(out.join("")).toBe("Hello world ");
    const plain: string[] = [];
    const g = new ToolCallFilter((t) => plain.push(t));
    for (const c of ["a < b", " and <t", "ag>"]) g.push(c);
    g.end();
    expect(plain.join("")).toBe("a < b and <tag>");
  });
});
