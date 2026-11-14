"use client";

import type { EditorView } from "@codemirror/view";
import { BookOpen, CodeXml, Files, PanelLeft, Pencil, Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { readPref, writePref } from "@/lib/prefs";
import { extractHeadings } from "@/lib/markdown/outline";
import { noteTitle } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";
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
      <ErrorToast />
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

function ErrorToast() {
  const { error, clearError } = useVault();
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 6000);
    return () => clearTimeout(t);
  }, [error, clearError]);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="fixed right-4 bottom-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-red-300 bg-background px-4 py-3 text-sm shadow-lg dark:border-red-800"
    >
      <span className="flex-1">{error}</span>
      <button type="button" className="icon-button h-6 w-6" aria-label="Dismiss" onClick={clearError}>
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
