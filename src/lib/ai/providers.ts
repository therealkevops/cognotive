import { readPref, writePref } from "../prefs";

/**
 * Where AI requests go. Every provider speaks the OpenAI-compatible Chat
 * Completions API, called straight from the browser (no server in between).
 * The design follows Rabbithole's provider registry.
 */
export type ProviderId = "openrouter" | "local" | "custom";

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  description: string;
  baseUrl: string;
  requiresKey: boolean;
  allowsKey: boolean;
  /** Notes stay on this machine (or network). */
  local: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    description: "Hundreds of models (Claude, GPT, Gemini, open models) with one key. Pay per use.",
    baseUrl: "https://openrouter.ai/api/v1",
    requiresKey: true,
    allowsKey: true,
    local: false,
  },
  local: {
    id: "local",
    label: "Local",
    description: "A model running on your computer with Ollama or LM Studio. Notes never leave your machine.",
    baseUrl: "http://localhost:11434/v1",
    requiresKey: false,
    allowsKey: false,
    local: true,
  },
  custom: {
    id: "custom",
    label: "Custom",
    description: "Any OpenAI-compatible endpoint, with an optional key.",
    baseUrl: "",
    requiresKey: false,
    allowsKey: true,
    local: false,
  },
};

/** Well-known local servers, offered as one-click base URLs. */
export const LOCAL_SERVERS = [
  { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
];

/** Models tried in order when none is chosen yet (the first the catalog has wins). */
export const PREFERRED_MODELS = [
  "anthropic/claude-sonnet-5.5",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-5",
  "google/gemini-2.5-flash",
];

export interface AiSettings {
  provider: ProviderId;
  /** Each provider keeps its own address and model, so switching back restores them. */
  providers: Record<ProviderId, { baseUrl: string; model: string }>;
  /** Keep keys in memory for this session only, not in the browser's storage. */
  sessionOnlyKeys: boolean;
}

export function defaultAiSettings(): AiSettings {
  return {
    provider: "openrouter",
    providers: {
      openrouter: { baseUrl: PROVIDERS.openrouter.baseUrl, model: "" },
      local: { baseUrl: PROVIDERS.local.baseUrl, model: "" },
      custom: { baseUrl: "", model: "" },
    },
    sessionOnlyKeys: false,
  };
}

/** Reads settings, keeping only what makes sense (stored data can be old or edited). */
export function normalizeAiSettings(raw: unknown): AiSettings {
  const out = defaultAiSettings();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Partial<AiSettings>;
  if (r.provider && r.provider in PROVIDERS) out.provider = r.provider;
  if (typeof r.sessionOnlyKeys === "boolean") out.sessionOnlyKeys = r.sessionOnlyKeys;
  for (const id of Object.keys(PROVIDERS) as ProviderId[]) {
    const slot = r.providers?.[id];
    if (!slot || typeof slot !== "object") continue;
    if (typeof slot.baseUrl === "string" && (id !== "openrouter" || slot.baseUrl)) out.providers[id].baseUrl = slot.baseUrl;
    if (typeof slot.model === "string") out.providers[id].model = slot.model;
  }
  return out;
}

export function loadAiSettings(): AiSettings {
  return normalizeAiSettings(readPref<unknown>("ai", null));
}

export function saveAiSettings(s: AiSettings): void {
  writePref("ai", s);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("noted-ai-settings"));
}

/** The active provider's preset, address and model. */
export function activeProvider(s: AiSettings) {
  const preset = PROVIDERS[s.provider];
  return { preset, ...s.providers[s.provider] };
}

/** A base URL without trailing slashes; "" if it isn't an http(s) URL. */
export function normalizeBaseUrl(url: string): string {
  const v = url.trim().replace(/\/+$/, "");
  try {
    const { protocol } = new URL(v);
    return protocol === "http:" || protocol === "https:" ? v : "";
  } catch {
    return "";
  }
}

/**
 * Chrome asks permission before a public site talks to a machine on the user's
 * own network, and needs to be told when a request is for one. Only claimed for
 * addresses that can't resolve anywhere else (as Rabbithole does).
 */
export function addressSpaceHint(url: string): { targetAddressSpace?: "loopback" | "local" } {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return {};
  }
  if (host === "localhost" || host === "[::1]" || /^127\./.test(host)) return { targetAddressSpace: "loopback" };
  const o = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (o) {
    const [a, b] = [Number(o[1]), Number(o[2])];
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      return { targetAddressSpace: "local" };
    }
  }
  return host.endsWith(".local") ? { targetAddressSpace: "local" } : {};
}

/** Whether a repository's notes may go to a remote (non-local) provider. */
export function remoteAllowed(setting: "auto" | "allow" | "never", encrypted: boolean): boolean {
  return setting === "allow" || (setting === "auto" && !encrypted);
}
