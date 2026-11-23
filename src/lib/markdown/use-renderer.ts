import { useSyncExternalStore } from "react";
import { onRendererChange, rendererVersion } from "./render";

/**
 * Changes when KaTeX or the highlighter finishes loading: add it to what a component's
 * rendered markdown depends on, so maths and code are drawn properly once they can be.
 */
export function useRendererVersion(): number {
  return useSyncExternalStore(onRendererChange, rendererVersion, rendererVersion);
}
