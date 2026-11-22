import readline from "node:readline";
import { setFrontmatterProperty } from "../../src/lib/markdown/frontmatter";
import { yamlValue } from "../../src/lib/markdown/yaml-value";
import { READ_TOOLS, runTool, WRITE_TOOLS, type ProposalSink, type ToolEnv } from "../../src/lib/ai/tools";
import { isNote } from "../../src/lib/vault/paths";
import { NoteFolder } from "./folder";

/**
 * An MCP server (over stdio) that gives Claude Code, or any MCP client, the
 * same tools as the app's agent, working on a folder of notes on disk: search,
 * read, links, hubs, tags, properties and health; and, unless read-only,
 * creating notes, adding to them, editing, setting properties and linking.
 * The client asks before each change (Claude Code's permission prompts), and
 * git shows every change before it's committed and synced.
 */
export const INSTRUCTIONS = [
  "These tools work on a folder of markdown notes (a noted-ai repository, Obsidian-compatible).",
  "Search and read before answering; cite notes as [[wikilinks]]. Read a note before changing it.",
  "Notes link with [[Note name]]; properties are YAML frontmatter; hubs are notes with hub: true.",
].join(" ");

type Json = Record<string, unknown>;

export function mcpServer(folder: NoteFolder, opts: { readOnly?: boolean; version?: string; linkFormat?: "wikilink" | "markdown" } = {}) {
  const tools = opts.readOnly ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS];
  const readNames = new Set(READ_TOOLS.map((t) => t.function.name));

  // Changes are written straight away: the client has already asked the user.
  const sink: ProposalSink = {
    linkFormat: opts.linkFormat ?? "wikilink",
    textOf: (p) => folder.read(p),
    exists: (p) => folder.exists(p),
    add(p) {
      if (p.kind === "property") {
        if (!isNote(p.path)) throw new Error("Set properties of drawings, canvases and attachments in the app.");
        const text = folder.read(p.path) ?? "";
        const { key, value } = p.property!;
        folder.write(p.path, setFrontmatterProperty(text, key, value === undefined ? undefined : yamlValue(value)));
      } else {
        if (p.kind === "create" && folder.exists(p.path)) throw new Error(`"${p.path}" already exists.`);
        folder.write(p.path, p.after);
      }
      return { ...p, id: "done", status: "applied" };
    },
  };
  const env = (): ToolEnv => {
    folder.scan();
    return { links: folder.links, search: folder.search, files: folder.files, mtime: folder.mtime, ...(opts.readOnly ? {} : { proposals: sink }) };
  };

  /** Answers one JSON-RPC message; null for notifications. */
  async function handle(msg: Json): Promise<Json | null> {
    const id = msg.id as string | number | undefined;
    const method = String(msg.method ?? "");
    const params = (msg.params ?? {}) as Json;
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
    if (id === undefined) return null; // notifications/initialized and the like
    switch (method) {
      case "initialize":
        return ok({
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "noted-ai", version: opts.version ?? "0" },
          instructions: INSTRUCTIONS,
        });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            inputSchema: t.function.parameters,
            annotations: readNames.has(t.function.name) ? { readOnlyHint: true } : { readOnlyHint: false, destructiveHint: false },
          })),
        });
      case "tools/call": {
        const name = String(params.name ?? "");
        if (!tools.some((t) => t.function.name === name)) return err(-32602, `Unknown tool: ${name}`);
        try {
          const r = await runTool(env(), name, JSON.stringify(params.arguments ?? {}));
          const text = r.proposal ? `Done: ${r.proposal.summary} (${r.proposal.path}).` : r.content;
          // A tool that threw (e.g. a path outside the folder) is an error; other answers explain themselves.
          return ok({ content: [{ type: "text", text }], ...(r.content.startsWith(`${name} failed:`) ? { isError: true } : {}) });
        } catch (e) {
          return ok({ content: [{ type: "text", text: (e as Error).message }], isError: true });
        }
      }
      default:
        return err(-32601, `Method not found: ${method}`);
    }
  }

  return {
    handle,
    /** Serves over stdin and stdout, one JSON message per line. */
    listen(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout) {
      const rl = readline.createInterface({ input });
      // One message at a time, so replies keep the order of the requests.
      let queue = Promise.resolve();
      rl.on("line", (line) => {
        if (!line.trim()) return;
        queue = queue.then(async () => {
          let msg: Json;
          try {
            msg = JSON.parse(line);
          } catch {
            output.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
            return;
          }
          const reply = await handle(msg);
          if (reply) output.write(JSON.stringify(reply) + "\n");
        });
      });
      return new Promise<void>((resolve) => rl.once("close", () => void queue.then(resolve)));
    },
  };
}
