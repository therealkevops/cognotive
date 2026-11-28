import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_HISTORY, goBack, goForward, renameInHistory, visit, type NavHistory } from "@/lib/nav/history";
import type { VaultApi } from "../vault/useVault";

type Intent = "replace" | "history";

/**
 * Back/Forward through the notes visited in this window, returning to where each was
 * scrolled. The workspace tells it when the open note changes (`arrived`, while rendering)
 * and when a link is followed in the same tab (`followHere`). Ctrl/Cmd+Alt+Left/Right and the
 * mouse's Back and Forward buttons step through it too.
 */
export function useNavigation(vault: VaultApi, scroller: () => HTMLElement | null) {
  const activePath = vault.active?.path;
  const [nav, setNav] = useState<NavHistory>(EMPTY_HISTORY);
  /**
   * Why the next note is being opened, if not the default (a new tab): following
   * a link in this tab, or stepping Back/Forward. Applies only once `path` opens.
   */
  const [intent, setIntent] = useState<{ path: string; kind: Intent } | null>(null);
  /** Where each note was scrolled to, so Back and Forward return there. */
  const scrollPositions = useRef(new Map<string, number>());
  const [pendingScroll, setPendingScroll] = useState<{ path: string; top: number } | null>(null);

  /** Back or Forward to the previous or next visited note, at the scroll position you left it. */
  const navigate = (dir: "back" | "forward") => {
    const step = (dir === "back" ? goBack : goForward)(nav, activePath ?? null, (p) => vault.exists(p));
    if (!step) return;
    setNav(step.history);
    setIntent({ path: step.path, kind: "history" });
    setPendingScroll({ path: step.path, top: scrollPositions.current.get(step.path) ?? 0 });
    void vault.open(step.path);
  };
  /** Latest Back/Forward, for the keyboard and mouse-button handlers. */
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey || (key !== "arrowleft" && key !== "arrowright")) return;
      e.preventDefault();
      navigateRef.current(key === "arrowleft" ? "back" : "forward");
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      navigateRef.current(e.button === 3 ? "back" : "forward");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, []);

  /**
   * Records that the open note changed from `from` to `to` (called while rendering). Returns
   * why it opened, if not the default: a link followed in this tab, or Back/Forward.
   */
  const arrived = (from: string | undefined, to: string | undefined, renamed: boolean): Intent | null => {
    const why = intent && intent.path === to ? intent.kind : null;
    if (intent) setIntent(null);
    if (renamed) setNav((h) => renameInHistory(h, from!, to!));
    else if (why !== "history") setNav((h) => visit(h, from ?? null));
    return why;
  };

  // After Back/Forward, restore the scroll position once the note has rendered.
  useEffect(() => {
    if (!pendingScroll || pendingScroll.path !== activePath) return;
    let tries = 0;
    let id: ReturnType<typeof setTimeout>;
    const apply = () => {
      const el = scroller();
      if (el && (el.scrollHeight - el.clientHeight >= pendingScroll.top || tries >= 20)) {
        el.scrollTop = pendingScroll.top;
        setPendingScroll(null);
      } else {
        tries++;
        id = setTimeout(apply, 50);
      }
    };
    // Wait for the editor to finish loading the note (it scrolls new notes to the top).
    id = setTimeout(apply, 50);
    return () => clearTimeout(id);
  }, [pendingScroll, activePath, scroller]);

  /** The next opening of `path` replaces the current tab (a link followed in this tab). */
  const followHere = useCallback((path: string) => setIntent({ path, kind: "replace" }), []);
  /** Remembers where `path` is scrolled to. */
  const rememberScroll = useCallback((path: string, top: number) => scrollPositions.current.set(path, top), []);

  const can = (list: string[]) => list.some((p) => p !== activePath && vault.exists(p));
  return {
    canGoBack: can(nav.back),
    canGoForward: can(nav.forward),
    navigate,
    arrived,
    followHere,
    rememberScroll,
  };
}
