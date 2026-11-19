import { addressSpaceHint, normalizeBaseUrl, PREFERRED_MODELS } from "./providers";
import { requestHeaders, errorFor, type Endpoint } from "./openai-compatible";

/** A model a provider offers. Prices are US dollars per million tokens. */
export interface ModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  tools?: boolean;
  promptPrice?: number;
  completionPrice?: number;
  free?: boolean;
}

/** Reads a `/models` reply (OpenRouter's rich one, or a plain OpenAI-style list). */
export function parseModels(json: unknown): ModelInfo[] {
  const data = (json as { data?: unknown[]; models?: unknown[] })?.data ?? (json as { models?: unknown[] })?.models ?? [];
  const out: ModelInfo[] = [];
  for (const raw of Array.isArray(data) ? data : []) {
    const m = raw as {
      id?: string;
      name?: string;
      model?: string;
      context_length?: number;
      supported_parameters?: string[];
      pricing?: { prompt?: string | number; completion?: string | number };
    };
    const id = m.id ?? m.model;
    if (typeof id !== "string" || !id) continue;
    const perM = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : undefined;
    };
    const promptPrice = perM(m.pricing?.prompt);
    const completionPrice = perM(m.pricing?.completion);
    out.push({
      id,
      name: typeof m.name === "string" && m.name ? m.name : id,
      ...(typeof m.context_length === "number" ? { contextLength: m.context_length } : {}),
      ...(Array.isArray(m.supported_parameters) ? { tools: m.supported_parameters.includes("tools") } : {}),
      ...(promptPrice !== undefined ? { promptPrice } : {}),
      ...(completionPrice !== undefined ? { completionPrice } : {}),
      ...(promptPrice === 0 && completionPrice === 0 ? { free: true } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Models matching every word of a query, in name or id. */
export function searchModels(models: ModelInfo[], query: string, opts: { toolsOnly?: boolean } = {}): ModelInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter(
    (m) =>
      (!opts.toolsOnly || m.tools !== false) &&
      words.every((w) => m.id.toLowerCase().includes(w) || m.name.toLowerCase().includes(w)),
  );
}

/** The first preferred model the catalog has, else a tool-capable one, else the first. */
export function defaultModel(models: ModelInfo[]): string {
  const ids = new Set(models.map((m) => m.id));
  return PREFERRED_MODELS.find((id) => ids.has(id)) ?? models.find((m) => m.tools)?.id ?? models[0]?.id ?? "";
}

export type ModelFilter = "all" | "free" | "tools";

export interface ModelGroup {
  id: "suggested" | "free" | "other";
  label: string;
  models: ModelInfo[];
}

/** How many suggested models lead the list. */
export const SUGGESTED_COUNT = 4;

/**
 * The catalog as it's listed: suggested models first, then free ones, then
 * the rest by name; narrowed by a search and a filter.
 */
export function groupModels(models: ModelInfo[], opts: { query?: string; filter?: ModelFilter } = {}): { groups: ModelGroup[]; total: number } {
  const filter = opts.filter ?? "all";
  const matching = searchModels(models, opts.query ?? "", { toolsOnly: filter === "tools" }).filter((m) => filter !== "free" || m.free);
  const byId = new Map(matching.map((m) => [m.id, m]));
  const suggested =
    filter === "free"
      ? []
      : PREFERRED_MODELS.filter((id) => byId.has(id))
          .slice(0, SUGGESTED_COUNT)
          .map((id) => byId.get(id)!);
  const taken = new Set(suggested.map((m) => m.id));
  const byName = (a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name);
  const free = matching.filter((m) => m.free && !taken.has(m.id)).sort(byName);
  const other = matching.filter((m) => !m.free && !taken.has(m.id)).sort(byName);
  const groups: ModelGroup[] = [
    { id: "suggested" as const, label: "Suggested", models: suggested },
    { id: "free" as const, label: "Free", models: free },
    { id: "other" as const, label: filter === "all" && !opts.query ? "All models" : "Other models", models: other },
  ].filter((g) => g.models.length);
  return { groups, total: matching.length };
}

/** Cuts groups down to `limit` models in all, keeping their order. */
export function limitGroups(groups: ModelGroup[], limit: number): ModelGroup[] {
  let left = limit;
  const out: ModelGroup[] = [];
  for (const g of groups) {
    if (left <= 0) break;
    out.push({ ...g, models: g.models.slice(0, left) });
    left -= g.models.length;
  }
  return out;
}

export function priceLabel(m: ModelInfo): string {
  if (m.free) return "Free";
  if (m.promptPrice === undefined || m.completionPrice === undefined) return "";
  const f = (n: number) => (n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 1 : 0));
  return `$${f(m.promptPrice)} in · $${f(m.completionPrice)} out per M`;
}

const cache = new Map<string, { at: number; models: ModelInfo[] }>();
const TTL = 60 * 60 * 1000;
const STORE = "noted-ai:ai-models:";

/** Lists a provider's models. OpenRouter's catalog is cached for an hour (it's public and large). */
export async function fetchModels(ep: Endpoint, opts: { fresh?: boolean; signal?: AbortSignal } = {}): Promise<ModelInfo[]> {
  const base = normalizeBaseUrl(ep.baseUrl);
  if (!base) return [];
  const hit = cache.get(base) ?? readStored(base);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL) return hit.models;
  const url = `${base}/models`;
  const headers = requestHeaders(ep);
  delete headers["Content-Type"];
  const res = await fetch(url, { headers, signal: opts.signal, ...addressSpaceHint(url) } as RequestInit);
  if (!res.ok) throw errorFor(res.status, await res.text().catch(() => ""));
  const models = parseModels(await res.json());
  const entry = { at: Date.now(), models };
  cache.set(base, entry);
  if (ep.openRouter) {
    try {
      sessionStorage.setItem(STORE + base, JSON.stringify(entry));
    } catch {}
  }
  return models;
}

function readStored(base: string) {
  try {
    const raw = sessionStorage.getItem(STORE + base);
    return raw ? (JSON.parse(raw) as { at: number; models: ModelInfo[] }) : undefined;
  } catch {
    return undefined;
  }
}

/** What OpenRouter says about a key: its label, spend and limit. */
export interface KeyStatus {
  label: string;
  usage?: number;
  limit?: number | null;
  freeTier?: boolean;
}

export async function checkOpenRouterKey(ep: Endpoint): Promise<KeyStatus> {
  const res = await fetch(`${normalizeBaseUrl(ep.baseUrl)}/key`, { headers: requestHeaders(ep) });
  if (!res.ok) throw errorFor(res.status, await res.text().catch(() => ""));
  const j = (await res.json()) as { data?: { label?: string; usage?: number; limit?: number | null; is_free_tier?: boolean } };
  return {
    label: j.data?.label ?? "",
    ...(typeof j.data?.usage === "number" ? { usage: j.data.usage } : {}),
    ...(j.data?.limit !== undefined ? { limit: j.data.limit } : {}),
    ...(typeof j.data?.is_free_tier === "boolean" ? { freeTier: j.data.is_free_tier } : {}),
  };
}

export function _clearModelCache() {
  cache.clear();
}
