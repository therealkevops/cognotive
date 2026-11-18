"use client";

import type { EditorView } from "@codemirror/view";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CodeXml,
  Files,
  History,
  FilePlus,
  ListTree,
  Link2,
  Activity,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Search,
  Settings,
  Tags,
  LayoutTemplate,
  SlidersHorizontal,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { reloadOnChunkError } from "@/lib/chunk";
import type { ConflictRecord } from "@/lib/sync/conflicts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, RailButton } from "@/components/AppShell";
import { isDark, loadAppearance } from "@/lib/appearance";
import type { OpenHow } from "@/lib/links/open";
import { EMPTY_HISTORY, goBack, goForward, renameInHistory, visit, type NavHistory } from "@/lib/nav/history";
import { readPref, writePref } from "@/lib/prefs";
import { editTableSource } from "@/lib/editor/table-keys";
import { addProperty } from "@/lib/editor/properties-panel";
import { deletePropertyIn, renamePropertyIn } from "@/lib/vault/property-ops";
import type { LinkHost } from "@/lib/editor/wikilinks";
import { collectPropertyInfo, yamlValue, type PropertyInfo } from "@/lib/editor/properties";
import { drawingProperties, keepDrawingProperties, setDrawingProperty } from "@/lib/drawing/properties";
import type { LinkContext } from "@/lib/markdown/remark-links";
import { serializeCanvas } from "@/lib/canvas/format";
import { neighbourhoodCanvas, type Neighbour } from "@/lib/canvas/map";
import { convertLinks, formatLink, markdownLink } from "@/lib/links/format";
import { splitLinkText } from "@/lib/links/parse";
import { setFrontmatterProperty, splitFrontmatter } from "@/lib/markdown/frontmatter";
import { hubProperty } from "@/lib/links/health";
import { extractHeadings } from "@/lib/markdown/outline";
import { blockIdChange, listBlocks } from "@/lib/markdown/blocks";
import { previewMarkdown } from "@/lib/markdown/preview";
import { sectionUnder } from "@/lib/markdown/remark-links";
import {
  basename,
  dirname,
  extname,
  canvasName,
  displayName,
  isCanvas,
  isDrawing,
  isImage,
  isNote,
  joinPath,
  noteTitle,
} from "@/lib/vault/paths";
import { drawingJson, isObsidianDrawing, replaceScene } from "@/lib/drawing/obsidian";
import { drawingName } from "@/lib/vault/paths";
import type { CanvasVault } from "./CanvasView";
import type { DrawingVault } from "./DrawingView";
import { formatDate, newNoteFromLink } from "@/lib/vault/settings";
import { insertIntoNote, noteFromTemplate, renderTemplate, type Rendered } from "@/lib/templates/templates";
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
import { TagsPanel } from "./TagsPanel";
import { addStarterTemplates, needsDialog, TemplatesPanel, UseTemplateDialog, useTemplatePaths } from "./Templates";
import { Toolbar } from "./Toolbar";

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
type SidebarTab = "files" | "search" | "tags" | "templates" | "properties";
type PanelTab = "outline" | "links";

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
    readPref<string>("panelTab", "links") === "outline" ? "outline" : "links",
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

  /** Opens (or creates) the daily note for a date, from the vault's daily-note settings. */
  const openDaily = async (date = new Date()) => {
    const s = vault.settings;
    const name = formatDate(date, s.dailyFormat || "YYYY-MM-DD");
    const path = joinPath(s.dailyFolder, `${name}.md`);
    let content = "";
    let cursor: number | null = null;
    if (s.dailyTemplate && !vault.exists(path)) {
      const t = vault.links.resolve(s.dailyTemplate.replace(/\.md$/i, ""));
      if (t) {
        const note = noteFromTemplate(
          renderTemplate(vault.links.content(t) ?? "", { title: basename(name), now: date, folder: s.dailyFolder, inputs: {} }),
        );
        content = note.content;
        cursor = note.cursor;
      }
    }
    if (cursor !== null) pendingCursor.current = { path, fromEnd: content.length - cursor };
    await vault.createNoteWith(path, content);
  };
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
      const a = params.targetURL ? new URL(params.targetURL).searchParams.get("action") : null;
      if (a) runActionRef.current(a);
    });
  }, [vault.ready]);

  const showTag = useCallback((tag: string) => {
    setSearchQuery(`tag:${tag}`);
    setTab("search");
    setSidebarOpen(true);
  }, []);

  // How many notes link to each file, for ranking link suggestions.
  const inbound = useMemo(
    () => vault.links.inboundCounts(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
    [vault.links, vault.indexVersion],
  );

  // Property names, values and tags across the repository, worked out when first asked for.
  const propertyInfo = useMemo(() => {
    let info: PropertyInfo | null = null;
    return () => (info ??= collectPropertyInfo(vault.links, vault.settings.propertyTypes));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
  }, [vault.links, vault.indexVersion, vault.settings.propertyTypes]);

  // What the editor needs for [[links]].
  const linkHost = useMemo<LinkHost>(
    () => ({
      resolve: (t) => vault.links.resolve(t, vault.active?.path),
      open: (t, h, how) => void openLink(t, h, how),
      clickFollows: () => loadAppearance().linkClick === "follow",
      notes: () =>
        vault.links
          .paths()
          .filter((p) => p !== vault.active?.path)
          .sort()
          .map((p) => ({
            path: p,
            title: displayName(p),
            aliases: vault.links.get(p)?.aliases ?? [],
            linkText: vault.links.linkText(p),
            recentRank: recent.includes(p) ? recent.filter((r) => r !== vault.active?.path).indexOf(p) : undefined,
            inbound: inbound.get(p) ?? 0,
          })),
      linkText: (p) => (vault.entries.some((e) => e.path === p && e.kind === "file") ? vault.links.linkText(p) : null),
      linkSelection: () => setLinkPickerOpen(true),
      currentPath: () => vault.active?.path ?? null,
      formatLink: (inner, embed) => {
        const from = vault.active?.path;
        if (vault.settings.linkFormat !== "markdown" || !from) return null;
        const { target, heading, block, alias } = splitLinkText(inner);
        if (!target) return null; // "[[#Heading]]" within the note stays a wikilink
        const path = vault.links.resolve(target, from);
        return markdownLink(from, { path, target, sub: heading ?? (block ? `^${block}` : undefined), alias, embed });
      },
      noteContent: (p) => (isNote(p) ? vault.links.content(p) : undefined),
      addBlockId: (p, block, id) => {
        const content = vault.links.content(p);
        if (content === undefined) return;
        // Find the block again in the saved text, in case it moved.
        const now = listBlocks(content);
        const same = now.find((b) => b.from === block.from && b.text === block.text) ?? now.find((b) => b.text === block.text);
        if (!same || same.id) return;
        const c = blockIdChange(same, id);
        void vault.writeNote(p, content.slice(0, c.from) + c.insert + content.slice(c.from));
      },
      headings: (p) => vault.links.get(p)?.headings.map((h) => h.text) ?? [],
      notePreview: (t, sub) => {
        const p = vault.links.resolve(t, vault.active?.path);
        if (!p) return null;
        if (isImage(p) || isDrawing(p)) {
          return { title: isDrawing(p) ? drawingName(p) : basename(p), markdown: `![[${vault.links.linkText(p)}]]` };
        }
        if (!isNote(p)) return { title: basename(p), markdown: "" };
        const body = splitFrontmatter(vault.links.content(p) ?? "").body;
        const where = sub ? ` › ${sub.startsWith("^") ? "block" : sub}` : "";
        return { title: noteTitle(p) + where, markdown: previewMarkdown(body, sub) };
      },
      hoverPreview: () => loadAppearance().hoverPreview,
      embedPath: (t) => {
        const p = vault.links.resolve(t, vault.active?.path);
        return p && (isImage(p) || isDrawing(p)) ? p : null;
      },
      fileUrl: (p) => vault.fileUrl(p, { dark: prefersDark() }),
      saveFiles: async (files) => {
        const paths = await vault.addAttachments(files);
        return paths.map((p) => vault.links.linkText(p));
      },
      renderHtml: async (md) => {
        const { renderMarkdown } = await import("@/lib/markdown/render");
        return renderMarkdown(md, {
          resolve: (t) => vault.links.resolve(t, vault.active?.path),
          read: (p) => vault.links.content(p),
        });
      },
      noteEmbed: (inner) => {
        const { target, heading } = splitLinkText(inner);
        const p = target ? vault.links.resolve(target, vault.active?.path) : null;
        if (!p || !isNote(p) || p === vault.active?.path) return null;
        const body = splitFrontmatter(vault.links.content(p) ?? "").body;
        const markdown = heading ? (sectionUnder(body, heading) ?? "") : body;
        return { markdown, title: heading ? `${noteTitle(p)} › ${heading}` : noteTitle(p) };
      },
      propertyInfo,
    }),
    [vault, openLink, recent, inbound, propertyInfo],
  );

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

  // What a drawing needs to link to notes and place vault pictures, as in Obsidian.
  const drawingVault = useMemo<DrawingVault>(() => {
    const describe = (p: string) => ({
      path: p,
      title: isNote(p) || isDrawing(p) || isCanvas(p) ? displayName(p) : basename(p),
      linkText: vault.links.linkText(p),
      folder: dirname(p),
    });
    return {
      notes: () =>
        vault.links
          .paths()
          .filter((p) => p !== vault.active?.path)
          .sort()
          .map(describe),
      pictures: () =>
        vault.entries
          .filter(
            (e) =>
              e.kind === "file" &&
              e.path !== vault.active?.path &&
              (isImage(e.path) || isDrawing(e.path)) &&
              !e.path.split("/").some((seg) => seg.startsWith(".")),
          )
          .map((e) => describe(e.path))
          .sort((a, b) => a.title.localeCompare(b.title)),
      pictureData: async (p) => {
        // Drawings come back as an SVG rendering; embed the light version, like an exported image.
        const url = await vault.fileUrl(p, { dark: false });
        if (!url) return null;
        const blob = await (await fetch(url)).blob();
        const dataURL = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
        return { dataURL, mimeType: blob.type || "image/png" };
      },
      resolve: (t) => vault.links.resolve(t, vault.active?.path),
    };
  }, [vault]);

  const linkContext = useMemo<LinkContext>(
    () => ({
      resolve: (t) => vault.links.resolve(t, vault.active?.path),
      read: (p) => vault.links.content(p),
    }),
    // indexVersion: re-render links and embeds when other notes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault.links, vault.active?.path, vault.indexVersion],
  );
  // What a canvas needs: files to place as cards, note previews, pictures and link resolution.
  const canvasVault = useMemo<CanvasVault>(
    () => ({
      files: () =>
        vault.entries
          .filter((e) => e.kind === "file" && e.path !== vault.active?.path && !e.path.split("/").some((seg) => seg.startsWith(".")))
          .map((e) => ({
            path: e.path,
            title: isDrawing(e.path) ? drawingName(e.path) : isCanvas(e.path) ? canvasName(e.path) : isNote(e.path) ? noteTitle(e.path) : basename(e.path),
            folder: dirname(e.path),
          }))
          .sort((a, b) => a.title.localeCompare(b.title)),
      notePreview: (p, subpath) => {
        const content = vault.links.content(p);
        if (content === undefined) return null;
        const sub = subpath?.replace(/^#/, "") || undefined;
        return {
          title: noteTitle(p) + (sub ? ` › ${sub.startsWith("^") ? "block" : sub}` : ""),
          markdown: previewMarkdown(splitFrontmatter(content).body, sub),
        };
      },
      fileUrl: (p) => vault.fileUrl(p, { dark: prefersDark() }),
      exists: (p) => vault.entries.some((e) => e.path === p),
      links: linkContext,
      noteProperties: (p) => ({
        properties: vault.links.get(p)?.properties ?? {},
        info: propertyInfo(),
        set: (key, value) => {
          const text = vault.links.content(p) ?? "";
          const next = setFrontmatterProperty(text, key, value === undefined ? undefined : yamlValue(value));
          if (next !== text) void vault.writeNote(p, next);
        },
      }),
    }),
    // indexVersion: cards showing notes re-render when those notes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault.entries, vault.links, vault.indexVersion, vault.active?.path, linkContext, propertyInfo],
  );


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

  /** The latest text of a file: the open file's (with unsaved edits), or the saved one. */
  const latestText = (path: string) => (path === vault.active?.path ? vault.activeText : (vault.links.content(path) ?? ""));
  const isAttachment = (path: string) => !isNote(path) && !isDrawing(path) && !isCanvas(path);

  /** Renames a property in every file that has it (not where the new name is already taken). */
  const renamePropertyEverywhere = async (from: string, to: string) => {
    let changed = 0;
    let clashes = 0;
    for (const path of vault.links.paths()) {
      const props = vault.links.get(path)?.properties ?? {};
      if (!(from in props)) continue;
      if (isAttachment(path)) {
        if (to in props) {
          clashes++;
          continue;
        }
        await vault.setFileProperty(path, to, props[from]);
        await vault.setFileProperty(path, from, undefined);
        changed++;
        continue;
      }
      const next = renamePropertyIn(path, latestText(path), from, to);
      if (next === "clash") clashes++;
      else if (next !== "unchanged") {
        await vault.writeNote(path, next);
        changed++;
      }
    }
    return { changed, clashes };
  };

  /** Removes a property from every file that has it. */
  const deletePropertyEverywhere = async (key: string) => {
    let changed = 0;
    for (const path of vault.links.paths()) {
      const props = vault.links.get(path)?.properties ?? {};
      if (!(key in props)) continue;
      if (isAttachment(path)) {
        await vault.setFileProperty(path, key, undefined);
        changed++;
        continue;
      }
      const next = deletePropertyIn(path, latestText(path), key);
      if (next !== "unchanged") {
        await vault.writeNote(path, next);
        changed++;
      }
    }
    return changed;
  };

  const sidebar = (
    <>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <VaultSwitcher onManage={() => setSettingsOpen("vaults")} />
        </div>
        <button
          type="button"
          className="icon-button mt-1 hidden md:inline-flex"
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
            className={tab === id ? "" : "!flex-none"}
            onClick={() => setTab(id)}
          >
            <Icon size={14} aria-hidden />
            {/* Four tabs don't fit with labels: only the open one shows its name. */}
            <span className={tab === id ? "" : "sr-only"}>{label}</span>
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
          <SearchPanel query={searchQuery} onQuery={setSearchQuery} autoFocus onEditProperties={setPropertyTable} />
        ) : tab === "tags" ? (
          <TagsPanel onTag={showTag} />
        ) : tab === "properties" ? (
          <PropertiesPanel
            onSearch={(q) => {
              setSearchQuery(q);
              setTab("search");
            }}
            onRename={renamePropertyEverywhere}
            onDelete={deletePropertyEverywhere}
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
    </>
  );

  const exportZip = async () => {
    const bytes = await vault.exportZip();
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${vaults.active.name.replace(/[\\/:*?"<>|]/g, "-")} ${formatDate(new Date(), "YYYY-MM-DD")}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const importZip = async (file: File) => {
    const { readZip } = await import("@/lib/vault/zip");
    const files = readZip(new Uint8Array(await file.arrayBuffer()));
    const r = await vault.importFiles(files);
    setImportNote(
      `Imported ${r.added} ${r.added === 1 ? "file" : "files"}` +
        (r.renamed ? `, ${r.renamed} renamed because a different file had the same name` : "") +
        (r.skipped ? `, ${r.skipped} already here` : "") +
        ".",
    );
  };

  /**
   * Makes a canvas of the open note and what's connected to it: typed
   * relations first, then mutual links, links out and links in (up to 16),
   * saved as "<note> map.canvas" next to the note and opened.
   */
  const mapAsCanvas = async () => {
    const center = activePathNow;
    if (!center) return;
    const found = new Map<string, Neighbour>();
    const add = (path: string, direction: "out" | "in", label?: string) => {
      if (path === center) return;
      const prev = found.get(path);
      if (!prev) found.set(path, { path, direction, ...(label ? { label } : {}) });
      else {
        if (prev.direction !== direction) prev.direction = "both";
        if (label && !prev.label) prev.label = label;
      }
    };
    for (const r of vault.links.canvasRelations(center)) if (r.resolved) add(r.other, r.direction, r.label);
    for (const o of vault.links.outgoing(center)) if (o.resolved) add(o.resolved, "out");
    for (const b of vault.links.backlinks(center)) if (!isCanvas(b.source)) add(b.source, "in");
    const rank = (n: Neighbour) => (n.label ? 0 : n.direction === "both" ? 1 : n.direction === "out" ? 2 : 3);
    const neighbours = [...found.values()].sort((a, b) => rank(a) - rank(b)).slice(0, 16);
    const data = neighbourhoodCanvas(center, neighbours);
    const base = joinPath(dirname(center), `${noteTitle(center)} map`);
    let path = `${base}.canvas`;
    for (let i = 2; vault.exists(path); i++) path = `${base} ${i}.canvas`;
    await vault.createNoteWith(path, serializeCanvas(data));
  };

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
    { id: "links-to-markdown", label: "Convert links in this note to markdown links", when: kind === "note" },
    { id: "links-to-wikilinks", label: "Convert links in this note to wikilinks", when: kind === "note" },
    { id: "switcher", label: "Open a note…", hint: "Ctrl/Cmd+O" },
    {
      id: "search",
      label: "Search all notes",
      hint: "Ctrl/Cmd+Shift+F",
    },
    { id: "health", label: "Open repository health" },
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
    { id: "install", label: "Install noted-ai as an app" },
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
    "links-to-markdown": () => convertActiveLinks("markdown"),
    "links-to-wikilinks": () => convertActiveLinks("wikilink"),
    switcher: () => setSwitcherOpen(true),
    search: () => {
      setTab("search");
      setSidebarOpen(true);
    },
    health: () => setHealthOpen(true),
    "map-canvas": () => void mapAsCanvas(),
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
    export: () => void exportZip(),
    import: chooseZip,
    settings: () => setSettingsOpen("appearance"),
    install: () => setSettingsOpen("app"),
  };

  return (
    <>
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
                <div className="mb-4 flex items-center gap-1">
                <div role="tablist" aria-label="Note panels" className="segmented flex flex-1">
                  {(
                    [
                      ["links", "Connections"],
                      ["outline", "Outline"],
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
                  <LinksPanel onOpenLink={(t) => void openLink(t)} onMapCanvas={kind === "note" ? () => void mapAsCanvas() : undefined} />
                ) : null}
              </>
            ) : null
          }
        >
          <header className="flex items-center gap-2 px-3 py-2">
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
            <div className="border-y border-border px-3 py-1">
              <Toolbar view={view} />
            </div>
          )}
          {activePathNow && <ConflictBanner path={activePathNow} onReview={setReviewing} />}
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
            </div>
            {sidePath && vault.entries.some((e) => e.path === sidePath) && (
              <SidePane
                path={sidePath}
                onNavigate={setSidePath}
                onClose={() => setSidePath(null)}
                onOpenHere={(p) => {
                  setSidePath(null);
                  void vault.open(p);
                }}
              />
            )}
          </div>
        </AppShell>
      </SidePaneContext.Provider>
      {switcherOpen && <QuickSwitcher onClose={() => setSwitcherOpen(false)} onOpenSide={setSidePath} />}
      {paletteOpen && (
        <Picker
          title="Command palette"
          placeholder="Type a command…"
          items={commands.filter((c) => c.when !== false)}
          onPick={(item) => runCommand[item.id]?.()}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {historyOpen && activePathNow && <HistoryDialog path={activePathNow} onClose={() => setHistoryOpen(false)} />}
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        aria-label="Choose a zip to import"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void importZip(f);
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
      {creating && <CreateNoteDialog {...creating} onClose={() => setCreating(null)} />}
      {deleting && <DeleteDialog path={deleting} isFolder={false} onClose={() => setDeleting(null)} />}
      {settingsOpen && <SettingsDialog initial={settingsOpen} onClose={() => setSettingsOpen(false)} />}
      {propertyTable && (
        <PropertyTable paths={propertyTable} onClose={() => setPropertyTable(null)} onOpen={(p) => void vault.open(p)} />
      )}
      {reviewing && <ConflictDialog record={reviewing} onClose={() => setReviewing(null)} />}
      {healthOpen && <HealthDialog onClose={() => setHealthOpen(false)} onCreate={offerCreate} />}
      <Toasts />
    </>
  );
}

const prefersDark = isDark;

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
      className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-0.5 font-serif text-lg outline-none hover:bg-foreground/[0.04] focus:bg-foreground/[0.04]"
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
    <span role="status" className={`hidden text-xs sm:inline ${saveState === "error" ? "text-red-600" : "text-muted"}`}>
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


function Toasts() {
  const { error, clearError } = useVault();
  const { notices, dismissNotices } = useSync();
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 6000);
    return () => clearTimeout(t);
  }, [error, clearError]);

  const toasts = [
    ...(error ? [{ key: "error", text: error, tone: "error", dismiss: clearError }] : []),
    ...notices.map((n, i) => ({ key: `n${i}`, text: n, tone: "info", dismiss: dismissNotices })),
  ];
  if (!toasts.length) return null;
  return (
    <div className="fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.key}
          role={t.tone === "error" ? "alert" : "status"}
          className={`menu-panel flex items-start gap-3 px-4 py-3 text-sm ${
            t.tone === "error" ? "border-red-300 dark:border-red-800" : ""
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
