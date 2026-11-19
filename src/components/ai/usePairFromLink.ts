"use client";

import { useEffect } from "react";
import { saveKey } from "@/lib/ai/keys";
import { loadAiSettings, saveAiSettings } from "@/lib/ai/providers";

/** The pairing code in a link the bridge printed ("…/#bridge=<code>"), or null. */
export function pairingCode(hash: string): string | null {
  return /(?:^#|&)bridge=([a-f0-9]{48})(?:&|$)/.exec(hash)?.[1] ?? null;
}

/**
 * Opening the bridge's pairing link pairs in one step: the code is saved
 * (as keys are), the Claude plan provider chosen, and the code taken out of
 * the address bar so it isn't left in the history.
 */
export function usePairFromLink(onPaired: () => void) {
  useEffect(() => {
    const code = pairingCode(location.hash);
    if (!code) return;
    history.replaceState(null, "", location.pathname + location.search);
    const ai = loadAiSettings();
    void saveKey("bridge", code, ai.sessionOnlyKeys).then(() => {
      saveAiSettings({ ...ai, provider: "bridge" });
      onPaired();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on load
  }, []);
}
