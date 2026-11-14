"use client";

import type { EditorView } from "@codemirror/view";
import { BookOpen, CodeXml, Files, PanelLeft, Pencil, Search, Settings, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { readPref, writePref } from "@/lib/prefs";
import { extractHeadings } from "@/lib/markdown/outline";
import { noteTitle } from "@/lib/vault/paths";
import { SettingsDialog } from "../settings/SettingsDialog";
import { SyncButton } from "../sync/SyncButton";
import { useSync } from "../sync/useSync";
import { useVault } from "../vault/useVault";
import { VaultSwitcher } from "../vault/VaultSwitcher";
import { FileTree } from "./FileTree";
import { Outline } from "./Outline";
import { QuickSwitcher } from "./QuickSwitcher";
import { SearchPanel } from "./SearchPanel";
import { Toolbar } from "./Toolbar";

const MarkdownEditor = dynamic(() => import("./MarkdownEditor"), { ssr: false });
const ReadingView = dynamic(() => import("./ReadingView"), {
  ssr: false,
  loading: () => <p className="p-8 text-muted">Rendering…</p>,
});

type Mode = "live" | "source" | "reading";
type SidebarTab = "files" | "search";

const MODES: Array<{ id: Mode; label: string; icon: typeof Pencil }> = [
  { id: "live", label: "Live preview", icon: Pencil },
  { id: "source", label: "Source", icon: CodeXml },
  { id: "reading", label: "Reading", icon: BookOpen },
];

export function Workspace() {
  const vault = useVault();
  const [mode, setModeState] = useState<Mode>(() => readPref<Mode>("mode", "live"));
  const [lastEditMode, setLastEditMode] = useState<Exclude<Mode, "reading">>(() =>
    readPref("editMode", "live"),
  );
  const [tab, setTab] = useState<SidebarTab>("files");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<EditorView | null>(null);
  const readingRef = useRef<HTMLDivElement>(null);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    writePref("mode", m);
    if (m !== "reading") {
      setLastEditMode(m);
      writePref("editMode", m);
    }
  }, []);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "o" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setSwitcherOpen(true);
      } else if (key === "f" && e.shiftKey) {
        e.preventDefault();
        setTab("search");
        setSidebarOpen(true);
      } else if (key === "e" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setMode(mode === "reading" ? lastEditMode : "reading");
      } else if (e.code === "KeyN" && e.altKey) {
        e.preventDefault();
        void vault.createNote();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, lastEditMode, setMode, vault]);

  // Close the mobile sidebar after opening a note from it.
  const activePath = vault.active?.path;
  const [seenPath, setSeenPath] = useState(activePath);
  if (seenPath !== activePath) {
    setSeenPath(activePath);
    setSidebarOpen(false);
  }

  const jumpTo = (offset: number) => {
    if (mode === "reading") {
      const index = extractHeadings(vault.activeText).findIndex((h) => h.offset === offset);
      readingRef.current
        ?.querySelectorAll("h1, h2, h3, h4, h5, h6")
        [index]?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (view) {
      view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
      view.focus();
    }
  };

  const sidebar = (
    <>
      <VaultSwitcher onManage={() => setSettingsOpen(true)} />
      <div role="tablist" aria-label="Sidebar" className="mb-3 flex gap-1">
        {(
          [
            ["files", "Files", Files],
            ["search", "Search", Search],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-sm ${
              tab === id ? "bg-background font-medium shadow-sm" : "text-muted hover:text-foreground"
            }`}
            onClick={() => setTab(id)}
          >
            <Icon size={15} aria-hidden />
            {label}
          </button>
        ))}
        <button
          type="button"
          className="icon-button md:hidden"
          aria-label="Close sidebar"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1">{tab === "files" ? <FileTree /> : <SearchPanel autoFocus />}</div>
      <div className="-mx-1 mt-2 border-t border-border pt-2">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted hover:bg-foreground/5 hover:text-foreground"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={15} aria-hidden />
          Settings
        </button>
      </div>
    </>
  );

  return (
    <>
      <AppShell
        sidebar={sidebar}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        panel={vault.active ? <Outline markdown={vault.activeText} onJump={jumpTo} /> : null}
      >
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            className="icon-button md:hidden"
            aria-label="Open sidebar"
            onClick={() => setSidebarOpen(true)}
          >
            <PanelLeft size={18} aria-hidden />
          </button>
          {vault.active ? (
            <TitleInput key={vault.active.path} path={vault.active.path} />
          ) : (
            <span className="flex-1" />
          )}
          <SaveIndicator />
          <SyncButton />
          {vault.active && (
            <div role="radiogroup" aria-label="View mode" className="flex rounded-md border border-border p-0.5">
              {MODES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={mode === id}
                  aria-label={label}
                  title={id === "reading" ? `${label} (Ctrl/Cmd+E)` : label}
                  className={`rounded px-2 py-1 ${
                    mode === id ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
                  }`}
                  onClick={() => setMode(id)}
                >
                  <Icon size={15} aria-hidden />
                </button>
              ))}
            </div>
          )}
        </header>
        {vault.active && mode !== "reading" && (
          <div className="border-b border-border px-3 py-1">
            <Toolbar view={view} />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto" ref={readingRef}>
          {!vault.ready ? (
            <p className="p-8 text-muted">Loading vault…</p>
          ) : !vault.active ? (
            <EmptyState onCreate={() => void vault.createNote()} onFind={() => setSwitcherOpen(true)} />
          ) : mode === "reading" ? (
            <ReadingView markdown={vault.activeText} />
          ) : (
            <MarkdownEditor
              docKey={`${vault.active.version}`}
              initial={vault.active.initial}
              livePreview={mode === "live"}
              onChange={vault.edit}
              onView={setView}
              // On touch devices, focusing would pop up the keyboard on every note open.
              autoFocus={!window.matchMedia("(pointer: coarse)").matches}
            />
          )}
        </div>
      </AppShell>
      {switcherOpen && <QuickSwitcher onClose={() => setSwitcherOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <Toasts />
    </>
  );
}

/** The note's name, editable in place. Renames the file on Enter or blur. */
function TitleInput({ path }: { path: string }) {
  const vault = useVault();
  const [value, setValue] = useState(noteTitle(path));
  const commit = async () => {
    const name = value.trim();
    if (name === noteTitle(path)) return;
    if (!name || !(await vault.rename(path, name))) setValue(noteTitle(path));
  };
  return (
    <input
      aria-label="Note title"
      className="min-w-0 flex-1 truncate bg-transparent text-base font-semibold outline-none focus:underline focus:decoration-accent focus:underline-offset-4"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(noteTitle(path));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function SaveIndicator() {
  const { saveState, active } = useVault();
  if (!active) return null;
  const label = saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved";
  return (
    <span
      role="status"
      className={`hidden text-xs sm:inline ${saveState === "error" ? "text-red-600" : "text-muted"}`}
    >
      {label}
    </span>
  );
}

function EmptyState({ onCreate, onFind }: { onCreate(): void; onFind(): void }) {
  return (
    <div className="mx-auto mt-24 max-w-sm px-6 text-center">
      <p className="mb-4 text-muted">No note is open.</p>
      <div className="flex justify-center gap-2">
        <button type="button" className="button-primary" onClick={onCreate}>
          New note
        </button>
        <button type="button" className="button-secondary" onClick={onFind}>
          Open a note…
        </button>
      </div>
    </div>
  );
}

const AUTH_ERRORS: Record<string, string> = {
  not_configured: "GitHub sign-in isn't set up on this deployment yet.",
  denied: "GitHub sign-in was cancelled.",
  bad_state: "Sign-in expired or came from another tab. Please try again.",
  not_allowed: "This GitHub account isn't allowed to use this app.",
  failed: "GitHub sign-in failed. Please try again.",
};

/** Reads ?auth_error=... left by the sign-in callback, then removes it from the URL. */
function useAuthError(): [string | null, () => void] {
  const [message, setMessage] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get("auth_error");
    return code ? (AUTH_ERRORS[code] ?? AUTH_ERRORS.failed) : null;
  });
  useEffect(() => {
    if (!message) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("auth_error");
    window.history.replaceState(null, "", url);
  }, [message]);
  return [message, () => setMessage(null)];
}

function Toasts() {
  const { error, clearError } = useVault();
  const { notices, dismissNotices } = useSync();
  const [authError, clearAuthError] = useAuthError();
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 6000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  const toasts = [
    ...(error ? [{ key: "error", text: error, tone: "error", dismiss: clearError }] : []),
    ...(authError ? [{ key: "auth", text: authError, tone: "error", dismiss: clearAuthError }] : []),
    ...notices.map((n, i) => ({ key: `n${i}`, text: n, tone: "info", dismiss: dismissNotices })),
  ];
  if (!toasts.length) return null;
  return (
    <div className="fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.key}
          role={t.tone === "error" ? "alert" : "status"}
          className={`flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg ${
            t.tone === "error" ? "border-red-300 dark:border-red-800" : "border-border"
          }`}
        >
          <span className="flex-1">{t.text}</span>
          <button type="button" className="icon-button h-6 w-6" aria-label="Dismiss" onClick={t.dismiss}>
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
