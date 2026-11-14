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
  /** Typeface for notes: a book-like serif, a clean sans, or the system font. */
  noteFont: "serif" | "sans" | "system";
  /** Link previews on hover: always, or only while Ctrl/Cmd is held. */
  hoverPreview: "always" | "mod";
}

export const ACCENTS = {
  clay: { light: "#c96442", dark: "#d97757" },
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

export const NOTE_FONTS: Record<Appearance["noteFont"], string> = {
  serif: "var(--font-serif-face), Georgia, serif",
  sans: "var(--font-geist-sans), system-ui, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  accent: "clay",
  fontSize: 16,
  lineWidth: "normal",
  linkClick: "edit",
  hoverPreview: "always",
  noteFont: "serif",
};

export function loadAppearance(): Appearance {
  const a = { ...DEFAULT_APPEARANCE, ...readPref<Partial<Appearance>>("appearance", {}) };
  if (!(a.accent in ACCENTS)) a.accent = "clay";
  if (!(a.noteFont in NOTE_FONTS)) a.noteFont = "serif";
  if (a.linkClick !== "edit" && a.linkClick !== "follow") a.linkClick = "edit";
  if (a.hoverPreview !== "always" && a.hoverPreview !== "mod") a.hoverPreview = "always";
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
  root.style.setProperty("--note-font", NOTE_FONTS[a.noteFont]);
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
)};var W=${JSON.stringify(LINE_WIDTHS)};var r=document.documentElement;if(a.theme==="light"||a.theme==="dark")r.setAttribute("data-theme",a.theme);var c=A[a.accent]||A.clay;var F=${JSON.stringify(NOTE_FONTS)};if(F[a.noteFont])r.style.setProperty("--note-font",F[a.noteFont]);r.style.setProperty("--accent-light",c.light);r.style.setProperty("--accent-dark",c.dark);if(a.fontSize)r.style.setProperty("--editor-font-size",a.fontSize+"px");if(W[a.lineWidth])r.style.setProperty("--line-width",W[a.lineWidth]);}catch(e){}})();`;
