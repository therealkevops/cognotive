import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Runs one turn through Claude Code (`claude -p`), on the user's own
 * subscription. Claude Code's own tools, MCP servers, skills and settings
 * are all switched off: it only writes text. The agent's tools are the app's,
 * called through the tool-call protocol.
 */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface Runner {
  status(): Promise<{ installed: boolean; signedIn: boolean; plan?: string }>;
  /** Model aliases Claude Code accepts. */
  models(): string[];
  run(o: { model: string; system: string; prompt: string; signal?: AbortSignal; onDelta?(text: string): void }): Promise<{ text: string; usage?: Usage }>;
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export const CLAUDE_MODELS = ["sonnet", "opus", "haiku"];

export const HARDENING_ARGS = [
  "--tools",
  "",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--safe-mode",
  "--strict-mcp-config",
  "--mcp-config",
  '{"mcpServers":{}}',
];

const START_TIMEOUT_MS = 20_000;
const TURN_TIMEOUT_MS = 300_000;

type Event = {
  type?: string;
  subtype?: string;
  tools?: unknown[];
  mcp_servers?: unknown[];
  event?: { type?: string; delta?: { type?: string; text?: string } };
  is_error?: boolean;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  api_error_status?: number;
};

const usageOf = (u: Event["usage"]): Usage | undefined =>
  u
    ? {
        prompt_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        completion_tokens: u.output_tokens ?? 0,
      }
    : undefined;

function failure(e: Event): BridgeError {
  const msg = e.result ?? "";
  if (e.api_error_status === 401 || /not logged in|log ?in|authenticat/i.test(msg)) {
    return new BridgeError("Claude Code is signed out. Run `claude /login`, then try again.", 503, "signed_out");
  }
  if (e.api_error_status === 429 || /usage limit|rate limit/i.test(msg)) {
    return new BridgeError("Your Claude plan's usage limit was reached. Try again later.", 429, "rate_limited");
  }
  if (e.api_error_status === 404 || /model/i.test(msg)) return new BridgeError("Claude Code couldn't use that model.", 404, "model");
  return new BridgeError("Claude Code couldn't finish the answer. Try again.", 500, "failed");
}

function stop(child: ChildProcess) {
  if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
}

/** `command` is how to start Claude Code, e.g. ["claude"] (tests use a fake). */
export function claudeRunner({ command = ["claude"], env = process.env }: { command?: string[]; env?: NodeJS.ProcessEnv } = {}): Runner {
  const [bin, ...pre] = command;
  const exec = (args: string[], opts: { cwd?: string; input?: string } = {}) =>
    new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const child = spawn(bin, [...pre, ...args], { cwd: opts.cwd, env, stdio: ["pipe", "pipe", "ignore"] });
      let stdout = "";
      const timer = setTimeout(() => stop(child), 15_000);
      child.stdout!.setEncoding("utf8").on("data", (d: string) => (stdout += d));
      child.once("error", () => resolve({ code: -1, stdout }));
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout });
      });
      child.stdin!.end(opts.input ?? "");
    });

  return {
    async status() {
      const r = await exec(["auth", "status"]);
      if (r.code === -1) return { installed: false, signedIn: false };
      try {
        const j = JSON.parse(r.stdout) as { loggedIn?: boolean; subscriptionType?: string };
        return { installed: true, signedIn: r.code === 0 && j.loggedIn === true, ...(j.subscriptionType ? { plan: j.subscriptionType } : {}) };
      } catch {
        return { installed: true, signedIn: r.code === 0 };
      }
    },

    models: () => CLAUDE_MODELS,

    async run({ model, system, prompt, signal, onDelta }) {
      if (signal?.aborted) throw new BridgeError("Stopped.", 499, "aborted");
      // A fresh, empty folder per turn: nothing for Claude Code to read.
      const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "noted-ai-bridge-"));
      try {
        const args = [
          "-p",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-partial-messages",
          "--model",
          model,
          "--system-prompt",
          system,
          ...HARDENING_ARGS,
        ];
        return await new Promise((resolve, reject) => {
          const child = spawn(bin, [...pre, ...args], { cwd, env, stdio: ["pipe", "pipe", "ignore"] });
          let done = false;
          let sawInit = false;
          let result: Event | null = null;
          let buffer = "";
          const finish = (err: BridgeError | null, value?: { text: string; usage?: Usage }) => {
            if (done) return;
            done = true;
            clearTimeout(startTimer);
            clearTimeout(turnTimer);
            signal?.removeEventListener("abort", onAbort);
            stop(child);
            if (err) reject(err);
            else resolve(value!);
          };
          const onAbort = () => finish(new BridgeError("Stopped.", 499, "aborted"));
          signal?.addEventListener("abort", onAbort, { once: true });
          const startTimer = setTimeout(() => finish(new BridgeError("Claude Code didn't start in time.", 504, "failed")), START_TIMEOUT_MS);
          const turnTimer = setTimeout(() => finish(new BridgeError("Claude Code took more than 5 minutes.", 504, "failed")), TURN_TIMEOUT_MS);

          const onEvent = (e: Event) => {
            clearTimeout(startTimer);
            if (e.type === "system" && e.subtype === "init") {
              sawInit = true;
              // Never run with tools: the bridge must only produce text.
              if (e.tools?.length || e.mcp_servers?.length) finish(new BridgeError("Claude Code started with tools turned on.", 500, "failed"));
            } else if (e.type === "stream_event" && e.event?.type === "content_block_delta" && e.event.delta?.type === "text_delta") {
              onDelta?.(e.event.delta.text ?? "");
            } else if (e.type === "result") result = e;
          };
          child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
            buffer += chunk;
            let nl = buffer.indexOf("\n");
            while (nl !== -1) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (line) {
                try {
                  onEvent(JSON.parse(line) as Event);
                } catch {
                  /* not JSON: ignore */
                }
              }
              nl = buffer.indexOf("\n");
            }
          });
          child.once("error", (e: NodeJS.ErrnoException) =>
            finish(
              e.code === "ENOENT"
                ? new BridgeError("Claude Code isn't installed. Install it with: npm install -g @anthropic-ai/claude-code", 503, "missing")
                : new BridgeError("Couldn't start Claude Code.", 500, "failed"),
            ),
          );
          child.once("close", (code) => {
            const r = result as Event | null;
            if (!sawInit || !r) return finish(new BridgeError("Claude Code stopped before answering.", 500, "failed"));
            if (r.is_error !== false || code !== 0) return finish(failure(r));
            finish(null, { text: r.result ?? "", usage: usageOf(r.usage) });
          });
          child.stdin!.on("error", () => {});
          child.stdin!.end(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } }) + "\n");
        });
      } finally {
        await fs.rm(cwd, { recursive: true, force: true });
      }
    },
  };
}
