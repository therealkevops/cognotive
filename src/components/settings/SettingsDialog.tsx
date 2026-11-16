"use client";

import { Check, FolderGit2, HardDrive, Lock, Monitor, Moon, Sun, X } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ACCENTS, loadAppearance, saveAppearance, type Appearance } from "@/lib/appearance";
import { forgetKeys, saveKeys } from "@/lib/crypto/key-store";
import { createEncryption, unlockWithPassphrase, unlockWithRecoveryKey } from "@/lib/crypto/repo-crypto";
import { GitHubClient, type RepoSummary } from "@/lib/github/client";
import { saveToken, type StoredToken } from "@/lib/github/token-store";
import { verifyToken } from "@/lib/github/verify-token";
import { probeRepo, writeEncryptionHeader, type RepoProbe } from "@/lib/sync/encryption-setup";
import { GitHubRemote } from "@/lib/sync/remote";
import { formatDate, type VaultSettings } from "@/lib/vault/settings";
import { normalizePath } from "@/lib/vault/paths";
import {
  DEFAULT_IDLE_SECONDS,
  describeVault,
  newVaultId,
  type GitHubVaultConfig,
  type SyncMode,
  type VaultConfig,
} from "@/lib/vault/registry";
import { isIOS, useInstall } from "@/lib/install";
import { MIN_PASSPHRASE, newPassphraseError, RecoveryKeyStep, UnlockFields, type SecretKind } from "../sync/EncryptionFields";
import { TokenInstructions } from "../sync/TokenFields";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";

export type SettingsSection = "appearance" | "editor" | "vault" | "vaults" | "app";

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "editor", label: "Editor" },
  { id: "vault", label: "This repository" },
  { id: "vaults", label: "Repositories & sync" },
  { id: "app", label: "Install app" },
];

/**
 * Settings, in sections: a list on the left, labelled rows on the right.
 * Changes apply as they're made; text fields save when you leave them.
 */
