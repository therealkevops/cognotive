"use client";

import "@excalidraw/excalidraw/index.css";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { elementLinkTarget } from "@/lib/drawing/parse";
import { splitLinkText } from "@/lib/links/parse";

type InitialData = ExcalidrawInitialDataState;

// The "source" field Excalidraw writes into files; keep it stable across
// deployments (preview URLs would otherwise change it on every save).
if (typeof window !== "undefined") {
  (window as unknown as { EXCALIDRAW_EXPORT_SOURCE?: string }).EXCALIDRAW_EXPORT_SOURCE = "noted-ai";
}

function useDarkMode() {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

export interface DrawingViewProps {
  /** Changes when a different drawing is opened. */
  docKey: string;
  initial: string;
  onChange(json: string): void;
  /** Follows a note link set on an element ("[[Note]]"). */
  onOpenLink(target: string, heading?: string): void;
}

/**
 * Edits an .excalidraw file. Saves only when the drawing itself changes (an
 * element or embedded image), not when you pan, zoom or select.
 */
export default function DrawingView({ docKey, initial, onChange, onOpenLink }: DrawingViewProps) {
  const dark = useDarkMode();
  const onChangeRef = useRef(onChange);
  const onOpenLinkRef = useRef(onOpenLink);
  useEffect(() => {
    onChangeRef.current = onChange;
    onOpenLinkRef.current = onOpenLink;
  }, [onChange, onOpenLink]);

  // Parsed once per drawing; Excalidraw owns the scene afterwards.
  const { initialData, error } = useMemo(() => {
    try {
      const d = JSON.parse(initial || "{}") as Partial<InitialData> & { appState?: Record<string, unknown> };
      return {
        initialData: {
          elements: d.elements ?? [],
          appState: { ...(d.appState ?? {}), collaborators: new Map() },
          files: d.files ?? {},
          scrollToContent: true,
        } as InitialData,
        error: null,
      };
    } catch {
      return { initialData: null, error: "This drawing file isn't valid JSON, so it can't be opened." };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read `initial` only when the drawing changes
  }, [docKey]);

  const lastFingerprint = useRef<string | null>(null);

  if (error || !initialData) {
    return <p className="p-8 text-red-600 dark:text-red-400">{error}</p>;
  }

  return (
    <div className="h-full w-full" data-testid="drawing">
      <Excalidraw
        key={docKey}
        initialData={initialData}
        theme={dark ? "dark" : "light"}
        UIOptions={{ canvasActions: { loadScene: false } }}
        onChange={(elements, appState, files) => {
          // Element versions change on every real edit; selection and scrolling don't.
          const fingerprint = `${elements.map((e) => `${e.id}:${e.version}`).join(",")}|${Object.keys(files).join(",")}|${appState.viewBackgroundColor}`;
          if (lastFingerprint.current === null) {
            lastFingerprint.current = fingerprint; // the initial load isn't an edit
            return;
          }
          if (fingerprint === lastFingerprint.current) return;
          lastFingerprint.current = fingerprint;
          onChangeRef.current(serializeAsJSON(elements, appState, files, "local"));
        }}
        onLinkOpen={(element, event) => {
          const target = elementLinkTarget(element.link);
          if (!target) return; // a web link: let Excalidraw open it
          event.preventDefault();
          const parts = splitLinkText(target);
          onOpenLinkRef.current(parts.target, parts.heading);
        }}
      />
    </div>
  );
}
