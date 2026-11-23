"use client";

import type { EditorView } from "@codemirror/view";
import { ArrowLeft, ArrowRight, BookOpen, CalendarDays, CodeXml, Files, History, FilePlus, ListChecks, ListTree, Link2, Activity, PanelLeft, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Search, Settings, Tags, LayoutTemplate, SlidersHorizontal, Sparkles, X, Zap } from "lucide-react";
import dynamic from "next/dynamic";
import { reloadOnChunkError } from "@/lib/chunk";
import type { ConflictRecord } from "@/lib/sync/conflicts";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, RailButton } from "@/components/AppShell";
import { isDark } from "@/lib/appearance";
import type { OpenHow } from "@/lib/links/open";
import { EMPTY_HISTORY, goBack, goForward, renameInHistory, visit, type NavHistory } from "@/lib/nav/history";
import { readPref, writePref } from "@/lib/prefs";
import { editTableSource } from "@/lib/editor/table-keys";
import { addProperty } from "@/lib/editor/properties-panel";
import { yamlValue } from "@/lib/editor/properties";
import { drawingProperties, keepDrawingProperties, setDrawingProperty } from "@/lib/drawing/properties";
import { ChatPanel } from "../ai/ChatPanel";
import { AskDialog, type AskSource } from "../ai/AskDialog";
import { AiActionsContext, useRunAction } from "../ai/useAsk";
import { usePairFromLink } from "../ai/usePairFromLink";
import { convertLinks, formatLink } from "@/lib/links/format";
import { setFrontmatterProperty } from "@/lib/markdown/frontmatter";
import { healthIgnored, hubProperty, vaultHealth } from "@/lib/links/health";
import { extractHeadings } from "@/lib/markdown/outline";
import { basename, dirname, displayName, isCanvas, isDrawing, isNote, noteTitle } from "@/lib/vault/paths";
import { drawingJson, isObsidianDrawing, replaceScene } from "@/lib/drawing/obsidian";
import { newNoteFromLink } from "@/lib/vault/settings";
import { insertIntoNote, renderTemplate, type Rendered } from "@/lib/templates/templates";
import { SettingsDialog, type SettingsSection } from "../settings/SettingsDialog";
import { HistoryDialog } from "../sync/HistoryDialog";
import { SyncButton } from "../sync/SyncButton";
import { useSync } from "../sync/useSync";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";
import { VaultSwitcher } from "../vault/VaultSwitcher";
import { ConflictBanner, ConflictDialog } from "./ConflictReview";
import { CreateNoteDialog } from "./CreateNoteDialog";
import { PropertiesPanel } from "./PropertiesPanel";
import { PropertyTable } from "./PropertyTable";
import { filesWithProperties } from "@/lib/links/property-query";
import { DeleteDialog } from "./DeleteDialog";
import { FileTree } from "./FileTree";
import { PinnedHubs } from "./PinnedHubs";
import { HealthDialog } from "./HealthDialog";
import { FileView } from "./FileView";
import { LinksPanel } from "./LinksPanel";
import { Picker, type PickerItem } from "./Picker";
import { SidePane, SidePaneContext } from "./SidePane";
import { TabBar } from "./TabBar";
import { Outline } from "./Outline";
import { QuickSwitcher } from "./QuickSwitcher";
import { SearchPanel } from "./SearchPanel";
import { CaptureDialog } from "./CaptureDialog";
import { BackupBanner } from "./BackupBanner";
import { fromShare, type Captured } from "@/lib/capture/capture";
import { takeShared } from "@/lib/capture/shared";
import { TasksPanel } from "./TasksPanel";
import { toggleTask, type Task } from "@/lib/tasks/tasks";
import { TagsPanel } from "./TagsPanel";
import { addStarterTemplates, needsDialog, TemplatesPanel, UseTemplateDialog, useTemplatePaths } from "./Templates";
import { Toolbar } from "./Toolbar";
import { EmptyState, SaveIndicator, TitleInput, Toasts } from "./WorkspaceParts";
import { captureTarget, dailyNote, deletePropertyEverywhere, exportZip, importZip, mapAsCanvas, renamePropertyEverywhere, saveCapture } from "./vault-actions";
import { useEditorHosts } from "./useEditorHosts";
import { ErrorBoundary } from "../ErrorBoundary";
import { placeBlock, QUERY_BLOCK } from "@/lib/editor/slash";
import { useAiSetup } from "../ai/useAiSetup";

const MarkdownEditor = dynamic(() => reloadOnChunkError(() => import("./MarkdownEditor"))(), { ssr: false });
// Excalidraw is about 1 MB: loaded only when a drawing is opened.
const DrawingView = dynamic(() => reloadOnChunkError(() => import("./DrawingView"))(), {
  ssr: false,
  loading: () => <p className="p-8 text-muted">Loading drawing…</p>,
});
// React Flow, for canvases: loaded only when a canvas is opened.
const CanvasView = dynamic(() => reloadOnChunkError(() => import("./CanvasView"))(), {
  ssr: false,
  loading: () => <p className="p-8 text-muted">Loading canvas…</p>,
});
const ReadingView = dynamic(() => reloadOnChunkError(() => import("./ReadingView"))(), {
  ssr: false,
  loading: () => <p className="p-8 text-muted">Rendering…</p>,
});

type Mode = "live" | "source" | "reading";
type SidebarTab = "files" | "search" | "tasks" | "tags" | "templates" | "properties";
type PanelTab = "outline" | "links" | "chat";

const MODES: Array<{ id: Mode; label: string; icon: typeof Pencil }> = [
  { id: "live", label: "Live preview", icon: Pencil },
  { id: "source", label: "Source", icon: CodeXml },
  { id: "reading", label: "Reading", icon: BookOpen },
];

