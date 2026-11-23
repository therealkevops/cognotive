import http from "node:http";
import { BridgeError, type Runner } from "./claude";
import { tokenMatches } from "./token";
import { parseReply, systemPrompt, ToolCallFilter, transcript, type WireMessage, type WireTool } from "./tool-protocol";

/**
 * The bridge: an OpenAI-compatible endpoint on this computer only
 * (127.0.0.1), so the Cognotive.ai page can use a Claude plan through Claude
 * Code. Three separate checks guard it: the Host header (against DNS
 * rebinding), the page's Origin (only the app's address and localhost), and
 * the pairing code (a bearer token only this user can read).
 */
export interface BridgeOptions {
  port?: number;
  token: string;
  /** Sites allowed to use the bridge, e.g. ["https://notes.example.com"]. http://localhost is always allowed. */
  origins: string[];
  runner: Runner;
  version?: string;
}

const HOST = "127.0.0.1";
const MAX_BODY = 8 * 1024 * 1024;
export const MODEL_PREFIX = "claude/";

export function originAllowed(origin: string, allowed: string[]): boolean {
  if (allowed.includes(origin)) return true;
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.pathname === "/" && !u.username;
  } catch {
    return false;
  }
}

const label = (alias: string) => `Claude ${alias[0].toUpperCase()}${alias.slice(1)} (your plan)`;

export function createBridge(o: BridgeOptions) {
  let port = o.port ?? 41414;
  const active = new Set<AbortController>();

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    if (res.writableEnded) return;
    const json = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(json) });
    res.end(json);
  };
  const fail = (res: http.ServerResponse, e: unknown) => {
    const err = e instanceof BridgeError ? e : new BridgeError((e as Error)?.message || "The bridge failed.", 500, "failed");
    send(res, err.status, { error: { message: err.message, code: err.code } });
  };
  const cors = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin = req.headers.origin;
    if (!origin || !originAllowed(origin, o.origins)) return;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, http-referer, x-title");
    // Chrome asks before a public page reaches this computer; this is the bridge saying yes.
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Max-Age", "7200");
  };

  const readBody = (req: http.IncomingMessage) =>
    new Promise<unknown>((resolve, reject) => {
      let size = 0;
      const parts: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new BridgeError("The request is too large.", 413, "too_large"));
          req.destroy();
        } else parts.push(c);
      });
      req.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(parts).toString("utf8")));
        } catch {
          reject(new BridgeError("The request isn't valid JSON.", 400, "bad_request"));
        }
      });
      req.on("error", reject);
    });

  async function chat(req: http.IncomingMessage, res: http.ServerResponse, body: Record<string, unknown>) {
    const model = String(body.model ?? "");
    const alias = model.startsWith(MODEL_PREFIX) ? model.slice(MODEL_PREFIX.length) : "";
    if (!o.runner.models().includes(alias)) throw new BridgeError(`Unknown model "${model}".`, 404, "model");
    const messages = Array.isArray(body.messages) ? (body.messages as WireMessage[]) : [];
    if (!messages.some((m) => m.role === "user")) throw new BridgeError("There's no question to answer.", 400, "bad_request");
    const tools = Array.isArray(body.tools) ? (body.tools as WireTool[]).filter((t) => t?.function?.name) : [];
    const stream = body.stream === true;

    const ctrl = new AbortController();
    active.add(ctrl);
    const onClose = () => !res.writableEnded && ctrl.abort();
    res.once("close", onClose);
    const id = `chatcmpl-${Date.now().toString(36)}`;
    const created = Math.floor(Date.now() / 1000);
    const chunk = (delta: unknown, finish: string | null = null, extra: object = {}) =>
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    };
    const filter = new ToolCallFilter((text) => {
      if (!stream || !text) return;
      start();
      chunk({ content: text });
    });
    try {
      const r = await o.runner.run({
        model: alias,
        system: systemPrompt(messages, tools),
        prompt: transcript(messages),
        signal: ctrl.signal,
        onDelta: (t) => (tools.length ? filter.push(t) : stream && t && (start(), chunk({ content: t }))),
      });
      filter.end();
      const { text, calls } = tools.length ? parseReply(r.text, tools) : { text: r.text, calls: [] };
      const finish = calls.length ? "tool_calls" : "stop";
      if (stream) {
        start();
        if (calls.length) chunk({ tool_calls: calls.map((c, index) => ({ index, ...c })) });
        chunk({}, finish, r.usage ? { usage: r.usage } : {});
        res.end("data: [DONE]\n\n");
      } else {
        send(res, 200, {
          id,
          object: "chat.completion",
          created,
          model,
          choices: [{ index: 0, message: { role: "assistant", content: text, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: finish }],
          ...(r.usage ? { usage: r.usage } : {}),
        });
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (!started) throw e;
      res.write(`data: ${JSON.stringify({ error: { message: (e as Error).message } })}\n\n`);
      res.end("data: [DONE]\n\n");
    } finally {
      active.delete(ctrl);
      res.removeListener("close", onClose);
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const host = String(req.headers.host ?? "");
      if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) throw new BridgeError("Forbidden host.", 403, "forbidden");
      const origin = req.headers.origin;
      if (origin !== undefined && !originAllowed(origin, o.origins)) {
        throw new BridgeError(`This site isn't allowed. Restart the bridge with --origin ${origin}`, 403, "forbidden_origin");
      }
      const url = new URL(req.url ?? "/", `http://${host}`);
      cors(req, res);
      if (req.method === "OPTIONS") {
        if (!origin) throw new BridgeError("Forbidden.", 403, "forbidden");
        res.writeHead(204);
        return res.end();
      }
      // Lets the app's settings see that a bridge is running before it's paired.
      if (req.method === "GET" && url.pathname === "/bridge/ping") return send(res, 200, { ok: true, name: "cognotive-bridge", version: o.version ?? "0" });
      if (!tokenMatches(o.token, req.headers.authorization)) throw new BridgeError("Wrong pairing code.", 401, "unauthorized");

      if (req.method === "GET" && url.pathname === "/bridge/status") {
        const s = await o.runner.status();
        return send(res, 200, { claude: s });
      }
      if (req.method === "GET" && url.pathname === "/v1/models") {
        const s = await o.runner.status();
        if (!s.installed) throw new BridgeError("Claude Code isn't installed. Install it with: npm install -g @anthropic-ai/claude-code", 503, "missing");
        if (!s.signedIn) throw new BridgeError("Claude Code is signed out. Run `claude /login`, then check again.", 503, "signed_out");
        return send(res, 200, {
          object: "list",
          data: o.runner.models().map((m) => ({ id: MODEL_PREFIX + m, object: "model", owned_by: "claude-code", name: label(m), supported_parameters: ["tools"] })),
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        if (!/^application\/json/i.test(String(req.headers["content-type"] ?? ""))) throw new BridgeError("Send JSON.", 415, "bad_request");
        const body = await readBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new BridgeError("Send a JSON object.", 400, "bad_request");
        return await chat(req, res, body as Record<string, unknown>);
      }
      throw new BridgeError("Not found.", 404, "not_found");
    } catch (e) {
      fail(res, e);
    }
  });

  return {
    start: () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", (e: NodeJS.ErrnoException) =>
          reject(e.code === "EADDRINUSE" ? new Error(`Port ${port} is in use. Is the bridge already running? Use --port to pick another.`) : e),
        );
        server.listen(port, HOST, () => {
          const a = server.address();
          if (a && typeof a === "object") port = a.port;
          resolve();
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of active) c.abort();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
    get port() {
      return port;
    },
    get url() {
      return `http://${HOST}:${port}`;
    },
  };
}
