import { addressSpaceHint, normalizeBaseUrl } from "./providers";
import { parseModels, type ModelInfo } from "./catalog";

/**
 * Why a local model server can't be used, worked out from what the browser can
 * see. A browser hides the real reason for most failures, so the checks go in
 * order from the cheapest explanation.
 */
export type LocalStatus =
  | { state: "ready"; models: ModelInfo[] }
  | { state: "no-models" }
  | { state: "permission" }
  | { state: "unreachable" }
  | { state: "origin-blocked" }
  | { state: "insecure" }
  | { state: "bad-url" };

export async function diagnoseLocal(baseUrl: string, opts: { timeoutMs?: number } = {}): Promise<LocalStatus> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return { state: "bad-url" };
  const url = `${base}/models`;

  // An https page may not call a plain-http address other than this machine.
  if (typeof location !== "undefined" && location.protocol === "https:" && url.startsWith("http:")) {
    const hint = addressSpaceHint(url);
    if (!hint.targetAddressSpace) return { state: "insecure" };
  }

  const permission = await localNetworkPermission();
  if (permission === "denied") return { state: "permission" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, ...addressSpaceHint(url) } as RequestInit);
    if (!res.ok) return { state: "unreachable" };
    const models = parseModels(await res.json());
    return models.length ? { state: "ready", models } : { state: "no-models" };
  } catch {
    if ((await localNetworkPermission()) === "denied") return { state: "permission" };
    // The server answers without CORS headers when it doesn't allow this site.
    // A no-cors request still gets through then, which tells the two apart.
    if (await answersOpaquely(url)) return { state: "origin-blocked" };
    return { state: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

async function answersOpaquely(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    await fetch(url, { mode: "no-cors", signal: ctrl.signal, ...addressSpaceHint(url) } as RequestInit);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function localNetworkPermission(): Promise<PermissionState | "unknown"> {
  try {
    const p = await navigator.permissions.query({ name: "local-network-access" as PermissionName });
    return p.state;
  } catch {
    return "unknown";
  }
}

/** What to tell the person for each state. */
export function localAdvice(status: LocalStatus, origin: string): { title: string; steps: string[] } {
  switch (status.state) {
    case "ready":
      return { title: `Connected. ${status.models.length} ${status.models.length === 1 ? "model" : "models"} available.`, steps: [] };
    case "no-models":
      return {
        title: "Connected, but no models are installed.",
        steps: ["Download one, for example: ollama pull llama3.2", "Then check again."],
      };
    case "permission":
      return {
        title: "The browser is blocking access to your computer.",
        steps: ["Click the icon at the left of the address bar.", "Allow access to devices on your local network, then check again."],
      };
    case "origin-blocked":
      return {
        title: "The server is running but doesn't accept requests from this site.",
        steps: [
          `Allow this site, then restart Ollama: OLLAMA_ORIGINS="${origin}" ollama serve`,
          "On macOS app installs: launchctl setenv OLLAMA_ORIGINS \"" + origin + "\" and restart the Ollama app.",
          "LM Studio: turn on “Enable CORS” in the Developer tab.",
        ],
      };
    case "insecure":
      return {
        title: "This page is secure (https), so it can only reach a plain-http server on this computer.",
        steps: ["Use localhost or 127.0.0.1, or put the server behind https."],
      };
    case "bad-url":
      return { title: "That isn't a valid address.", steps: ["It should look like http://localhost:11434/v1"] };
    default:
      return {
        title: "Nothing answered at that address.",
        steps: ["Start the server: ollama serve (or start LM Studio's server).", "Check the port in the address, then check again."],
      };
  }
}

/** Whether the bridge is running, paired, and has Claude Code ready. */
export type BridgeStatus =
  | { state: "ready"; models: ModelInfo[] }
  | { state: "not-running" }
  | { state: "permission" }
  | { state: "unpaired" }
  | { state: "wrong-code" }
  /** Running and paired, but Claude Code isn't installed or signed in (the bridge says which). */
  | { state: "agent"; message: string };

export async function diagnoseBridge(baseUrl: string, code: string): Promise<BridgeStatus> {
  const base = normalizeBaseUrl(baseUrl);
  const root = base.replace(/\/v1$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const ping = await fetch(`${root}/bridge/ping`, { signal: ctrl.signal, ...addressSpaceHint(root) } as RequestInit);
    if (!ping.ok) return { state: "not-running" };
  } catch {
    return (await localNetworkPermission()) === "denied" ? { state: "permission" } : { state: "not-running" };
  } finally {
    clearTimeout(timer);
  }
  if (!code) return { state: "unpaired" };
  const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${code}` }, ...addressSpaceHint(base) } as RequestInit).catch(() => null);
  if (!res) return { state: "not-running" };
  if (res.status === 401) return { state: "wrong-code" };
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { state: "agent", message: j.error?.message ?? `The bridge answered HTTP ${res.status}.` };
  }
  return { state: "ready", models: parseModels(await res.json()) };
}

/** What to tell the person for each bridge state. `command` starts the bridge for this site. */
export function bridgeAdvice(status: BridgeStatus, command: string): { title: string; steps: string[] } {
  switch (status.state) {
    case "ready":
      return { title: "Connected to Claude Code.", steps: [] };
    case "not-running":
      return {
        title: "The bridge isn't running.",
        steps: [
          "Install Claude Code and sign in: npm install -g @anthropic-ai/claude-code, then claude /login",
          `In a clone of Cognotive.ai, start the bridge: ${command}`,
          "Open the pairing link it prints, or paste its pairing code below.",
        ],
      };
    case "permission":
      return {
        title: "The browser is blocking access to your computer.",
        steps: ["Click the icon at the left of the address bar.", "Allow access to devices on your local network, then check again."],
      };
    case "unpaired":
      return { title: "The bridge is running. Paste the pairing code it printed.", steps: [] };
    case "wrong-code":
      return { title: "The bridge didn't accept that pairing code.", steps: ["Copy the code the bridge printed (or open its pairing link), then check again."] };
    case "agent":
      return { title: status.message, steps: [] };
  }
}