export function Workspace() {
  const vault = useVault();
  const [mode, setModeState] = useState<Mode>(() => readPref<Mode>("mode", "live"));
  const [lastEditMode, setLastEditMode] = useState<Exclude<Mode, "reading">>(() => readPref("editMode", "live"));
  const [tab, setTab] = useState<SidebarTab>("files");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  /** Which settings section is open, or false. */
  const [settingsOpen, setSettingsOpen] = useState<false | SettingsSection>(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const [panelTab, setPanelTabState] = useState<PanelTab>(() =>
    (["outline", "chat"] as const).find((t) => t === readPref<string>("panelTab", "links")) ?? "links",
  );
  const setPanelTab = (t: PanelTab) => {
    setPanelTabState(t);
    writePref("panelTab", t);
  };
  const [searchQuery, setSearchQuery] = useState("");
  /** Heading to scroll to once the note being opened has loaded. */
  const [pendingHeading, setPendingHeading] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Collapsed sidebars show a rail of icons instead (remembered per browser). */
  const [leftCollapsed, setLeftCollapsedState] = useState(() => readPref("leftCollapsed", false));
  const [rightCollapsed, setRightCollapsedState] = useState(() => readPref("rightCollapsed", false));
  const setLeftCollapsed = useCallback((v: boolean) => {
    setLeftCollapsedState(v);
    writePref("leftCollapsed", v);
  }, []);
  const setRightCollapsed = useCallback((v: boolean) => {
    setRightCollapsedState(v);
    writePref("rightCollapsed", v);
  }, []);
  /** Latest sidebar toggles, for the keyboard shortcut handler. */
  const toggleSidesRef = useRef<{ left(): void; right(): void }>({ left() {}, right() {} });
  useEffect(() => {
    toggleSidesRef.current = {
      left: () => setLeftCollapsed(!leftCollapsed),
      right: () => setRightCollapsed(!rightCollapsed),
    };
  });
  const [view, setView] = useState<EditorView | null>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Choosing a template (from the command palette), then using it.
  const [templatePicker, setTemplatePicker] = useState<"new" | "insert" | null>(null);
  const [usingTemplate, setUsingTemplate] = useState<{ path: string; mode: "new" | "insert" } | null>(null);
  // Where to put the cursor once a note created from a template opens.
  /**
   * Where to put the cursor once a new note opens, counted from the end of the
   * note (new-note properties may be added at the top when it's created).
   */
  const pendingCursor = useRef<{ path: string; fromEnd: number } | null>(null);
  const [sidePath, setSidePath] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** A note about to be created from a link, waiting for the user to confirm its name and folder. */
  /** Files whose properties are open as a table. */
  const [propertyTable, setPropertyTable] = useState<string[] | null>(null);
  /** A sync conflict open for review. */
  const [reviewing, setReviewing] = useState<ConflictRecord | null>(null);
  /** A canvas being edited as text (to repair one that isn't valid JSON). */
  const [canvasAsText, setCanvasAsText] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ name: string; folder: string; hub?: boolean } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [asking, setAsking] = useState<AskSource | null>(null);
  /** Notes opened in this session, most recent first, for ranking link suggestions. */
  const [recent, setRecent] = useState<string[]>([]);
  const [importNote, setImportNote] = useState<string | null>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const chooseZip = useCallback(() => zipInput.current?.click(), []);
  const tabsKey = `vault:${vault.vaultId}:tabs`;
  const [tabs, setTabs] = useState<string[]>(() => readPref<string[]>(tabsKey, []));
  useEffect(() => writePref(tabsKey, tabs), [tabsKey, tabs]);
  const sync = useSync();
  const vaults = useVaults();

  // Starter templates chosen when the repository was created: added once it's ready. A GitHub
  // repository gets them after its first sync, next to whatever is already there.
  const seedingTemplates = useRef(false);
  const repo = vaults.active;
  const firstSyncDone = sync.status.kind === "idle" && sync.status.lastSyncedAt !== null;
  useEffect(() => {
    if (!repo.starterTemplates || !vault.ready || seedingTemplates.current) return;
    if (repo.kind === "github" && !firstSyncDone) return;
    seedingTemplates.current = true;
    void addStarterTemplates(vault).finally(() => vaults.update(repo.id, { starterTemplates: undefined }));
  }, [repo, vault, vaults, firstSyncDone]);
  /** Latest openDaily, for the keyboard shortcut handler. */
  const openDailyRef = useRef<() => Promise<void>>(async () => {});
  /** Back/Forward through visited notes. */
  const [nav, setNav] = useState<NavHistory>(EMPTY_HISTORY);
  /**
   * Why the next note is being opened, if not the default (a new tab): following
   * a link in this tab, or stepping Back/Forward. Applies only once `path` opens.
   */
  const [navIntent, setNavIntent] = useState<{ path: string; kind: "replace" | "history" } | null>(null);
  /** Where each note was scrolled to, so Back and Forward return there. */
  const scrollPositions = useRef(new Map<string, number>());
  const [pendingScroll, setPendingScroll] = useState<{ path: string; top: number } | null>(null);
  /** Latest Back/Forward, for the keyboard and mouse-button handlers. */
  const navigateRef = useRef<(dir: "back" | "forward") => void>(() => {});

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
      } else if (key === "p" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (key === "d" && e.shiftKey && !e.altKey) {
        e.preventDefault();
        void openDailyRef.current();
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
      } else if (e.code === "Backslash" && !e.altKey) {
        // Ctrl/Cmd+\ collapses or expands the left sidebar; with Shift, the right one.
        e.preventDefault();
        if (e.shiftKey) toggleSidesRef.current.right();
        else toggleSidesRef.current.left();
      } else if ((key === "arrowleft" || key === "arrowright") && e.altKey && !e.shiftKey) {
        e.preventDefault();
        navigateRef.current(key === "arrowleft" ? "back" : "forward");
      }
    };
    // The mouse's own Back and Forward buttons.
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      navigateRef.current(e.button === 3 ? "back" : "forward");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [mode, lastEditMode, setMode, vault]);

  // Close the mobile sidebar after opening a note from it.
  const activePath = vault.active?.path;
  const [seenPath, setSeenPath] = useState(activePath);
  if (seenPath !== activePath) {
    setSeenPath(activePath);
    setSidebarOpen(false);
    const renamed = !!seenPath && !!activePath && !vault.exists(seenPath);
    if (activePath) setRecent((r) => [activePath, ...r.filter((p) => p !== activePath && p !== (renamed ? seenPath : null))].slice(0, 50));
    const intent = navIntent && navIntent.path === activePath ? navIntent.kind : null;
    if (navIntent) setNavIntent(null);
    if (renamed) setNav((h) => renameInHistory(h, seenPath, activePath));
    else if (intent !== "history") setNav((h) => visit(h, seenPath ?? null));
    // Keep a tab for every opened file. A rename, a link followed in this tab, and
    // Back/Forward replace the current tab; anything else opens a new one.
    if (activePath) {
      setTabs((t) => {
        if (t.includes(activePath)) return t;
        if (seenPath && t.includes(seenPath) && (renamed || intent))
          return t.map((x) => (x === seenPath ? activePath : x));
        const at = seenPath ? t.indexOf(seenPath) : -1;
        return at === -1 ? [...t, activePath] : [...t.slice(0, at + 1), activePath, ...t.slice(at + 1)];
      });
    }
  }
  const visibleTabs = tabs.filter((p) => p === activePath || vault.entries.some((e) => e.path === p));

  const closeTab = (path: string) => {
    const i = visibleTabs.indexOf(path);
    const rest = visibleTabs.filter((p) => p !== path);
    setTabs(rest);
    if (path === activePath) void vault.open(rest[Math.min(i, rest.length - 1)] ?? null);
  };

  const closeAllTabs = () => {
    setTabs([]);
    void vault.open(null);
  };

  const openDaily = async (date = new Date()) => {
    const { path, content, cursor } = dailyNote(vault, date);
    if (cursor !== null) pendingCursor.current = { path, fromEnd: content.length - cursor };
    await vault.createNoteWith(path, content);
  };

  // Quick capture: a dialog (or something shared to the app) adds an item to today's note or the inbox.
  const [capturing, setCapturing] = useState<{ initial?: { captured: Captured; files: File[] } } | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  useEffect(() => {
    if (!captured) return;
    const t = setTimeout(() => setCaptured(null), 6000);
    return () => clearTimeout(t);
  }, [captured]);
  useEffect(() => {
    openDailyRef.current = openDaily;
  });

  const jumpTo = useCallback(
    (offset: number) => {
      if (mode === "reading") {
        const index = extractHeadings(vault.activeText).findIndex((h) => h.offset === offset);
        readingRef.current
          ?.querySelectorAll(
            ".prose-note > h1, .prose-note > h2, .prose-note > h3, .prose-note > h4, .prose-note > h5, .prose-note > h6",
          )
          [index]?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (view) {
        view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
        view.focus();
      }
    },
    [mode, vault.activeText, view],
  );

  /**
   * Follows a link: opens the note it resolves to, or creates it, then scrolls
   * to `heading`. `how`: in this tab (default), a new tab, or the side pane.
   */
  const openLink = useCallback(
    async (target: string, heading?: string, how: OpenHow = "here") => {
      const from = vault.active?.path;
      const path = target ? vault.links.resolve(target, from) : (from ?? null);
      if (path) {
        if (how === "side" && path !== from) {
          setSidePath(path);
          return;
        }
        if (heading && isNote(path)) setPendingHeading(heading);
        if (path === from) return;
        if (how === "here") setNavIntent({ path, kind: "replace" });
        await vault.open(path);
        return;
      }
      // A note that doesn't exist yet: ask before creating it.
      if (target.trim()) setCreating(newNoteFromLink(target, from, vault.settings));
    },
    [vault],
  );

  /** Offers to create a missing note `target`, as linked from `from` (`hub`: a hub waiting to be written). */
  const offerCreate = useCallback(
    (target: string, from: string, hub = false) => setCreating({ ...newNoteFromLink(target, from, vault.settings), hub }),
    [vault.settings],
  );

  // Scroll to a linked heading ("Heading") or block ("^id") once its note is open.
  useEffect(() => {
    if (!pendingHeading || !vault.active) return;
    let offset: number | undefined;
    if (pendingHeading.startsWith("^")) {
      const m = new RegExp(
        `(^|\\n)[^\\n]*\\s\\^${pendingHeading.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*(?=\\n|$)`,
      ).exec(vault.activeText);
      if (m) offset = m.index + m[1].length;
    } else {
      const want = pendingHeading.toLowerCase();
      offset = extractHeadings(vault.activeText).find((x) => x.text.toLowerCase() === want)?.offset;
    }
    // Wait a frame so the editor or reading view has the new note.
    const id = requestAnimationFrame(() => {
      if (offset !== undefined) {
        if (mode === "reading" && pendingHeading.startsWith("^")) {
          // Blocks have no element of their own in reading view; switch to the editor position instead.
          view?.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
        } else jumpTo(offset);
      }
      setPendingHeading(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pendingHeading, vault.active, vault.activeText, jumpTo, mode, view]);

  /** Back or Forward to the previous or next visited note, at the scroll position you left it. */
  const navigate = (dir: "back" | "forward") => {
    const step = (dir === "back" ? goBack : goForward)(nav, activePath ?? null, (p) => vault.exists(p));
    if (!step) return;
    setNav(step.history);
    setNavIntent({ path: step.path, kind: "history" });
    setPendingScroll({ path: step.path, top: scrollPositions.current.get(step.path) ?? 0 });
    void vault.open(step.path);
  };
  useEffect(() => {
    navigateRef.current = navigate;
  });

  /** The element that scrolls the open note: the editor's scroller, or the page area. */
  const scroller = useCallback((): HTMLElement | null => {
    const cm = view?.scrollDOM;
    if (mode !== "reading" && cm && cm.isConnected && cm.scrollHeight > cm.clientHeight) return cm;
    return readingRef.current;
  }, [mode, view]);

  // After Back/Forward, restore the scroll position once the note has rendered.
  useEffect(() => {
    if (!pendingScroll || pendingScroll.path !== activePath) return;
    let tries = 0;
    let id: ReturnType<typeof setTimeout>;
    const apply = () => {
      const el = scroller();
      if (el && (el.scrollHeight - el.clientHeight >= pendingScroll.top || tries >= 20)) {
        el.scrollTop = pendingScroll.top;
        setPendingScroll(null);
      } else {
        tries++;
        id = setTimeout(apply, 50);
      }
    };
    // Wait for the editor to finish loading the note (it scrolls new notes to the top).
    id = setTimeout(apply, 50);
    return () => clearTimeout(id);
  }, [pendingScroll, activePath, scroller]);

  // App shortcuts (from the installed app's icon) open "/?action=…". Run the action
  // once the vault is ready, then tidy the URL. A window that's already open gets
  // later shortcuts through the launch queue instead of a reload.
  const runActionRef = useRef<(action: string) => void>(() => {});
  useEffect(() => {
    runActionRef.current = (action) => {
      if (action === "new-note") void vault.createNote();
      else if (action === "new-canvas") void vault.createCanvas();
      else if (action === "daily") void openDaily();
      else if (action === "capture") setCapturing({});
      else if (action === "shared") {
        // Shared to the installed app: the service worker kept it for us.
        void takeShared().then((sh) => {
          if (!sh) return;
          setCapturing({ initial: { captured: fromShare(sh), files: sh.files } });
        });
      }
      else if (action === "search") {
        setTab("search");
        setLeftCollapsed(false);
        setSidebarOpen(true);
      }
    };
  });
  useEffect(() => {
    if (!vault.ready) return;
    const url = new URL(window.location.href);
    const action = url.searchParams.get("action");
    if (action) {
      url.searchParams.delete("action");
      window.history.replaceState(null, "", url);
      runActionRef.current(action);
    }
    const queue = (window as Window & { launchQueue?: { setConsumer(f: (p: { targetURL?: string }) => void): void } })
      .launchQueue;
    queue?.setConsumer((params) => {
      const target = params.targetURL ? new URL(params.targetURL) : null;
      // A share delivered to an open window: the service worker has kept it.
      const a = target ? (target.searchParams.get("action") ?? (target.pathname === "/share-target" ? "shared" : null)) : null;
      if (a) runActionRef.current(a);
    });
  }, [vault.ready]);

  const showTag = useCallback((tag: string) => {
    setSearchQuery(`tag:${tag}`);
    setTab("search");
    setSidebarOpen(true);
  }, []);


  /** Opens "Ask" on the editor's selection. */
  const askSelection = () => {
    const path = vault.active?.path;
    if (!view || !path) return;
    const { from, to } = view.state.selection.main;
    const text = view.state.sliceDoc(from, to);
    if (!text.trim()) return;
    setAsking({ path, from, to, text });
  };
  const askRef = useRef(askSelection);
  useEffect(() => {
    askRef.current = askSelection;
  });
  // AI for the "/" menu, kept current below (once actions are set up).
  const aiRef = useRef<{
    ready: boolean;
    ask(passage: { from: number; to: number; text: string }, question?: string): void;
    run(kind: "summarise" | "suggest-links" | "suggest-properties" | "daily-review"): void;
  }>({ ready: false, ask() {}, run() {} });
  /** Replaces a passage (if it's still there) with `insert`. */
  const replacePassage = (src: AskSource, insert: string) => {
    if (!view || vault.active?.path !== src.path || view.state.sliceDoc(src.from, src.to) !== src.text) return;
    view.dispatch({ changes: { from: src.from, to: src.to, insert }, userEvent: "input" });
  };
  /** Adds text after the paragraph holding a passage. */
  const insertAfterPassage = (src: AskSource, text: string) => {
    if (!view || vault.active?.path !== src.path) return;
    const doc = view.state.doc;
    let line = doc.lineAt(Math.min(src.to, doc.length));
    while (line.number < doc.lines && doc.line(line.number + 1).text.trim()) line = doc.line(line.number + 1);
    view.dispatch({ changes: { from: line.to, insert: `\n\n${text}` }, userEvent: "input" });
  };

  /**
   * Links the editor's selection to `path`, in the vault's link format:
   * "[[Note|selection]]", or "[[Note]]" if nothing (or the link text) is selected.
   */
  const linkSelectionTo = (path: string) => {
    if (!view) return;
    const target = vault.links.linkText(path);
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to).trim();
    const alias = !selected || selected === target ? undefined : selected;
    const insert = formatLink(vault.settings.linkFormat, activePathNow ?? "", { path, target, alias }, target);
    view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input" });
    view.focus();
  };



  const onLinkSelection = useCallback(() => setLinkPickerOpen(true), []);
  const onInsertTemplate = useCallback(() => setTemplatePicker("insert"), []);
  const { inbound, propertyInfo, linkHost, linkContext, drawingVault, canvasVault } = useEditorHosts({ openLink, recent, onLinkSelection, onInsertTemplate, askRef, aiRef });

  const activePathNow = vault.active?.path ?? null;
  const kind = !activePathNow
    ? null
    : isNote(activePathNow)
      ? "note"
      : isDrawing(activePathNow)
        ? "drawing"
        : isCanvas(activePathNow)
          ? "canvas"
          : "file";
  const editing = kind === "note" && mode !== "reading" && !!view;

  const templates = useTemplatePaths();

  /** Puts a filled template into the open note at the cursor. */
  const insertRendered = (r: Rendered) => {
    if (!view) return;
    const doc = view.state.doc.toString();
    const out = insertIntoNote(doc, view.state.selection.main.head, r);
    view.dispatch({ changes: { from: 0, to: doc.length, insert: out.text }, selection: { anchor: out.cursor } });
    view.focus();
  };
  /** Starts a note from a template, or inserts one; asks for its prompts first if it has any. */
  const applyTemplate = (path: string, mode: "new" | "insert") => {
    if (mode === "insert" && !editing) return;
    if (needsDialog(vault, path, mode)) setUsingTemplate({ path, mode });
    else
      insertRendered(
        renderTemplate(vault.links.content(path) ?? "", {
          title: noteTitle(activePathNow ?? ""),
          now: new Date(),
          folder: dirname(activePathNow ?? ""),
          inputs: {},
        }),
      );
  };
  // Once a note made from a template is open in the editor, put the cursor where the template says.
  useEffect(() => {
    const p = pendingCursor.current;
    if (!p || !view || activePathNow !== p.path || kind !== "note") return;
    pendingCursor.current = null;
    view.dispatch({ selection: { anchor: Math.max(0, view.state.doc.length - p.fromEnd) }, scrollIntoView: true });
    view.focus();
  });

  /** Opens a note with the cursor at `offset` (a task, say). */
  const openAt = (path: string, offset: number) => {
    if (path === vault.active?.path && view) {
      view.dispatch({ selection: { anchor: Math.min(offset, view.state.doc.length) }, scrollIntoView: true });
      view.focus();
      return;
    }
    const content = vault.links.content(path) ?? "";
    pendingCursor.current = { path, fromEnd: Math.max(0, content.length - offset) };
    void vault.open(path);
  };

  /** Ticks or clears a task in its note: in the editor when the note is open, so the cursor stays put. */
  const toggleTaskIn = async (task: Task, done: boolean): Promise<boolean> => {
    const next = toggleTask(vault.textOf(task.path) ?? "", task, done);
    if (next === null) return false;
    const line = next.split("\n")[task.line];
    if (task.path === vault.active?.path && view) {
      if (task.line >= view.state.doc.lines) return false;
      const l = view.state.doc.line(task.line + 1);
      if (l.text !== task.raw) return false;
      view.dispatch({ changes: { from: l.from, to: l.to, insert: line }, userEvent: "input.toggle" });
    } else {
      await vault.writeNote(task.path, next);
    }
    return true;
  };



  const sidebar = (
    <>
      {/* The header row: the same height as the note's and the panel's, so they line up. */}
      <div className="mb-1 flex h-12 shrink-0 items-center gap-1">
        <div className="min-w-0 flex-1">
          <VaultSwitcher onManage={() => setSettingsOpen("vaults")} />
        </div>
        <button
          type="button"
          className="icon-button hidden md:inline-flex"
          aria-label="Collapse sidebar"
          title="Collapse sidebar (Ctrl/Cmd+\)"
          onClick={() => setLeftCollapsed(true)}
        >
          <PanelLeftClose size={17} aria-hidden />
        </button>
      </div>
      <div className="mb-3 flex items-center gap-1 px-0.5">
      <div role="tablist" aria-label="Sidebar" className="segmented min-w-0 flex-1">
        {(
          [
            ["files", "Files", Files],
            ["search", "Search", Search],
            ["tasks", "Tasks", ListChecks],
            ["tags", "Tags", Tags],
            ["templates", "Templates", LayoutTemplate],
            ["properties", "Properties", SlidersHorizontal],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            title={label}
            onClick={() => setTab(id)}
          >
            <Icon size={15} aria-hidden />
            {/* Six tabs don't fit with names: icons, named in their tooltips and for screen readers. */}
            <span className="sr-only">{label}</span>
          </button>
        ))}
      </div>
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
          <div className="flex h-full flex-col">
            <PinnedHubs onCreate={(target, from) => offerCreate(target, from, true)} />
            <div className="min-h-0 flex-1">
              <FileTree />
            </div>
          </div>
        ) : tab === "search" ? (
          <SearchPanel
            query={searchQuery}
            onQuery={setSearchQuery}
            autoFocus
            onEditProperties={setPropertyTable}
            onOpenAt={openAt}
            onSearchSettings={() => setSettingsOpen("search")}
          />
        ) : tab === "tasks" ? (
          <TasksPanel onOpen={openAt} onToggle={toggleTaskIn} />
        ) : tab === "tags" ? (
          <TagsPanel onTag={showTag} />
        ) : tab === "properties" ? (
          <PropertiesPanel
            onSearch={(q) => {
              setSearchQuery(q);
              setTab("search");
            }}
            onRename={(from, to) => renamePropertyEverywhere(vault, from, to)}
            onDelete={(key) => deletePropertyEverywhere(vault, key)}
            onTable={(key) => setPropertyTable(filesWithProperties(vault.links, [{ key }]))}
          />
        ) : (
          <TemplatesPanel onUse={applyTemplate} canInsert={editing} />
        )}
      </div>
      <div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2">
        <button
          type="button"
          className="nav-item text-foreground/80"
          onClick={() => void openDaily()}
          title="Today's daily note (Ctrl/Cmd+Shift+D)"
        >
          <CalendarDays size={15} aria-hidden />
          Today
        </button>
        <button
          type="button"
          className="nav-item text-foreground/80"
          onClick={() => setCapturing({})}
          title="Add a quick note to today's note or your inbox"
        >
          <Zap size={15} aria-hidden />
          Quick capture
        </button>
        <button
          type="button"
          className="nav-item text-foreground/80"
          onClick={() => setHealthOpen(true)}
          title="Broken links, orphans, dead ends and hubs"
        >
          <Activity size={15} aria-hidden />
          Repository health
        </button>
      </div>
      <div>
        <button
          type="button"
          className="nav-item w-full text-foreground/80"
          onClick={() => setSettingsOpen("appearance")}
        >
          <Settings size={15} aria-hidden />
          Settings
        </button>
      </div>
    </>
  );

  /** Opens the left sidebar on a tab, from the rail. */
  const openSidebarTab = (t: SidebarTab) => {
    setTab(t);
    setLeftCollapsed(false);
  };
  const leftRail = (
    <>
      <RailButton label="Expand sidebar" onClick={() => setLeftCollapsed(false)}>
        <PanelLeftOpen size={18} aria-hidden />
      </RailButton>
      <RailButton label="New note" onClick={() => void vault.createNote()}>
        <FilePlus size={18} aria-hidden />
      </RailButton>
      <span className="my-1 h-px w-6 bg-border" aria-hidden />
      <RailButton label="Files" onClick={() => openSidebarTab("files")}>
        <Files size={18} aria-hidden />
      </RailButton>
      <RailButton label="Search" onClick={() => openSidebarTab("search")}>
        <Search size={18} aria-hidden />
      </RailButton>
      <RailButton label="Tasks" onClick={() => openSidebarTab("tasks")}>
        <ListChecks size={18} aria-hidden />
      </RailButton>
      <RailButton label="Tags" onClick={() => openSidebarTab("tags")}>
        <Tags size={18} aria-hidden />
      </RailButton>
      <RailButton label="Templates" onClick={() => openSidebarTab("templates")}>
        <LayoutTemplate size={18} aria-hidden />
      </RailButton>
      <span className="my-1 h-px w-6 bg-border" aria-hidden />
      <RailButton label="Today" onClick={() => void openDaily()}>
        <CalendarDays size={18} aria-hidden />
      </RailButton>
      <RailButton label="Repository health" onClick={() => setHealthOpen(true)}>
        <Activity size={18} aria-hidden />
      </RailButton>
      <div className="mt-auto">
        <RailButton label="Settings" onClick={() => setSettingsOpen("appearance")}>
          <Settings size={18} aria-hidden />
        </RailButton>
      </div>
    </>
  );
  /** Opens the right panel on a tab, from its rail. */
  const openPanelTab = (t: PanelTab) => {
    setPanelTab(t);
    setRightCollapsed(false);
  };
  const showChat = useCallback(() => {
    setPanelTabState("chat");
    writePref("panelTab", "chat");
    setRightCollapsed(false);
  }, [setRightCollapsed]);
  const runAction = useRunAction(showChat);
  const aiSetup = useAiSetup();
  useEffect(() => {
    aiRef.current = {
      ready: aiSetup === null,
      ask: (passage, question) => {
        const path = vault.active?.path;
        if (path) setAsking({ path, ...passage, ...(question ? { question } : {}) });
      },
      run: (kind) => {
        const path = vault.active?.path;
        if (kind === "daily-review") runAction({ kind });
        else if (path && isNote(path)) runAction({ kind, path });
      },
    };
  });
  usePairFromLink(() => setSettingsOpen("ai"));
  const currentHealth = () => {
    const mtimes = new Map(vault.entries.map((e) => [e.path, e.mtime]));
    return vaultHealth(vault.links, { mtime: (p) => mtimes.get(p), ignore: healthIgnored(vault.settings) });
  };
  const rightRail = (
    <>
      <RailButton label="Expand panel" onClick={() => setRightCollapsed(false)}>
        <PanelRightOpen size={18} aria-hidden />
      </RailButton>
      <span className="my-1 h-px w-6 bg-border" aria-hidden />
      <RailButton label="Connections" onClick={() => openPanelTab("links")}>
        <Link2 size={18} aria-hidden />
      </RailButton>
      <RailButton label="Outline" onClick={() => openPanelTab("outline")}>
        <ListTree size={18} aria-hidden />
      </RailButton>
      <RailButton label="Chat" onClick={() => openPanelTab("chat")}>
        <Sparkles size={18} aria-hidden />
      </RailButton>
    </>
  );



  /** Rewrites every link in the open note in one format (one undoable edit in the editor). */
  const convertActiveLinks = (to: "markdown" | "wikilink") => {
    if (!activePathNow) return;
    const from = activePathNow;
    const text = view && mode !== "reading" ? view.state.doc.toString() : vault.activeText;
    const next = convertLinks(text, from, to, (t) => vault.links.resolve(t, from), (p) => vault.links.linkText(p));
    if (next === text) return;
    if (view && mode !== "reading") view.dispatch({ changes: { from: 0, to: text.length, insert: next }, userEvent: "input" });
    else void vault.writeNote(from, next);
  };

  /** Sets or removes a property of the open note (one undoable edit in the editor). */
  const setActiveProperty = (key: string, value: string | boolean | undefined) => {
    if (!activePathNow) return;
    const text = view && mode !== "reading" ? view.state.doc.toString() : vault.activeText;
    const next = setFrontmatterProperty(text, key, value);
    if (next === text) return;
    if (view && mode !== "reading") view.dispatch({ changes: { from: 0, to: text.length, insert: next }, userEvent: "input" });
    else void vault.writeNote(activePathNow, next);
  };
  const activeIsMarkedHub =
    !!activePathNow && hubProperty(vault.links.get(activePathNow)?.properties) === true;

  /** Command palette entries (data only) and what each does. */
  const commands: Array<PickerItem & { when?: boolean }> = [
    { id: "new-note", label: "New note", hint: "Ctrl/Cmd+Alt+N" },
    { id: "new-drawing", label: "New drawing" },
    { id: "new-canvas", label: "New canvas" },
    { id: "daily", label: "Open today's daily note", hint: "Ctrl/Cmd+Shift+D" },
    {
      id: "daily-yesterday",
      label: "Open yesterday's daily note",
    },
    { id: "template", label: "Insert template…", when: editing },
    { id: "templateNote", label: "New note from template…" },
    { id: "property-add", label: "Add a property", when: editing },
    { id: "table-format", label: "Format table", hint: "Ctrl/Cmd+Alt+T", when: editing },
    { id: "table-from-lines", label: "Convert selected lines (CSV) to a table", when: editing },
    { id: "table-to-lines", label: "Convert table to CSV lines", when: editing },
    { id: "link-selection", label: "Link selection to a note…", hint: "Ctrl/Cmd+Shift+K", when: editing },
    { id: "ask-selection", label: "Ask AI about the selection…", hint: "Ctrl/Cmd+Shift+Enter", when: editing },
    { id: "ai-summarise", label: "AI: Summarise this note", when: kind === "note" },
    { id: "ai-links", label: "AI: Suggest links for this note", when: kind === "note" },
    { id: "ai-properties", label: "AI: Suggest tags and properties for this note", when: kind === "note" },
    { id: "ai-week", label: "AI: What did I work on this week?" },
    { id: "ai-orphans", label: "AI: Find homes for orphan notes" },
    { id: "ai-stale", label: "AI: Review stale hubs" },
    { id: "links-to-markdown", label: "Convert links in this note to markdown links", when: kind === "note" },
    { id: "links-to-wikilinks", label: "Convert links in this note to wikilinks", when: kind === "note" },
    { id: "switcher", label: "Open a note…", hint: "Ctrl/Cmd+O" },
    {
      id: "search",
      label: "Search all notes",
      hint: "Ctrl/Cmd+Shift+F",
    },
    { id: "health", label: "Open repository health" },
    { id: "tasks", label: "Show tasks" },
    { id: "capture", label: "Quick capture…" },
    { id: "insert-query", label: "Insert a live query", when: editing },
    { id: "map-canvas", label: "Map this note as a canvas", when: kind === "note" },
    {
      id: "hub-toggle",
      label: activeIsMarkedHub ? "Unpin this hub from the sidebar" : "Pin this note to the sidebar as a hub",
      when: kind === "note",
    },
    { id: "mode-live", label: "Live preview", when: kind === "note" },
    { id: "mode-source", label: "Source mode", when: kind === "note" },
    { id: "mode-reading", label: "Reading view", hint: "Ctrl/Cmd+E", when: kind === "note" },
    {
      id: "side",
      label: "Open this note in the side pane",
      when: !!activePathNow,
    },
    { id: "side-close", label: "Close the side pane", when: !!sidePath },
    { id: "toggle-left", label: leftCollapsed ? "Expand the left sidebar" : "Collapse the left sidebar", hint: "Ctrl/Cmd+\\" },
    {
      id: "toggle-right",
      label: rightCollapsed ? "Expand the right panel" : "Collapse the right panel",
      hint: "Ctrl/Cmd+Shift+\\",
    },
    { id: "tab-close", label: "Close this tab", when: !!activePathNow },
    { id: "tab-close-all", label: "Close all tabs", when: visibleTabs.length > 0 },
    {
      id: "delete",
      label: "Delete this file",
      when: !!activePathNow,
    },
    { id: "sync", label: "Sync now", when: sync.status.kind !== "local" },
    { id: "conflicts", label: `Review conflicts (${sync.conflicts.length})`, when: sync.conflicts.length > 0 },
    {
      id: "history",
      label: "Show version history of this file",
      when: !!sync.history && !!activePathNow,
    },
    { id: "export", label: "Export repository as zip" },
    { id: "import", label: "Import notes from a zip…" },
    { id: "settings", label: "Open settings" },
    { id: "storage", label: "Show storage used on this device" },
    { id: "install", label: "Install Cognotive.ai as an app" },
  ];
  const runCommand: Record<string, () => void> = {
    "new-note": () => void vault.createNote(),
    "new-drawing": () => void vault.createDrawing(),
    "new-canvas": () => void vault.createCanvas(),
    daily: () => void openDaily(),
    "daily-yesterday": () => void openDaily(new Date(Date.now() - 86_400_000)),
    template: () => setTemplatePicker("insert"),
    templateNote: () => setTemplatePicker("new"),
    "property-add": () => {
      if (!view) return;
      addProperty(view);
      view.focus();
    },
    "table-format": () => view && editTableSource(view, "format"),
    "table-from-lines": () => view && editTableSource(view, "from-lines"),
    "table-to-lines": () => view && editTableSource(view, "to-lines"),
    "link-selection": () => setLinkPickerOpen(true),
    "ask-selection": () => askSelection(),
    "links-to-markdown": () => convertActiveLinks("markdown"),
    "links-to-wikilinks": () => convertActiveLinks("wikilink"),
    switcher: () => setSwitcherOpen(true),
    search: () => {
      setTab("search");
      setSidebarOpen(true);
    },
    health: () => setHealthOpen(true),
    tasks: () => openSidebarTab("tasks"),
    capture: () => setCapturing({}),
    "insert-query": () => {
      if (!view) return;
      const { from } = view.state.selection.main;
      placeBlock(view, from, from, QUERY_BLOCK, "```query\n".length);
      // Select the example tag, ready to type over.
      const at = view.state.selection.main.head;
      view.dispatch({ selection: { anchor: at, head: at + 4 } });
      view.focus();
    },
    "ai-summarise": () => activePathNow && runAction({ kind: "summarise", path: activePathNow }),
    "ai-links": () => activePathNow && runAction({ kind: "suggest-links", path: activePathNow }),
    "ai-properties": () => activePathNow && runAction({ kind: "suggest-properties", path: activePathNow }),
    "ai-week": () => runAction({ kind: "daily-review" }),
    "ai-orphans": () => runAction({ kind: "fix-orphans", paths: currentHealth().orphans }),
    "ai-stale": () => runAction({ kind: "review-stale", paths: currentHealth().stale.map((h) => h.path) }),
    "map-canvas": () => activePathNow && void mapAsCanvas(vault, activePathNow),
    "hub-toggle": () => setActiveProperty("hub", activeIsMarkedHub ? undefined : true),
    "mode-live": () => setMode("live"),
    "mode-source": () => setMode("source"),
    "mode-reading": () => setMode("reading"),
    side: () => activePathNow && setSidePath(activePathNow),
    "side-close": () => setSidePath(null),
    "toggle-left": () => setLeftCollapsed(!leftCollapsed),
    "toggle-right": () => setRightCollapsed(!rightCollapsed),
    "tab-close": () => activePathNow && closeTab(activePathNow),
    "tab-close-all": closeAllTabs,
    delete: () => activePathNow && setDeleting(activePathNow),
    sync: sync.syncNow,
    conflicts: () => {
      const c = sync.conflicts.find((x) => x.path === activePathNow) ?? sync.conflicts[0];
      if (!c) return;
      if (vault.exists(c.path) && c.path !== activePathNow) void vault.open(c.path);
      setReviewing(c);
    },
    history: () => setHistoryOpen(true),
    export: () => void exportZip(vault, vaults.active.name),
    import: chooseZip,
    settings: () => setSettingsOpen("appearance"),
    storage: () => setSettingsOpen("storage"),
    install: () => setSettingsOpen("app"),
  };

  return (
    <AiActionsContext.Provider value={runAction}>
      <SidePaneContext.Provider value={setSidePath}>
        <AppShell
          sidebar={sidebar}
          sidebarOpen={sidebarOpen}
          onCloseSidebar={() => setSidebarOpen(false)}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          leftRail={leftRail}
          rightRail={rightRail}
          panel={
            vault.active ? (
              <>
                <div className="sticky top-0 z-10 -mx-4 mb-3 flex h-12 items-center gap-1 bg-background px-4">
                <div role="tablist" aria-label="Note panels" className="segmented flex flex-1">
                  {(
                    [
                      ["links", "Connections"],
                      ["outline", "Outline"],
                      ["chat", "Chat"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={panelTab === id}
                      onClick={() => setPanelTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Collapse panel"
                    title="Collapse panel (Ctrl/Cmd+Shift+\)"
                    onClick={() => setRightCollapsed(true)}
                  >
                    <PanelRightClose size={17} aria-hidden />
                  </button>
                </div>
                {panelTab === "outline" ? (
                  <Outline markdown={vault.activeText} onJump={jumpTo} />
                ) : panelTab === "links" ? (
                  <LinksPanel onOpenLink={(t) => void openLink(t)} onMapCanvas={kind === "note" && activePathNow ? () => void mapAsCanvas(vault, activePathNow) : undefined} />
                ) : (
                  <ChatPanel links={linkContext} onOpenLink={(t) => void openLink(t)} onOpenSettings={() => setSettingsOpen("ai")} />
                )}
              </>
            ) : null
          }
        >
          <header className="flex h-12 shrink-0 items-center gap-2 px-3">
            <button
              type="button"
              className="icon-button md:hidden"
              aria-label="Open sidebar"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeft size={18} aria-hidden />
            </button>
            <div className="flex items-center">
              <button
                type="button"
                className="icon-button"
                aria-label="Back"
                title="Back (Ctrl/Cmd+Alt+←)"
                disabled={!nav.back.some((p) => p !== activePath && vault.exists(p))}
                onClick={() => navigate("back")}
              >
                <ArrowLeft size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Forward"
                title="Forward (Ctrl/Cmd+Alt+→)"
                disabled={!nav.forward.some((p) => p !== activePath && vault.exists(p))}
                onClick={() => navigate("forward")}
              >
                <ArrowRight size={16} aria-hidden />
              </button>
            </div>
            {vault.active ? (
              <TitleInput key={vault.active.path} path={vault.active.path} />
            ) : (
              <span className="flex-1" />
            )}
            <SaveIndicator />
            <SyncButton />
            {sync.history && vault.active && (
              <button
                type="button"
                className="icon-button"
                aria-label="Version history"
                title="Version history"
                onClick={() => setHistoryOpen(true)}
              >
                <History size={16} aria-hidden />
              </button>
            )}
            {kind === "note" && (
              <div role="radiogroup" aria-label="View mode" className="segmented">
                {MODES.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={mode === id}
                    aria-label={label}
                    title={id === "reading" ? `${label} (Ctrl/Cmd+E)` : label}
                    onClick={() => setMode(id)}
                  >
                    <Icon size={15} aria-hidden />
                  </button>
                ))}
              </div>
            )}
          </header>
          <TabBar tabs={visibleTabs} active={activePathNow} onSelect={(p) => void vault.open(p)} onClose={closeTab} onCloseAll={closeAllTabs} />
          {kind === "note" && mode !== "reading" && (
            <div className="border-b border-border px-3 py-1">
              <Toolbar view={view} />
            </div>
          )}
          {activePathNow && <ConflictBanner path={activePathNow} onReview={setReviewing} />}
          <BackupBanner onExport={() => exportZip(vault, vaults.active.name)} onConnect={() => setSettingsOpen("vaults")} />
          <div className="flex min-h-0 flex-1">
            <div
              className={`min-h-0 min-w-0 flex-1 ${kind === "drawing" || kind === "canvas" ? "overflow-hidden" : "overflow-y-auto"}`}
              ref={readingRef}
              onScrollCapture={(e) => {
                const el = e.target as HTMLElement;
                if (activePathNow && (el === readingRef.current || el.classList.contains("cm-scroller"))) {
                  scrollPositions.current.set(activePathNow, el.scrollTop);
                }
              }}
            >
              <ErrorBoundary name={kind === "canvas" ? "The canvas" : kind === "drawing" ? "The drawing" : kind === "file" ? "This file's view" : mode === "reading" ? "Reading view" : "The editor"} resetKey={`${vault.active?.path}:${mode}:${canvasAsText}`}>
              {!vault.ready ? (
                <p className="p-8 text-muted">Loading repository…</p>
              ) : !vault.active ? (
                <EmptyState onCreate={() => void vault.createNote()} onFind={() => setSwitcherOpen(true)} />
              ) : kind === "canvas" && canvasAsText === vault.active.path ? (
                <div className="flex h-full flex-col">
                  <div className="flex items-center gap-3 border-b border-border px-6 py-2 text-sm text-muted">
                    <span className="flex-1">Editing the canvas file as text (JSON Canvas).</span>
                    <button type="button" className="button-secondary px-2.5 py-1 text-xs" onClick={() => setCanvasAsText(null)}>
                      Show as canvas
                    </button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <MarkdownEditor
                      docKey={`${vault.active.path}:text:${vault.active.version}`}
                      initial={vault.activeText}
                      livePreview={false}
                      onChange={vault.edit}
                      autoFocus
                    />
                  </div>
                </div>
              ) : kind === "canvas" ? (
                <CanvasView
                  key={`${vault.active.path}:${vault.active.version}`}
                  onEditAsText={() => setCanvasAsText(vault.active?.path ?? null)}
                  propertyInfo={propertyInfo()}
                  docKey={`${vault.active.path}:${vault.active.version}`}
                  initial={vault.activeText}
                  onChange={vault.edit}
                  onOpenLink={(t, h, how) => void openLink(t, h, how)}
                  onOpenFile={(p, how) => (how === "side" ? setSidePath(p) : void vault.open(p))}
                  vault={canvasVault}
                />
              ) : kind === "drawing" ? (
                <DrawingView
                  docKey={`${vault.active.version}`}
                  initial={drawingJson(vault.active.path, vault.active.initial)}
                  onChange={(json) =>
                    // Obsidian plugin drawings keep their markdown wrapper; only the scene changes.
                    // Plain drawings keep their properties, which Excalidraw doesn't know about.
                    vault.edit(
                      isObsidianDrawing(activePathNow!)
                        ? replaceScene(vault.activeText, json)
                        : keepDrawingProperties(activePathNow!, json, vault.activeText),
                    )
                  }
                  properties={{
                    properties: drawingProperties(vault.active.path, vault.activeText),
                    info: propertyInfo(),
                    // Saved like any edit, without reloading the drawing.
                    onSet: (key, value) => vault.edit(setDrawingProperty(vault.active!.path, vault.activeText, key, value)),
                  }}
                  onOpenLink={(t, h) => void openLink(t, h)}
                  vault={drawingVault}
                />
              ) : kind === "file" ? (
                <FileView path={vault.active.path} />
              ) : mode === "reading" ? (
                <ReadingView
                  markdown={vault.activeText}
                  links={linkContext}
                  properties={vault.links.get(vault.active.path)?.properties}
                  editProperties={{
                    info: propertyInfo(),
                    onSet: (key, value) => {
                      const path = vault.active?.path;
                      if (!path) return;
                      const next = setFrontmatterProperty(vault.activeText, key, value === undefined ? undefined : yamlValue(value));
                      if (next !== vault.activeText) void vault.writeNote(path, next);
                    },
                  }}
                  onOpenLink={(t, h, how) => void openLink(t, h, how)}
                  onTag={showTag}
                  fileUrl={(p) => vault.fileUrl(p, { dark: prefersDark() })}
                  onOpenFile={(p) => void vault.open(p)}
                />
              ) : (
                <MarkdownEditor
                  docKey={`${vault.active.version}`}
                  // The current text, not the text when the note was opened: the editor is
                  // rebuilt when you come back from reading view, and must keep your edits.
                  initial={vault.activeText}
                  livePreview={mode === "live"}
                  onChange={vault.edit}
                  onView={setView}
                  links={linkHost}
                  // On touch devices, focusing would pop up the keyboard on every note open.
                  autoFocus={!window.matchMedia("(pointer: coarse)").matches}
                />
              )}
              </ErrorBoundary>
            </div>
            {sidePath && vault.entries.some((e) => e.path === sidePath) && (
              <ErrorBoundary name="The side pane" resetKey={sidePath} onClose={() => setSidePath(null)}>
              <SidePane
                path={sidePath}
                onNavigate={setSidePath}
                onClose={() => setSidePath(null)}
                onOpenHere={(p) => {
                  setSidePath(null);
                  void vault.open(p);
                }}
              />
              </ErrorBoundary>
            )}
          </div>
        </AppShell>
      </SidePaneContext.Provider>
      {switcherOpen && (
        <ErrorBoundary name="Quick switcher" onClose={() => setSwitcherOpen(false)}>
          <QuickSwitcher onClose={() => setSwitcherOpen(false)} onOpenSide={setSidePath} />
        </ErrorBoundary>
      )}
      {paletteOpen && (
        <Picker
          title="Command palette"
          placeholder="Type a command…"
          items={commands.filter((c) => c.when !== false)}
          onPick={(item) => runCommand[item.id]?.()}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {historyOpen && activePathNow && (
        <ErrorBoundary name="Version history" onClose={() => setHistoryOpen(false)}>
          <HistoryDialog path={activePathNow} onClose={() => setHistoryOpen(false)} />
        </ErrorBoundary>
      )}
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        aria-label="Choose a zip to import"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importZip(vault, f).then(setImportNote);
        }}
      />
      {importNote && (
        <div
          role="status"
          className="menu-panel fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 px-4 py-3 text-sm"
        >
          {importNote}
          <button
            type="button"
            className="icon-button h-6 w-6"
            aria-label="Dismiss"
            onClick={() => setImportNote(null)}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
      {templatePicker && (
        <Picker
          title={templatePicker === "new" ? "New note from template" : "Insert template"}
          placeholder="Choose a template…"
          items={templates.map((p) => ({ id: p, label: noteTitle(p), hint: dirname(p) }))}
          empty={`No templates yet. Open the Templates tab in the sidebar to add some.`}
          onPick={(item) => applyTemplate(item.id, templatePicker)}
          onClose={() => setTemplatePicker(null)}
        />
      )}
      {usingTemplate && (
        <UseTemplateDialog
          path={usingTemplate.path}
          mode={usingTemplate.mode}
          defaultFolder={newNoteFromLink("x", activePathNow, vault.settings).folder}
          onInsert={insertRendered}
          onCreating={(path, fromEnd) => {
            pendingCursor.current = { path, fromEnd };
          }}
          onClose={() => setUsingTemplate(null)}
        />
      )}
      {linkPickerOpen && (
        <Picker
          title="Link selection to"
          placeholder="Link to which note?"
          items={vault.links
            .paths()
            .filter((p) => p !== activePathNow)
            .sort((a, b) => (inbound.get(b) ?? 0) - (inbound.get(a) ?? 0) || a.localeCompare(b))
            .map((p) => ({ id: p, label: isNote(p) || isDrawing(p) || isCanvas(p) ? displayName(p) : basename(p), hint: dirname(p) }))}
          onPick={(item) => linkSelectionTo(item.id)}
          onClose={() => {
            setLinkPickerOpen(false);
            view?.focus();
          }}
        />
      )}
      {capturing && (
        <CaptureDialog
          initial={capturing.initial}
          destination={captureTarget(vault).label}
          onSave={async (c, files) => setCaptured(await saveCapture(vault, c, files))}
          onClose={() => setCapturing(null)}
        />
      )}
      {captured && (
        <div role="status" className="menu-panel fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 px-4 py-2.5 text-sm">
          <span>Captured to {noteTitle(captured)}.</span>
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => {
              void vault.open(captured);
              setCaptured(null);
            }}
          >
            Open
          </button>
        </div>
      )}
      {asking && (
        <AskDialog
          source={asking}
          links={linkContext}
          onClose={() => {
            setAsking(null);
            view?.focus();
          }}
          onLinkSelection={replacePassage}
          onInsert={insertAfterPassage}
          onOpenSettings={() => {
            setAsking(null);
            setSettingsOpen("ai");
          }}
        />
      )}
      {creating && (
        <ErrorBoundary name="Creating a note" onClose={() => setCreating(null)}>
          <CreateNoteDialog {...creating} onClose={() => setCreating(null)} />
        </ErrorBoundary>
      )}
      {deleting && (
        <ErrorBoundary name="Deleting" onClose={() => setDeleting(null)}>
          <DeleteDialog path={deleting} isFolder={false} onClose={() => setDeleting(null)} />
        </ErrorBoundary>
      )}
      {settingsOpen && (
        <ErrorBoundary name="Settings" onClose={() => setSettingsOpen(false)}>
          <SettingsDialog initial={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </ErrorBoundary>
      )}
      {propertyTable && (
        <PropertyTable paths={propertyTable} onClose={() => setPropertyTable(null)} onOpen={(p) => void vault.open(p)} />
      )}
      {reviewing && (
        <ErrorBoundary name="Conflict review" onClose={() => setReviewing(null)}>
          <ConflictDialog record={reviewing} onClose={() => setReviewing(null)} />
        </ErrorBoundary>
      )}
      {healthOpen && (
        <ErrorBoundary name="Repository health" onClose={() => setHealthOpen(false)}>
          <HealthDialog onClose={() => setHealthOpen(false)} onCreate={offerCreate} />
        </ErrorBoundary>
      )}
      <Toasts />
    </AiActionsContext.Provider>
  );
}

const prefersDark = isDark;
