import { readPref, writePref } from "./prefs";

/** Per-browser look and feel. */
export interface Appearance {
  theme: "system" | "light" | "dark";
  accent: keyof typeof ACCENTS;
  /** Editor and reading text size, px. */
  fontSize: number;
  lineWidth: "narrow" | "normal" | "wide" | "full";
  /** What a plain click on a link does in live preview: edit it (↗ follows) or follow it. */
  linkClick: "edit" | "follow";
}

export const ACCENTS = {
  violet: { light: "#6d5bd0", dark: "#a294f0" },
  blue: { light: "#2f6fd6", dark: "#7aa7f0" },
  teal: { light: "#0f8a7e", dark: "#4cc5b5" },
  green: { light: "#2f8a3e", dark: "#6fca7d" },
  orange: { light: "#c2601a", dark: "#f0a060" },
  rose: { light: "#c2416b", dark: "#f08aa8" },
} as const;

export const LINE_WIDTHS: Record<Appearance["lineWidth"], string> = {
  narrow: "38rem",
  normal: "46rem",
  wide: "60rem",
  full: "100%",
};

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  accent: "violet",
  fontSize: 16,
  lineWidth: "normal",
  linkClick: "edit",
};

export function loadAppearance(): Appearance {
  const a = { ...DEFAULT_APPEARANCE, ...readPref<Partial<Appearance>>("appearance", {}) };
  if (!(a.accent in ACCENTS)) a.accent = "violet";
  if (a.linkClick !== "edit" && a.linkClick !== "follow") a.linkClick = "edit";
  return a;
}

export function saveAppearance(a: Appearance): void {
  writePref("appearance", a);
  applyAppearance(a);
}

/** Sets data-theme and the CSS variables the stylesheet reads. */
export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  if (a.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", a.theme);
  root.style.setProperty("--accent-light", ACCENTS[a.accent].light);
  root.style.setProperty("--accent-dark", ACCENTS[a.accent].dark);
  root.style.setProperty("--editor-font-size", `${a.fontSize}px`);
  root.style.setProperty("--line-width", LINE_WIDTHS[a.lineWidth]);
  window.dispatchEvent(new Event("noted-appearance"));
}

/** Whether the app is currently dark, honouring a manual theme choice. */
export function isDark(): boolean {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Inline script for <head>: applies saved appearance before first paint so a
 * manual dark theme doesn't flash light. Must stay self-contained.
 */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{var a=JSON.parse(localStorage.getItem("noted-ai:appearance")||"{}");var A=${JSON.stringify(
  ACCENTS,
)};var W=${JSON.stringify(LINE_WIDTHS)};var r=document.documentElement;if(a.theme==="light"||a.theme==="dark")r.setAttribute("data-theme",a.theme);var c=A[a.accent]||A.violet;r.style.setProperty("--accent-light",c.light);r.style.setProperty("--accent-dark",c.dark);if(a.fontSize)r.style.setProperty("--editor-font-size",a.fontSize+"px");if(W[a.lineWidth])r.style.setProperty("--line-width",W[a.lineWidth]);}catch(e){}})();`;
