import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ProviderId } from "./providers";

/**
 * API keys for AI providers: on this device only (IndexedDB), or in memory for
 * this session. Never in settings, never synced, never in a repository.
 */
interface KeyDB extends DBSchema {
  keys: { key: string; value: string };
}

let db_: Promise<IDBPDatabase<KeyDB>> | null = null;
const db = () =>
  (db_ ??= openDB<KeyDB>("noted-ai:ai-keys", 1, {
    upgrade(d) {
      d.createObjectStore("keys");
    },
  }));

const memory = new Map<ProviderId, string>();
const announce = () => typeof window !== "undefined" && window.dispatchEvent(new Event("noted-ai-keys"));

export async function loadKey(provider: ProviderId): Promise<string> {
  if (memory.has(provider)) return memory.get(provider)!;
  try {
    return (await (await db()).get("keys", provider)) ?? "";
  } catch {
    return "";
  }
}

export async function saveKey(provider: ProviderId, key: string, sessionOnly: boolean): Promise<void> {
  const v = key.trim();
  if (sessionOnly) {
    memory.set(provider, v);
    await (await db()).delete("keys", provider).catch(() => {});
    announce();
    return;
  }
  memory.delete(provider);
  if (v) await (await db()).put("keys", v, provider);
  else await (await db()).delete("keys", provider);
  announce();
}

export async function forgetKey(provider: ProviderId): Promise<void> {
  memory.delete(provider);
  await (await db()).delete("keys", provider).catch(() => {});
  announce();
}

/** A hint when a key looks wrong for the provider (pasted from the wrong place, cut short). */
export function keyHint(provider: ProviderId, key: string): string | null {
  const v = key.trim();
  if (!v || provider !== "openrouter") return null;
  if (v.startsWith("sk-ant-")) return "That looks like an Anthropic key. OpenRouter keys start with sk-or-.";
  if (v.startsWith("sk-") && !v.startsWith("sk-or-")) return "That looks like an OpenAI key. OpenRouter keys start with sk-or-.";
  if (v.startsWith("sk-or-") && v.length < 30) return "That key looks cut short.";
  return null;
}
