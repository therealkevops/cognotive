import path from "node:path";
import { claudeRunner } from "./claude";
import { NoteFolder } from "./folder";
import { mcpServer } from "./mcp";
import { createBridge } from "./server";
import { readOrCreateToken } from "./token";

export const VERSION = "0.1.0";

const HELP = `noted-ai ${VERSION}: the noted-ai companion

Usage:
  noted-ai bridge [--origin URL]... [--port 41414] [--new-code]
      Lets the noted-ai app use your Claude plan through Claude Code (installed
      and signed in on this computer). Listens on 127.0.0.1 only. --origin is
      the address you open noted-ai at (http://localhost works without it).

  noted-ai mcp <notes folder> [--read-only] [--markdown-links]
      An MCP server with the app's agent tools for a folder of notes (a clone
      of your repository), for Claude Code or another MCP client:
        claude mcp add noted-ai -- node /path/to/noted-ai.mjs mcp ~/notes
`;

export function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const flags: Record<string, string[]> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      const takesValue = k === "origin" || k === "port";
      const v = inline ?? (takesValue ? rest[++i] : "true");
      (flags[k] ??= []).push(v ?? "");
    } else positional.push(a);
  }
  return { command, flags, positional };
}

/** "https://notes.example.com/some/page" → "https://notes.example.com". */
export function cleanOrigin(value: string): string {
  const u = new URL(value);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`Not a web address: ${value}`);
  return u.origin;
}

async function bridge(flags: Record<string, string[]>) {
  const origins = (flags.origin ?? []).map(cleanOrigin);
  const { token } = await readOrCreateToken({ renew: !!flags["new-code"] });
  const runner = claudeRunner({ command: process.env.NOTED_AI_CLAUDE ? [process.env.NOTED_AI_CLAUDE] : ["claude"] });
  const b = createBridge({ port: Number(flags.port?.[0] ?? 41414), token, origins, runner, version: VERSION });
  await b.start();
  const status = await runner.status();
  const log = (s = "") => process.stdout.write(s + "\n");
  log(`noted-ai bridge is running at ${b.url} (this computer only).`);
  log();
  if (!status.installed) log("⚠ Claude Code isn't installed: npm install -g @anthropic-ai/claude-code\n");
  else if (!status.signedIn) log("⚠ Claude Code is signed out: run `claude /login`\n");
  else log(`Claude Code is signed in${status.plan ? ` (${status.plan} plan)` : ""}.\n`);
  log(`Pairing code: ${token}`);
  for (const o of origins) log(`Or open ${o}/#bridge=${token} to pair in one step.`);
  if (!origins.length) log("Only http://localhost can use it. Add --origin https://your-noted-ai.example to allow your deployed app.");
  log("\nIn noted-ai: Settings → AI → Claude plan. Press Ctrl+C to stop.");
  const stop = () => void b.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

async function mcp(positional: string[], flags: Record<string, string[]>) {
  const dir = positional[0];
  if (!dir) throw new Error("Say which folder of notes, e.g. noted-ai mcp ~/notes");
  const folder = new NoteFolder(path.resolve(dir));
  folder.scan();
  process.stderr.write(`noted-ai MCP server for ${folder.root} (${folder.files().length} files)${flags["read-only"] ? ", read-only" : ""}\n`);
  await mcpServer(folder, { readOnly: !!flags["read-only"], version: VERSION, linkFormat: flags["markdown-links"] ? "markdown" : "wikilink" }).listen();
}

export async function main(argv = process.argv.slice(2)) {
  const { command, flags, positional } = parseArgs(argv);
  try {
    if (command === "bridge") await bridge(flags);
    else if (command === "mcp") await mcp(positional, flags);
    else process.stdout.write(HELP);
  } catch (e) {
    process.stderr.write(`noted-ai: ${(e as Error).message}\n`);
    process.exit(1);
  }
}
