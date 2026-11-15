"use client";

import { useSyncExternalStore } from "react";

/**
 * Installing the app as a PWA. Chromium browsers fire `beforeinstallprompt`
 * once, possibly before React has mounted, so it's caught here at load and
 * kept until the user clicks Install.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // show our own button instead of the browser's mini-bar
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/** Whether the app is running as an installed app (its own window). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone and iPad, where installing is Safari's Share → Add to Home Screen. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

type InstallState = "installed" | "available" | "unavailable";
let snapshot: InstallState = "unavailable";
const compute = (): InstallState => (installed || isStandalone() ? "installed" : deferred ? "available" : "unavailable");

/** The install state, updating when the browser offers or completes an install. */
export function useInstall(): { state: InstallState; install(): Promise<boolean> } {
  const state = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      const next = compute();
      if (next !== snapshot) snapshot = next;
      return snapshot;
    },
    () => "unavailable" as InstallState,
  );
  return {
    state,
    install: async () => {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      await e.prompt();
      const { outcome } = await e.userChoice;
      emit();
      return outcome === "accepted";
    },
  };
}