export function SettingsDialog({ onClose, initial = "appearance" }: { onClose(): void; initial?: SettingsSection }) {
  const [section, setSection] = useState<SettingsSection>(initial);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="dialog-panel relative flex h-[min(44rem,88vh)] max-w-4xl flex-col overflow-hidden md:flex-row"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-sidebar p-3 pr-14 md:w-56 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:p-4"
        >
          <h2 className="mb-3 hidden px-2.5 font-serif text-2xl md:block">Settings</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="nav-item shrink-0 text-left"
              aria-current={section === s.id ? "page" : undefined}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-10 md:py-8">
          <div className="mx-auto max-w-2xl">
            {section === "appearance" && <AppearanceSection />}
            {section === "editor" && <EditorSection />}
            {section === "vault" && <ThisVaultSection />}
            {section === "vaults" && <VaultsSection />}
            {section === "app" && <InstallSection />}
          </div>
        </div>
        <button
          type="button"
          className="icon-button absolute top-3 right-3"
          aria-label="Close settings"
          onClick={onClose}
        >
          <X size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/* ---------- Layout pieces ---------- */

function SectionHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <header className="mb-6">
      <h3 className="font-serif text-2xl">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </header>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
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
function Row({
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
function Switch({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
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
function TextSetting({
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

/* ---------- Appearance ---------- */

function useAppearance(): [Appearance, (patch: Partial<Appearance>) => void] {
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
function ThemePreview({ theme }: { theme: Appearance["theme"] }) {
  const light = { bg: "#faf9f5", side: "#f3f1ea", line: "#d8d4c8" };
  const dark = { bg: "#262624", side: "#1f1e1d", line: "#4a4843" };
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

function AppearanceSection() {
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

function EditorSection() {
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

/* ---------- This vault ---------- */

function ThisVaultSection() {
  const { settings, updateSettings } = useVault();
  const save = (patch: Partial<VaultSettings>) => void updateSettings(patch);
  const ids = {
    attachments: useId(),
    templates: useId(),
    dailyFolder: useId(),
    dailyFormat: useId(),
    dailyTemplate: useId(),
    linkFormat: useId(),
    newNotes: useId(),
    newNoteFolder: useId(),
  };
  return (
    <section aria-label="This repository">
      <SectionHeader
        title="This repository"
        description={
          <>
            Saved in the repository at <code className="text-[0.8em]">.noted/settings.json</code>, so they sync with it.
          </>
        }
      />
      <Group title="Links">
        <Row
          label="New links use"
          description="Markdown links also work on github.com. Existing links stay as they are; the command palette converts a note."
          id={ids.linkFormat}
        >
          <select
            id={ids.linkFormat}
            className="input"
            value={settings.linkFormat}
            onChange={(e) => save({ linkFormat: e.target.value as VaultSettings["linkFormat"] })}
          >
            <option value="wikilink">Wikilinks: [[Note]]</option>
            <option value="markdown">Markdown: [Note](Note.md)</option>
          </select>
        </Row>
        <Row label="New notes from links go in" description="Where a note is created when you open a link to it." id={ids.newNotes}>
          <select
            id={ids.newNotes}
            className="input"
            value={settings.newNoteLocation}
            onChange={(e) => save({ newNoteLocation: e.target.value as VaultSettings["newNoteLocation"] })}
          >
            <option value="current">The linking note&apos;s folder</option>
            <option value="root">The repository root</option>
            <option value="folder">A folder…</option>
          </select>
        </Row>
        {settings.newNoteLocation === "folder" && (
          <Row label="Folder for new notes from links" id={ids.newNoteFolder}>
            <TextSetting id={ids.newNoteFolder} value={settings.newNoteFolder} onSave={(v) => save({ newNoteFolder: v })} />
          </Row>
        )}
      </Group>
      <Group title="Files">
        <Row label="Attachment folder" description="Where pasted, dropped and uploaded files go." id={ids.attachments}>
          <TextSetting id={ids.attachments} value={settings.attachmentFolder} onSave={(v) => save({ attachmentFolder: v })} />
        </Row>
        <Row label="Templates folder" description="Notes here are offered by Insert template." id={ids.templates}>
          <TextSetting id={ids.templates} value={settings.templateFolder} onSave={(v) => save({ templateFolder: v })} />
        </Row>
      </Group>
      <Group title="Daily notes">
        <Row label="Daily notes folder" id={ids.dailyFolder}>
          <TextSetting id={ids.dailyFolder} value={settings.dailyFolder} onSave={(v) => save({ dailyFolder: v })} />
        </Row>
        <Row
          label="Daily note name"
          description={`Today: ${formatDate(new Date(), settings.dailyFormat || "YYYY-MM-DD")}`}
          id={ids.dailyFormat}
        >
          <TextSetting id={ids.dailyFormat} value={settings.dailyFormat} onSave={(v) => save({ dailyFormat: v })} />
        </Row>
        <Row label="Daily note template" description="A note path, such as Templates/Daily.md. Empty for none." id={ids.dailyTemplate}>
          <TextSetting
            id={ids.dailyTemplate}
            value={settings.dailyTemplate}
            placeholder="None"
            onSave={(v) => save({ dailyTemplate: v })}
          />
        </Row>
      </Group>
      <Group title="Drawings">
        <Row label="Save an SVG copy of each drawing" description="So drawings show as pictures on github.com.">
          <div className="flex sm:justify-end">
            <Switch
              label="Save an SVG copy of each drawing"
              checked={settings.drawingSvgCopy}
              onChange={(v) => save({ drawingSvgCopy: v })}
            />
          </div>
        </Row>
      </Group>
    </section>
  );
}

/* ---------- Account ---------- */

/* ---------- Install ---------- */

function InstallSection() {
  const { state, install } = useInstall();
  return (
    <section aria-label="Install app">
      <SectionHeader
        title="Install app"
        description="Install noted-ai to open it in its own window, from your dock, taskbar, Start menu or home screen. It works offline too."
      />
      <Group>
        {state === "installed" ? (
          <Row label="Installed" description="You're using noted-ai as an app." >
            <span className="flex text-sm text-muted sm:justify-end">
              <Check size={16} aria-hidden className="mr-1.5 text-accent" /> Installed
            </span>
          </Row>
        ) : state === "available" ? (
          <Row label="Install noted-ai" description="Adds it as an app on this device.">
            <div className="flex sm:justify-end">
              <button type="button" className="button-primary" onClick={() => void install()}>
                Install
              </button>
            </div>
          </Row>
        ) : isIOS() ? (
          <Row label="On iPhone and iPad" description="In Safari, tap the Share button, then “Add to Home Screen”." stack>
            <span />
          </Row>
        ) : (
          <Row
            label="From your browser's menu"
            description="Chrome and Edge: the install icon in the address bar, or the menu's “Install noted-ai”. Safari on a Mac: File → Add to Dock. Firefox doesn't install web apps on desktop."
            stack
          >
            <span />
          </Row>
        )}
      </Group>
      <Group title="Shortcuts">
        <p className="py-2 text-[0.8125rem] leading-snug text-muted">
          Once installed, right-click the app&apos;s icon (or long-press it on Android) for quick actions:{" "}
          <strong className="font-medium text-foreground">New note</strong>,{" "}
          <strong className="font-medium text-foreground">Today&apos;s note</strong>,{" "}
          <strong className="font-medium text-foreground">Search notes</strong> and{" "}
          <strong className="font-medium text-foreground">New canvas</strong>.
        </p>
      </Group>
    </section>
  );
}

/* ---------- Vaults ---------- */

function VaultsSection() {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <SectionHeader title="Repositories & sync" description="Each repository is a separate set of notes, kept in this browser or synced with GitHub." />
      <VaultList />
      <div className="mt-4">
        {adding ? <ConnectRepoForm onDone={() => setAdding(false)} /> : <AddButtons onGitHub={() => setAdding(true)} />}
      </div>
    </>
  );
}

function VaultList() {
  const { vaults, active, switchTo, remove, update } = useVaults();
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <section aria-label="Repositories">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {vaults.map((v) => (
          <li key={v.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
                {v.kind === "github" ? <FolderGit2 size={18} aria-hidden /> : <HardDrive size={18} aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {v.name}
                  {v.id === active.id && (
                    <span className="rounded-full bg-accent/12 px-2 py-px text-[0.6875rem] font-medium text-accent">Open</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted">{describeVault(v)}</p>
              </div>
              {v.id !== active.id && (
                <button type="button" className="button-secondary" onClick={() => switchTo(v.id)}>
                  Open
                </button>
              )}
              <button
                type="button"
                className="button-secondary"
                aria-expanded={editing === v.id}
                onClick={() => setEditing(editing === v.id ? null : v.id)}
              >
                Edit
              </button>
            </div>
            {editing === v.id && (
              <EditVault
                vault={v}
                canRemove={vaults.length > 1}
                onSave={(patch) => {
                  update(v.id, patch);
                  setEditing(null);
                }}
                onRemove={async () => {
                  const where =
                    v.kind === "github"
                      ? `Its notes stay in ${v.owner}/${v.repo}, but changes not yet synced will be lost.`
                      : "Its notes are only stored in this browser and will be deleted.";
                  if (window.confirm(`Remove “${v.name}” from this browser? ${where}`)) {
                    await remove(v.id);
                  }
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EditVault({
  vault,
  canRemove,
  onSave,
  onRemove,
}: {
  vault: VaultConfig;
  canRemove: boolean;
  onSave(patch: Partial<VaultConfig>): void;
  onRemove(): void;
}) {
  const [name, setName] = useState(vault.name);
  const [syncMode, setSyncMode] = useState<SyncMode>(vault.kind === "github" ? vault.syncMode : "auto");
  const [idle, setIdle] = useState(vault.kind === "github" ? vault.idleSeconds : DEFAULT_IDLE_SECONDS);
  return (
    <form
      className="mt-3 space-y-3 rounded-lg bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(
          vault.kind === "github"
            ? { name: name.trim() || vault.name, syncMode, idleSeconds: idle }
            : { name: name.trim() || vault.name },
        );
      }}
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {vault.kind === "github" && <SyncFields mode={syncMode} setMode={setSyncMode} idle={idle} setIdle={setIdle} />}
      {vault.kind === "github" && <ReplaceToken vault={vault} />}
      {vault.kind === "github" && vault.encrypted && (
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Lock size={14} aria-hidden /> Encrypted
            </span>
            This browser holds the key. Forget it to require the passphrase again here.
          </p>
          <button
            type="button"
            className="button-secondary shrink-0"
            onClick={() => {
              if (window.confirm("Forget the key on this device? Syncing stops until you enter the passphrase again.")) {
                void forgetKeys(vault.id).then(() => window.location.reload());
              }
            }}
          >
            Forget key
          </button>
        </div>
      )}
      <div className="flex justify-between gap-2">
        <button
          type="button"
          className="rounded-lg px-2 text-sm text-red-700 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-400"
          disabled={!canRemove}
          title={canRemove ? undefined : "Keep at least one repository"}
          onClick={onRemove}
        >
          Remove from this browser
        </button>
        <button type="submit" className="button-primary">
          Save
        </button>
      </div>
    </form>
  );
}

/** Swaps the GitHub token a repository syncs with on this device. */
function ReplaceToken({ vault }: { vault: GitHubVaultConfig }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = `${vault.owner}/${vault.repo}`;
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted">
          <span className="block text-sm font-medium text-foreground">GitHub token</span>
          Saved in this browser only.
        </p>
        {!open && (
          <button type="button" className="button-secondary shrink-0" onClick={() => setOpen(true)}>
            Replace token
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2">
          <TokenInstructions repo={label} />
          <div className="flex flex-wrap items-end gap-2">
            <input
              className="input min-w-0 flex-1 font-mono"
              type="password"
              autoComplete="off"
              aria-label="New GitHub token"
              placeholder="github_pat_…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="button"
              className="button-primary"
              disabled={!text.trim() || busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                verifyToken(text, { owner: vault.owner, repo: vault.repo })
                  .then((t) => saveToken(vault.id, t))
                  .then(() => window.location.reload())
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Checking…" : "Save token"}
            </button>
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

function SyncFields({
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

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-snug text-muted">{hint}</span>}
    </label>
  );
}

/** "Add starter templates", offered when a repository is created. */
function StarterTemplatesOption({ checked, onChange }: { checked: boolean; onChange(v: boolean): void }) {
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

function AddButtons({ onGitHub }: { onGitHub(): void }) {
  const { add } = useVaults();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("New repository");
  const [starters, setStarters] = useState(true);
  if (creating) {
    return (
      <form
        aria-label="New local repository"
        className="space-y-4 rounded-xl border border-border p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          add({ id: newVaultId("local"), name: name.trim(), kind: "local", ...(starters ? { starterTemplates: true } : {}) });
        }}
      >
        <h4 className="font-serif text-lg">New local repository</h4>
        <Field label="Name">
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <StarterTemplatesOption checked={starters} onChange={setStarters} />
        <div className="flex justify-end gap-2">
          <button type="button" className="button-secondary" onClick={() => setCreating(false)}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={!name.trim()}>
            Create and open
          </button>
        </div>
      </form>
    );
  }
  return (
    <section aria-label="Add a repository" className="flex flex-wrap gap-2">
      <button type="button" className="button-primary" onClick={onGitHub}>
        Connect a GitHub repository
      </button>
      <button type="button" className="button-secondary" onClick={() => setCreating(true)}>
        New local repository
      </button>
    </section>
  );
}

function ConnectRepoForm({ onDone }: { onDone(): void }) {
  const { add } = useVaults();
  const [patText, setPatText] = useState("");
  const [pat, setPat] = useState<StoredToken | null>(null);
  const [checkingPat, setCheckingPat] = useState(false);
  const client = useMemo(
    () => new GitHubClient(async () => pat?.token ?? ""),
    [pat],
  );
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repoName, setRepoName] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [syncMode, setSyncMode] = useState<SyncMode>("auto");
  const [idle, setIdle] = useState(DEFAULT_IDLE_SECONDS);
  // Encryption: what the chosen branch holds, and the secrets typed for it.
  const [probe, setProbe] = useState<RepoProbe | "checking" | null>(null);
  const [encrypt, setEncrypt] = useState(true);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [secretKind, setSecretKind] = useState<SecretKind>("passphrase");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<{ key: string; config: GitHubVaultConfig } | null>(null);
  // Starter templates: suggested for a new, empty repository; off when it already has notes. null: follow that.
  const [starters, setStarters] = useState<boolean | null>(null);
  // Can the token write to the chosen repository? Public ones are listed even when it can only read.
  const [writable, setWritable] = useState<boolean | "checking">(true);

  const checkPat = () => {
    setCheckingPat(true);
    setError(null);
    verifyToken(patText)
      .then(async (t) => {
        const gh = new GitHubClient(async () => t.token);
        const list = await gh.writableRepos(await gh.listUserRepos());
        setPat(t);
        setRepos(list);
        if (!list.length) {
          setError(
            "This token can't write to any repository yet. Open it on GitHub (Settings → Developer settings → Fine-grained tokens), add your notes repository under Repository access, and set Contents to Read and write. Then use the token again.",
          );
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCheckingPat(false));
  };
  const resetToken = () => {
    setPat(null);
    setPatText("");
    setRepos(null);
    setRepoName("");
    setProbe(null);
    setError(null);
  };

  const repo = repos?.find((r) => r.fullName === repoName);
  useEffect(() => {
    if (!repo || !branch) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows the check while GitHub answers
    setProbe("checking");
    probeRepo(new GitHubRemote(client, repo.owner, repo.name, branch))
      .then((p) => live && setProbe(p))
      .catch((e: unknown) => {
        if (!live) return;
        setProbe(null);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [client, repo, branch]);
  const pickRepo = (fullName: string) => {
    setRepoName(fullName);
    setWritable("checking");
    const r = repos?.find((x) => x.fullName === fullName);
    if (!r) return;
    client
      .canWrite(r.owner, r.name)
      .then((ok) => setWritable(ok !== false))
      .catch(() => setWritable(true)); // can't tell; sync will report a real problem
    setName((n) => n || r.name);
    setBranch(r.defaultBranch);
    setBranches([r.defaultBranch]);
    client
      .listBranches(r.owner, r.name)
      .then((b) => setBranches(b.length ? b : [r.defaultBranch]))
      .catch(() => {});
  };

  if (recovery) {
    return (
      <RecoveryKeyStep
        recoveryKey={recovery.key}
        repoLabel={`${recovery.config.owner}/${recovery.config.repo}`}
        onDone={() => {
          add(recovery.config);
          onDone();
        }}
      />
    );
  }

  const probeKind = probe && typeof probe === "object" ? probe.kind : null;
  const passError = probeKind === "empty" && encrypt ? newPassphraseError(pass, confirm) : null;
  const wantStarters = starters ?? probeKind === "empty";
  const ready = writable === true && probe !== "checking" && (probeKind === "encrypted" ? !!secret.trim() : !passError);

  let folderError: string | null = null;
  let cleanFolder = "";
  try {
    cleanFolder = normalizePath(folder);
    if (cleanFolder.split("/").some((s) => s.startsWith("."))) folderError = "Hidden folders can't hold a repository.";
  } catch {
    folderError = 'The folder can\'t contain "..".';
  }

  return (
    <form
      aria-label="Connect a GitHub repository"
      className="space-y-4 rounded-xl border border-border p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!repo || !branch || folderError || !ready || busy) return;
        const config: GitHubVaultConfig = {
          id: newVaultId("github"),
          kind: "github",
          name: name.trim() || repo.name,
          owner: repo.owner,
          repo: repo.name,
          branch,
          folder: cleanFolder,
          syncMode,
          idleSeconds: idle,
          ...(wantStarters ? { starterTemplates: true } : {}),
        };
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            if (pat) await saveToken(config.id, pat);
            if (!probeKind || probeKind === "plain" || (probeKind === "empty" && !encrypt)) {
              add(config);
              onDone();
            } else if (probe && typeof probe === "object" && probe.kind === "encrypted") {
              const keys =
                secretKind === "passphrase"
                  ? await unlockWithPassphrase(probe.header, secret)
                  : await unlockWithRecoveryKey(probe.header, secret);
              await saveKeys(config.id, keys);
              add({ ...config, encrypted: true });
              onDone();
            } else {
              const { header, keys, recoveryKey } = await createEncryption(pass);
              await writeEncryptionHeader(new GitHubRemote(client, repo.owner, repo.name, branch), header);
              await saveKeys(config.id, keys);
              setRecovery({ key: recoveryKey, config: { ...config, encrypted: true } });
            }
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        })();
      }}
    >
      <h4 className="font-serif text-lg">Connect a GitHub repository</h4>
      <div className="space-y-3">
        <p className="text-sm text-muted">
          noted-ai syncs with a GitHub token that can only reach the repositories you pick.
        </p>
        {pat ? (
          <p className="flex items-center justify-between gap-2 text-sm">
            <span>
              Token for <strong>@{pat.login}</strong>
              {pat.expiresAt ? `, expires ${new Date(pat.expiresAt).toLocaleDateString()}` : ", doesn't expire"}
            </span>
            <button
              type="button"
              className="text-xs text-muted underline hover:text-accent"
              onClick={resetToken}
            >
              Use another token
            </button>
          </p>
        ) : (
          <>
            <TokenInstructions />
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
                <span className="font-medium">GitHub token</span>
                <input
                  className="input font-mono"
                  type="password"
                  autoComplete="off"
                  placeholder="github_pat_…"
                  value={patText}
                  onChange={(e) => setPatText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (patText.trim() && !checkingPat) checkPat();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="button-primary"
                disabled={!patText.trim() || checkingPat}
                onClick={checkPat}
              >
                {checkingPat ? "Checking access…" : "Continue"}
              </button>
            </div>
          </>
        )}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {pat && (
        <Field
          label="Repository"
          hint={
            writable === false
              ? undefined
              : "Repositories this token can write to."
          }
        >
          <select
            className="input"
            value={repoName}
            onChange={(e) => pickRepo(e.target.value)}
            disabled={!repos}
            required
          >
            <option value="">{repos ? (repos.length ? "Choose a repository…" : "No repositories yet") : "Loading…"}</option>
            {repos?.map((r) => (
              <option key={r.fullName} value={r.fullName}>
                {r.fullName}
                {r.private ? " (private)" : ""}
              </option>
            ))}
          </select>
        </Field>
      )}
      {pat && repo && writable === false && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          This token can only read {repo.fullName}, so it can&apos;t sync there. Add the repository to the token&apos;s
          repository access on GitHub, with Contents set to Read and write, then{" "}
          <button type="button" className="font-medium underline" onClick={() => pickRepo(repo.fullName)}>
            check again
          </button>
          .
        </p>
      )}
      {repo && (
        <>
          <Field label="Branch">
            <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Folder in the GitHub repository" hint={folderError ?? "Leave empty to use the whole GitHub repository, or name a subfolder such as notes."}>
            <input className="input" value={folder} placeholder="(whole repository)" onChange={(e) => setFolder(e.target.value)} />
          </Field>
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <SyncFields mode={syncMode} setMode={setSyncMode} idle={idle} setIdle={setIdle} />
          <StarterTemplatesOption checked={wantStarters} onChange={setStarters} />
          <fieldset className="space-y-3 rounded-lg bg-surface p-4" aria-label="Encryption">
            {probe === "checking" && <p className="text-sm text-muted">Checking the repository…</p>}
            {probeKind === "encrypted" && (
              <>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Lock size={15} aria-hidden /> This repository is encrypted
                </p>
                <UnlockFields kind={secretKind} setKind={setSecretKind} secret={secret} setSecret={setSecret} />
              </>
            )}
            {probeKind === "empty" && (
              <>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
                  <span>
                    <span className="font-medium">Encrypt this repository</span>
                    <span className="block text-xs text-muted">
                      Notes and their names are encrypted in this browser before they reach GitHub. GitHub, and anyone
                      who gets into your account, sees only scrambled files.
                    </span>
                  </span>
                </label>
                {encrypt && (
                  <>
                    <Field label="Passphrase" hint={`At least ${MIN_PASSPHRASE} characters. You'll need it once on each device.`}>
                      <input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
                    </Field>
                    <Field label="Confirm passphrase">
                      <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                    </Field>
                    {pass && passError && <p className="text-xs text-muted">{passError}</p>}
                  </>
                )}
              </>
            )}
            {probeKind === "plain" && (
              <p className="text-xs text-muted">
                This repository already has unencrypted files, so it will sync without encryption. To encrypt, use a new,
                empty repository: older versions stay readable in a repository&apos;s history.
              </p>
            )}
          </fieldset>
        </>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="button-secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button-primary" disabled={!repo || !!folderError || !ready || busy}>
          {busy ? (probeKind === "encrypted" ? "Unlocking…" : "Encrypting…") : "Connect and open"}
        </button>
      </div>
    </form>
  );
}
