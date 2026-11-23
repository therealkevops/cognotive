"use client";

import { useState, type ReactNode } from "react";

/* ---------- Layout pieces ---------- */

export function SectionHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="mb-6">
      <h3 className="font-semibold tracking-tight text-2xl">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </header>
  );
}

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      {title && <h4 className="mb-1 text-sm font-semibold">{title}</h4>}
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

/**
 * One setting: its label and description on the left, the control on the
 * right (or underneath on narrow screens). `id` ties the label to the control.
 */
export function Row({
  label,
  description,
  id,
  children,
  stack = false,
}: {
  label: string;
  description?: ReactNode;
  id?: string;
  children: ReactNode;
  stack?: boolean;
}) {
  return (
    <div className={`flex gap-x-8 gap-y-2 py-4 ${stack ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between"}`}>
      <div className="min-w-0">
        {id ? (
          <label htmlFor={id} className="block text-sm font-medium">
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium">{label}</p>
        )}
        {description && <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">{description}</p>}
      </div>
      <div className={stack ? "" : "shrink-0 sm:w-64"}>{children}</div>
    </div>
  );
}

/** An on/off switch. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-foreground/15"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[1.125rem]" : "translate-x-0.5"}`}
      />
    </button>
  );
}

/** A text box that saves when you leave it or press Enter. */
export function TextSetting({
  id,
  value,
  onSave,
  placeholder,
}: {
  id: string;
  value: string;
  onSave(v: string): void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    // The saved value changed elsewhere (e.g. a sync): show it.
    setSeen(value);
    setDraft(value);
  }
  return (
    <input
      id={id}
      className="input"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onSave(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}
