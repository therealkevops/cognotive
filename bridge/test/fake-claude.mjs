#!/usr/bin/env node
// A stand-in for the `claude` command in tests: it never calls a model.
// It answers `auth status`, and for `-p` echoes a scripted reply read from
// FAKE_CLAUDE_REPLY (or a default that quotes the prompt), streamed in pieces.
import fs from "node:fs";

const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status") {
  const signedIn = process.env.FAKE_CLAUDE_SIGNED_OUT !== "1";
  process.stdout.write(JSON.stringify({ loggedIn: signedIn, subscriptionType: "max" }) + "\n");
  process.exit(signedIn ? 0 : 1);
}
if (process.env.FAKE_CLAUDE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify(args));

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  const msg = JSON.parse(input.trim().split("\n")[0]);
  const prompt = msg.message.content[0].text;
  if (process.env.FAKE_CLAUDE_PROMPT_FILE) fs.writeFileSync(process.env.FAKE_CLAUDE_PROMPT_FILE, prompt);
  const out = (e) => process.stdout.write(JSON.stringify(e) + "\n");
  const tools = process.env.FAKE_CLAUDE_TOOLS === "1" ? ["Bash"] : [];
  out({ type: "system", subtype: "init", tools, mcp_servers: [] });
  if (process.env.FAKE_CLAUDE_FAIL) {
    out({ type: "result", is_error: true, result: process.env.FAKE_CLAUDE_FAIL, api_error_status: Number(process.env.FAKE_CLAUDE_STATUS || 0) || undefined });
    process.exit(1);
  }
  const replies = process.env.FAKE_CLAUDE_REPLY ? JSON.parse(process.env.FAKE_CLAUDE_REPLY) : null;
  // Several replies: pick by how many tool results the prompt already has.
  const turn = (prompt.match(/<tool_result /g) || []).length;
  const reply = replies ? replies[Math.min(turn, replies.length - 1)] : `You said: ${prompt.split("\n")[1] ?? ""}`;
  const delay = Number(process.env.FAKE_CLAUDE_DELAY || 0);
  for (let i = 0; i < reply.length; i += 6) {
    out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: reply.slice(i, i + 6) } } });
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }
  out({ type: "result", is_error: false, result: reply, usage: { input_tokens: 100, output_tokens: 20 } });
});
