"use client";

import type { EditorView } from "@codemirror/view";
import { BookOpen, CodeXml, Files, Network, PanelLeft, Pencil, Search, Settings, Tags, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { readPref, writePref } from "@/lib/prefs";
import type { LinkHost } from "@/lib/editor/wikilinks";
import type { LinkContext } from "@/lib/markdown/remark-links";
import { extractHeadings } from "@/lib/markdown/outline";
import { plainText } from "@/lib/search/note-index";
import { basename, dirname, extname, isDrawing, isImage, isMarkdown, noteTitle } from "@/lib/vault/paths";
import { GraphDialog, LocalGraph } from "../graph/GraphDialog";
import { SettingsDialog } from "../settings/SettingsDialog";
import { SyncButton } from "../sync/SyncButton";
import { useSync } from "../sync/useSync";
import { useVault } from "../vault/useVault";
import { VaultSwitcher } from "../vault/VaultSwitcher";
import { FileTree } from "./FileTree";
import { FileView } from "./FileView";
import { LinksPanel } from "./LinksPanel";
import { Outline } from "./Outline";
import { QuickSwitcher } from "./QuickSwitcher";
import { SearchPanel } from "./SearchPanel";
import { TagsPanel } from "./TagsPanel";
import { Toolbar } from "./Toolbar";

const MarkdownEditor = dynamic(() => import("./MarkdownEditor"), { ssr: false });
// Excalidraw is about 1 MB: loaded only when a drawing is opened.
const DrawingView = dynamic(() => import("./DrawingView"), {
  ssr: false,
  loading: () => <p className="p-8 text-muted">Loading drawing…</p>,
});
const ReadingView = dynamic(() => import("./ReadingView"), {
  ssr: false,
  loading: () => <p className="p-8 text-muted">Rendering…</p>,
});

type Mode = "live" | "source" | "reading";
type SidebarTab = "files" | "search" | "tags";
type PanelTab = "outline" | "links" | "graph";

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
  const [graphOpen, setGraphOpen] = useState(false);
  const [panelTab, setPanelTabState] = useState<PanelTab>(() => readPref<PanelTab>("panelTab", "links"));
  const setPanelTab = (t: PanelTab) => {
    setPanelTabState(t);
    writePref("panelTab", t);
  };
  const [searchQuery, setSearchQuery] = useState("");
  /** Heading to scroll to once the note being opened has loaded. */
  const [pendingHeading, setPendingHeading] = useState<string | null>(null);
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
      } else if (key === "g" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setGraphOpen(true);
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

  const jumpTo = useCallback(
    (offset: number) => {
      if (mode === "reading") {
        const index = extractHeadings(vault.activeText).findIndex((h) => h.offset === offset);
        readingRef.current
          ?.querySelectorAll(".prose-note > h1, .prose-note > h2, .prose-note > h3, .prose-note > h4, .prose-note > h5, .prose-note > h6")
          [index]?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (view) {
        view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
        view.focus();
      }
    },
    [mode, vault.activeText, view],
  );

  /** Follows a link: opens the note it resolves to, or creates it. Then scrolls to `heading`. */
  const openLink = useCallback(
    async (target: string, heading?: string) => {
      const from = vault.active?.path;
      const path = target ? vault.links.resolve(target, from) : (from ?? null);
      if (path) {
        if (heading && isMarkdown(path)) setPendingHeading(heading);
        if (path !== from) await vault.open(path);
        else if (heading) setPendingHeading(heading);
        return;
      }
      const clean = target.replace(/\.md$/i, "");
      await vault.createNote(clean.includes("/") ? dirname(clean) : "", basename(clean));
    },
    [vault],
  );

  // Scroll to a linked heading once its note is open.
  useEffect(() => {
    if (!pendingHeading || !vault.active) return;
    const want = pendingHeading.toLowerCase();
    const h = extractHeadings(vault.activeText).find((x) => x.text.toLowerCase() === want);
    // Wait a frame so the editor or reading view has the new note.
    const id = requestAnimationFrame(() => {
      if (h) jumpTo(h.offset);
      setPendingHeading(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pendingHeading, vault.active, vault.activeText, jumpTo]);

  const showTag = useCallback((tag: string) => {
    setSearchQuery(`tag:${tag}`);
    setTab("search");
    setSidebarOpen(true);
  }, []);

  // What the editor needs for [[links]].
  const linkHost = useMemo<LinkHost>(
    () => ({
      resolve: (t) => vault.links.resolve(t, vault.active?.path),
      open: (t, h) => void openLink(t, h),
      notes: () =>
        vault.links
          .paths()
          .filter((p) => p !== vault.active?.path)
          .sort()
          .map((p) => ({
            path: p,
            title: noteTitle(p),
            aliases: vault.links.get(p)?.aliases ?? [],
            linkText: vault.links.linkText(p),
          })),
      headings: (p) => vault.links.get(p)?.headings.map((h) => h.text) ?? [],
      preview: (p) => plainText(vault.links.content(p) ?? "").slice(0, 500),
      embedPath: (t) => {
        const p = vault.links.resolve(t, vault.active?.path);
        return p && (isImage(p) || isDrawing(p)) ? p : null;
      },
      fileUrl: (p) => vault.fileUrl(p, { dark: prefersDark() }),
      saveFiles: async (files) => {
        const paths = await vault.addAttachments(files);
        return paths.map((p) => vault.links.linkText(p));
      },
    }),
    [vault, openLink],
  );

  const linkContext = useMemo<LinkContext>(
    () => ({
      resolve: (t) => vault.links.resolve(t, vault.active?.path),
      read: (p) => vault.links.content(p),
    }),
    // indexVersion: re-render links and embeds when other notes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault.links, vault.active?.path, vault.indexVersion],
  );

  const sidebar = (
    <>
      <VaultSwitcher onManage={() => setSettingsOpen(true)} />
      <div role="tablist" aria-label="Sidebar" className="mb-3 flex gap-1">
        {(
          [
            ["files", "Files", Files],
            ["search", "Search", Search],
            ["tags", "Tags", Tags],
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
      <div className="min-h-0 flex-1">
        {tab === "files" ? (
          <FileTree />
        ) : tab === "search" ? (
          <SearchPanel query={searchQuery} onQuery={setSearchQuery} autoFocus />
        ) : (
          <TagsPanel onTag={showTag} />
        )}
      </div>
      <button
        type="button"
        className="-mx-1 mt-2 flex items-center gap-2 rounded px-2 py-1.5 text-sm text-muted hover:bg-foreground/5 hover:text-foreground"
        onClick={() => setGraphOpen(true)}
        title="Graph view (Ctrl/Cmd+G)"
      >
        <Network size={15} aria-hidden />
        Graph view
      </button>
      <div className="-mx-1 mt-1 border-t border-border pt-2">
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

  const activePathNow = vault.active?.path ?? null;
  const kind = !activePathNow ? null : isMarkdown(activePathNow) ? "note" : isDrawing(activePathNow) ? "drawing" : "file";

  return (
    <>
      <AppShell
        sidebar={sidebar}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        panel={
          vault.active ? (
            <>
              <div role="tablist" aria-label="Note panels" className="mb-4 flex gap-1">
                {(
                  [
                    ["links", "Links"],
                    ["outline", "Outline"],
                    ["graph", "Graph"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={panelTab === id}
                    className={`flex-1 rounded px-2 py-1 text-sm ${
                      panelTab === id ? "bg-background font-medium shadow-sm" : "text-muted hover:text-foreground"
                    }`}
                    onClick={() => setPanelTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {panelTab === "outline" ? (
                <Outline markdown={vault.activeText} onJump={jumpTo} />
              ) : panelTab === "links" ? (
                <LinksPanel onOpenLink={(t) => void openLink(t)} />
              ) : (
                <LocalGraph onOpenFull={() => setGraphOpen(true)} />
              )}
            </>
          ) : null
        }
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
          {kind === "note" && (
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
        {kind === "note" && mode !== "reading" && (
          <div className="border-b border-border px-3 py-1">
            <Toolbar view={view} />
          </div>
        )}
        <div className={`min-h-0 flex-1 ${kind === "drawing" ? "overflow-hidden" : "overflow-y-auto"}`} ref={readingRef}>
          {!vault.ready ? (
            <p className="p-8 text-muted">Loading vault…</p>
          ) : !vault.active ? (
            <EmptyState onCreate={() => void vault.createNote()} onFind={() => setSwitcherOpen(true)} />
          ) : kind === "drawing" ? (
            <DrawingView
              docKey={`${vault.active.version}`}
              initial={vault.active.initial}
              onChange={vault.edit}
              onOpenLink={(t, h) => void openLink(t, h)}
            />
          ) : kind === "file" ? (
            <FileView path={vault.active.path} />
          ) : mode === "reading" ? (
            <ReadingView
              markdown={vault.activeText}
              links={linkContext}
              properties={vault.links.get(vault.active.path)?.properties}
              onOpenLink={(t, h) => void openLink(t, h)}
              onTag={showTag}
              fileUrl={(p) => vault.fileUrl(p, { dark: prefersDark() })}
              onOpenFile={(p) => void vault.open(p)}
            />
          ) : (
            <MarkdownEditor
              docKey={`${vault.active.version}`}
              initial={vault.active.initial}
              livePreview={mode === "live"}
              onChange={vault.edit}
              onView={setView}
              links={linkHost}
              // On touch devices, focusing would pop up the keyboard on every note open.
              autoFocus={!window.matchMedia("(pointer: coarse)").matches}
            />
          )}
        </div>
      </AppShell>
      {switcherOpen && <QuickSwitcher onClose={() => setSwitcherOpen(false)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {graphOpen && <GraphDialog onClose={() => setGraphOpen(false)} />}
      <Toasts />
    </>
  );
}

function prefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** A file's name without its extension: what the title box shows and edits. */
function stem(path: string) {
  const name = basename(path);
  const ext = extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/** The file's name, editable in place. Renames on Enter or blur; the extension is kept. */
function TitleInput({ path }: { path: string }) {
  const vault = useVault();
  const [value, setValue] = useState(stem(path));
  const commit = async () => {
    const name = value.trim();
    if (name === stem(path)) return;
    if (!name || !(await vault.rename(path, name))) setValue(stem(path));
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
          setValue(stem(path));
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
