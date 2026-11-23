"use client";

import { useEffect, useState } from "react";
import { loadKey } from "@/lib/ai/keys";
import { PROVIDERS, remoteAllowed } from "@/lib/ai/providers";
import { useAiSettings } from "@/lib/ai/useAiSettings";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";

/**
 * What's still needed before AI can answer, as a sentence pointing to Settings, or null
 * when it's ready (the provider allowed here, its key saved, an address and a model chosen).
 */
export function useAiSetup(): string | null {
  const vault = useVault();
  const { active: vaultConfig } = useVaults();
  const [ai] = useAiSettings();
  const [keyState, setKeyState] = useState<{ provider: string; has: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    const check = () => void loadKey(ai.provider).then((k) => live && setKeyState({ provider: ai.provider, has: !!k }));
    check();
    // Saving or removing a key in Settings announces it.
    window.addEventListener("noted-ai-keys", check);
    return () => {
      live = false;
      window.removeEventListener("noted-ai-keys", check);
    };
  }, [ai.provider]);
  const hasKey = keyState?.provider === ai.provider ? keyState.has : null;

  const { preset, model, baseUrl } = { preset: PROVIDERS[ai.provider], ...ai.providers[ai.provider] };
  const encrypted = vaultConfig.kind === "github" && !!vaultConfig.encrypted;
  const blocked = !preset.local && !remoteAllowed(vault.settings.aiRemote, encrypted);
  return blocked
    ? "This repository only allows local models. Choose the Local provider in Settings → AI."
    : preset.requiresKey && hasKey === false
      ? `Add your ${preset.label} ${preset.keyLabel} in Settings → AI to start.`
      : !baseUrl
        ? "Set the provider's address in Settings → AI."
        : !model
          ? "Choose a model in Settings → AI."
          : null;
}
