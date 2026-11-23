"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useId, useState } from "react";
import { ACCENTS, loadAppearance, saveAppearance, type Appearance } from "@/lib/appearance";
import { Group, Row, SectionHeader, Switch } from "./parts";


/* Appearance and editor settings. */

export function useAppearance(): [Appearance, (patch: Partial<Appearance>) => void] {
  const [a, setA] = useState<Appearance>(loadAppearance);
  const set = (patch: Partial<Appearance>) => {
    const next = { ...a, ...patch };
    setA(next);
    saveAppearance(next);
  };
  return [a, set];
}

const THEMES: Array<{ id: Appearance["theme"]; label: string; icon: typeof Sun }> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "system", label: "Match system", icon: Monitor },
  { id: "dark", label: "Dark", icon: Moon },
];

/** A small picture of the app in a theme, for the theme picker. */
export function ThemePreview({ theme }: { theme: Appearance["theme"] }) {
  const light = { bg: "#ffffff", side: "#f4f4f5", line: "#d1d1d6" };
  const dark = { bg: "#121212", side: "#1a1a1d", line: "#45454d" };
  const half = (c: typeof light) => (
    <div className="flex h-full flex-1" style={{ background: c.bg }}>
      <div className="w-1/4" style={{ background: c.side }} />
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: c.line }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.line }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: c.line }} />
      </div>
    </div>
  );
  return (
    <div className="flex h-16 w-full overflow-hidden rounded-lg">
      {theme === "dark" ? half(dark) : theme === "light" ? half(light) : (
        <>
          {half(light)}
          {half(dark)}
        </>
      )}
    </div>
  );
}

export function AppearanceSection() {
  const [a, set] = useAppearance();
  const sizeId = useId();
  return (
    <section aria-label="Appearance">
      <SectionHeader title="Appearance" description="These apply to this browser only." />
      <Group>
        <Row label="Theme" stack>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
            {THEMES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={a.theme === id}
                aria-label={label}
                onClick={() => set({ theme: id })}
                className={`rounded-xl border p-1.5 text-left transition-colors ${
                  a.theme === id ? "border-accent ring-2 ring-accent/25" : "border-border hover:border-border-strong"
                }`}
              >
                <ThemePreview theme={id} />
                <span className="mt-1.5 flex items-center gap-1.5 px-1 pb-0.5 text-sm">
                  <Icon size={14} aria-hidden className="text-muted" />
                  {label}
                </span>
              </button>
            ))}
          </div>
        </Row>
        <Row label="Accent colour" description="Links, highlights and switches.">
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {(Object.keys(ACCENTS) as Array<Appearance["accent"]>).map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                aria-pressed={a.accent === name}
                title={name[0].toUpperCase() + name.slice(1)}
                className={`flex h-7 w-7 items-center justify-center rounded-full ring-offset-2 ring-offset-raised transition-shadow ${
                  a.accent === name ? "ring-2 ring-foreground/60" : "hover:ring-2 hover:ring-border-strong"
                }`}
                style={{ background: ACCENTS[name].light }}
                onClick={() => set({ accent: name })}
              >
                {a.accent === name && <Check size={14} className="text-white" aria-hidden />}
              </button>
            ))}
          </div>
        </Row>
      </Group>
      <Group title="Notes">
        <Row label="Font" description="The typeface notes are written and read in.">
          <div role="radiogroup" aria-label="Note font" className="segmented w-full">
            {(
              [
                ["serif", "Serif", "var(--font-serif-face), Georgia, serif"],
                ["sans", "Sans", "var(--font-geist-sans), sans-serif"],
                ["system", "System", "system-ui, sans-serif"],
              ] as const
            ).map(([id, label, family]) => (
              <button key={id} type="button" role="radio" aria-checked={a.noteFont === id} onClick={() => set({ noteFont: id })}>
                <span style={{ fontFamily: family }}>{label}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row label="Text size" description={`${a.fontSize}px`} id={sizeId}>
          <input
            id={sizeId}
            type="range"
            min={13}
            max={22}
            value={a.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
        </Row>
        <Row label="Line width" description="How wide a line of text can get.">
          <div role="radiogroup" aria-label="Line width" className="segmented w-full">
            {(
              [
                ["narrow", "Narrow"],
                ["normal", "Normal"],
                ["wide", "Wide"],
                ["full", "Full"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={a.lineWidth === id} onClick={() => set({ lineWidth: id })}>
                {label}
              </button>
            ))}
          </div>
        </Row>
      </Group>
    </section>
  );
}

/* ---------- Editor ---------- */

export function EditorSection() {
  const [a, set] = useAppearance();
  const clickId = useId();
  const hoverId = useId();
  const tablesId = useId();
  return (
    <section aria-label="Editor">
      <SectionHeader title="Editor" description="How writing and links behave. These apply to this browser only." />
      <Group>
        <Row
          label="Clicking a link in live preview"
          description="When it edits, the ↗ after a link (or Ctrl/Cmd-click, or Alt+Enter) opens it."
          id={clickId}
        >
          <select
            id={clickId}
            className="input"
            value={a.linkClick}
            onChange={(e) => set({ linkClick: e.target.value as Appearance["linkClick"] })}
          >
            <option value="edit">Edits the link</option>
            <option value="follow">Opens the link</option>
          </select>
        </Row>
        <Row label="Check spelling" description="Underline misspelt words using your browser's spell checker.">
          <div className="flex sm:justify-end">
            <Switch label="Check spelling" checked={a.spellcheck} onChange={(v) => set({ spellcheck: v })} />
          </div>
        </Row>
        <Row label="Link previews on hover" description="A card showing the linked note." id={hoverId}>
          <select
            id={hoverId}
            className="input"
            value={a.hoverPreview}
            onChange={(e) => set({ hoverPreview: e.target.value as Appearance["hoverPreview"] })}
          >
            <option value="always">Show</option>
            <option value="mod">Only while holding Ctrl/Cmd</option>
          </select>
        </Row>
        <Row
          label="Tables in live preview"
          description="As a grid you type in cells; Tab moves on, and right-click adds, moves, sorts or deletes rows and columns. Notes still store ordinary markdown tables."
          id={tablesId}
        >
          <select
            id={tablesId}
            className="input"
            value={a.tables}
            onChange={(e) => set({ tables: e.target.value as Appearance["tables"] })}
          >
            <option value="grid">Edit as a grid</option>
            <option value="markdown">Edit as markdown</option>
          </select>
        </Row>
      </Group>
    </section>
  );
}
