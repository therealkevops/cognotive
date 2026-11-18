"use client";

import { useCallback, useEffect, useState } from "react";
import { loadAiSettings, saveAiSettings, type AiSettings } from "./providers";

/** AI settings for this browser, kept in step between Settings and the chat panel. */
export function useAiSettings(): [AiSettings, (next: AiSettings) => void] {
  const [s, setS] = useState<AiSettings>(() => loadAiSettings());
  useEffect(() => {
    const on = () => setS(loadAiSettings());
    window.addEventListener("noted-ai-settings", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("noted-ai-settings", on);
      window.removeEventListener("storage", on);
    };
  }, []);
  const set = useCallback((next: AiSettings) => {
    setS(next);
    saveAiSettings(next);
  }, []);
  return [s, set];
}
