import { fetchModels } from "./catalog";
import { loadKey } from "./keys";
import type { Endpoint } from "./openai-compatible";
import { PROVIDERS, type AiSettings } from "./providers";

/**
 * Everything needed to send a request with the current settings, or why it
 * can't be sent. `tools` is false for a model OpenRouter says can't use them.
 */
export async function endpointFor(
  ai: AiSettings,
  opts: { remoteAllowed: boolean },
): Promise<{ ep: Endpoint; model: string; tools?: boolean } | { error: string }> {
  const preset = PROVIDERS[ai.provider];
  const { baseUrl, model } = ai.providers[ai.provider];
  if (!preset.local && !opts.remoteAllowed) return { error: "This repository only allows local models. Choose the Local provider in Settings → AI." };
  const apiKey = preset.allowsKey ? await loadKey(ai.provider) : "";
  if (preset.requiresKey && !apiKey) return { error: `Add your ${preset.label} key in Settings → AI.` };
  if (!baseUrl) return { error: "Set the provider's address in Settings → AI." };
  if (!model) return { error: "Choose a model in Settings → AI." };
  const openRouter = ai.provider === "openrouter";
  const ep = { baseUrl, apiKey, openRouter };
  const info = openRouter ? (await fetchModels(ep).catch(() => [])).find((m) => m.id === model) : undefined;
  return { ep, model, tools: info?.tools };
}
