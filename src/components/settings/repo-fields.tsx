"use client";

import { DEFAULT_IDLE_SECONDS, type SyncMode } from "@/lib/vault/registry";

/* Form fields shared by connecting and editing a repository. */

export function SyncFields({
  mode,
  setMode,
  idle,
  setIdle,
}: {
  mode: SyncMode;
  setMode(m: SyncMode): void;
  idle: number;
  setIdle(n: number): void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">Sync</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="sync" checked={mode === "auto"} onChange={() => setMode("auto")} className="mt-1" />
        <span>
          Automatic: commit
          <input
            type="number"
            min={5}
            max={3600}
            aria-label="Seconds after the last edit"
            className="input mx-1.5 inline-block w-16 py-0.5"
            value={idle}
            disabled={mode !== "auto"}
            onChange={(e) => setIdle(Math.max(5, Math.min(3600, Number(e.target.value) || DEFAULT_IDLE_SECONDS)))}
          />
          seconds after you stop typing, and when you leave the tab
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="radio" name="sync" checked={mode === "manual"} onChange={() => setMode("manual")} className="mt-1" />
        <span>Manual: only when you press Sync</span>
      </label>
    </fieldset>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-snug text-muted">{hint}</span>}
    </label>
  );
}

/** "Add starter templates", offered when a repository is created. */
export function StarterTemplatesOption({ checked, onChange }: { checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">Add starter templates</span>
        <span className="block text-xs text-muted">
          Meeting, Project, Person, Weekly review and Daily, in a Templates folder. Edit or delete them any time.
        </span>
      </span>
    </label>
  );
}
