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
  Network,
  FilePlus,
  ListTree,
  Link2,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Search,
  Settings,
  Tags,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell, RailButton } from "@/components/AppShell";
import { isDark, loadAppearance } from "@/lib/appearance";
import type { OpenHow } from "@/lib/links/open";
import { EMPTY_HISTORY, goBack, goForward, renameInHistory, visit, type NavHistory } from "@/lib/nav/history";
import { readPref, writePref } from "@/lib/prefs";
import type { LinkHost } from "@/lib/editor/wikilinks";
import type { LinkContext } from "@/lib/markdown/remark-links";
import { convertLinks, formatLink, markdownLink } from "@/lib/links/format";
import { splitLinkText } from "@/lib/links/parse";
import { splitFrontmatter } from "@/lib/markdown/frontmatter";
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
  isWithin,
  joinPath,
  noteTitle,
} from "@/lib/vault/paths";
import { drawingJson, isObsidianDrawing, replaceScene } from "@/lib/drawing/obsidian";
import { drawingName } from "@/lib/vault/paths";
import type { CanvasVault } from "./CanvasView";
import type { DrawingVault } from "./DrawingView";
import { fillTemplate, formatDate, newNoteFromLink } from "@/lib/vault/settings";
import { GraphDialog, LocalGraph } from "../graph/GraphDialog";
import { SettingsDialog, type SettingsSection } from "../settings/SettingsDialog";
import { HistoryDialog } from "../sync/HistoryDialog";
import { SyncButton } from "../sync/SyncButton";
import { useSync } from "../sync/useSync";
import { useVault } from "../vault/useVault";
import { useVaults } from "../vault/useVaults";
import { VaultSwitcher } from "../vault/VaultSwitcher";
import { CreateNoteDialog } from "./CreateNoteDialog";
import { DeleteDialog } from "./DeleteDialog";
import { FileTree } from "./FileTree";
import { FileView } from "./FileView";
import { LinksPanel } from "./LinksPanel";
import { Picker, type PickerItem } from "./Picker";
import { SidePane, SidePaneContext } from "./SidePane";
import { TabBar } from "./TabBar";
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
// React Flow, for canvases: loaded only when a canvas is opened.
const CanvasView = dynamic(() => import("./CanvasView"), {
  ssr: false,
  loading: () => <p className="p-8 text-muted">Loading canvas…</p>,
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
  const [lastEditMode, setLastEditMode] = useState<Exclude<Mode, "reading">>(() => readPref("editMode", "live"));
  const [tab, setTab] = useState<SidebarTab>("files");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  /** Which settings section is open, or false. */
  const [settingsOpen, setSettingsOpen] = useState<false | SettingsSection>(false);
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
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [sidePath, setSidePath] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** A note about to be created from a link, waiting for the user to confirm its name and folder. */
  const [creating, setCreating] = useState<{ name: string; folder: string } | null>(null);
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
      } else if (key === "g" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setGraphOpen(true);
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

  /** Opens (or creates) the daily note for a date, from the vault's daily-note settings. */
  const openDaily = async (date = new Date()) => {
    const s = vault.settings;
    const name = formatDate(date, s.dailyFormat || "YYYY-MM-DD");
    const path = joinPath(s.dailyFolder, `${name}.md`);
    let content = "";
    if (s.dailyTemplate) {
      const t = vault.links.resolve(s.dailyTemplate.replace(/\.md$/i, ""));
      if (t) content = fillTemplate(vault.links.content(t) ?? "", { title: basename(name), now: date });
    }
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

  /** Offers to create a missing note `target`, as linked from `from`. */
  const offerCreate = useCallback(
    (target: string, from: string) => setCreating(newNoteFromLink(target, from, vault.settings)),
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
    }),
    [vault, openLink, recent, inbound],
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
    }),
    // indexVersion: cards showing notes re-render when those notes change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault.entries, vault.links, vault.indexVersion, vault.active?.path, linkContext],
  );


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
      <div role="tablist" aria-label="Sidebar" className="segmented flex-1">
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
            onClick={() => setTab(id)}
          >
            <Icon size={14} aria-hidden />
            {label}
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
          <FileTree />
        ) : tab === "search" ? (
          <SearchPanel query={searchQuery} onQuery={setSearchQuery} autoFocus />
        ) : (
          <TagsPanel onTag={showTag} />
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
          onClick={() => setGraphOpen(true)}
          title="Graph view (Ctrl/Cmd+G)"
        >
          <Network size={15} aria-hidden />
          Graph view
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
      <span className="my-1 h-px w-6 bg-border" aria-hidden />
      <RailButton label="Today" onClick={() => void openDaily()}>
        <CalendarDays size={18} aria-hidden />
      </RailButton>
      <RailButton label="Graph view" onClick={() => setGraphOpen(true)}>
        <Network size={18} aria-hidden />
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
      <RailButton label="Links" active={false} onClick={() => openPanelTab("links")}>
        <Link2 size={18} aria-hidden />
      </RailButton>
      <RailButton label="Outline" onClick={() => openPanelTab("outline")}>
        <ListTree size={18} aria-hidden />
      </RailButton>
      <RailButton label="Local graph" onClick={() => openPanelTab("graph")}>
        <Network size={18} aria-hidden />
      </RailButton>
    </>
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

  const templates = vault.links
    .paths()
    .filter((p) => isNote(p) && vault.settings.templateFolder && isWithin(p, vault.settings.templateFolder))
    .sort();

  const insertTemplate = (path: string) => {
    if (!view || !activePathNow) return;
    const text = fillTemplate(vault.links.content(path) ?? "", { title: noteTitle(activePathNow), now: new Date() });
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  };

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
    { id: "link-selection", label: "Link selection to a note…", hint: "Ctrl/Cmd+Shift+K", when: editing },
    { id: "links-to-markdown", label: "Convert links in this note to markdown links", when: kind === "note" },
    { id: "links-to-wikilinks", label: "Convert links in this note to wikilinks", when: kind === "note" },
    { id: "switcher", label: "Open a note…", hint: "Ctrl/Cmd+O" },
    {
      id: "search",
      label: "Search all notes",
      hint: "Ctrl/Cmd+Shift+F",
    },
    { id: "graph", label: "Open graph view", hint: "Ctrl/Cmd+G" },
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
    {
      id: "delete",
      label: "Delete this file",
      when: !!activePathNow,
    },
    { id: "sync", label: "Sync now", when: sync.status.kind !== "local" },
    {
      id: "history",
      label: "Show version history of this file",
      when: !!sync.history && !!activePathNow,
    },
    { id: "export", label: "Export vault as zip" },
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
    template: () => setTemplatesOpen(true),
    "link-selection": () => setLinkPickerOpen(true),
    "links-to-markdown": () => convertActiveLinks("markdown"),
    "links-to-wikilinks": () => convertActiveLinks("wikilink"),
    switcher: () => setSwitcherOpen(true),
    search: () => {
      setTab("search");
      setSidebarOpen(true);
    },
    graph: () => setGraphOpen(true),
    "mode-live": () => setMode("live"),
    "mode-source": () => setMode("source"),
    "mode-reading": () => setMode("reading"),
    side: () => activePathNow && setSidePath(activePathNow),
    "side-close": () => setSidePath(null),
    "toggle-left": () => setLeftCollapsed(!leftCollapsed),
    "toggle-right": () => setRightCollapsed(!rightCollapsed),
    "tab-close": () => activePathNow && closeTab(activePathNow),
    delete: () => activePathNow && setDeleting(activePathNow),
    sync: sync.syncNow,
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
                  <LinksPanel onOpenLink={(t) => void openLink(t)} onCreate={offerCreate} />
                ) : (
                  <LocalGraph onOpenFull={() => setGraphOpen(true)} />
                )}
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
          <TabBar tabs={visibleTabs} active={activePathNow} onSelect={(p) => void vault.open(p)} onClose={closeTab} />
          {kind === "note" && mode !== "reading" && (
            <div className="border-y border-border px-3 py-1">
              <Toolbar view={view} />
            </div>
          )}
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
                <p className="p-8 text-muted">Loading vault…</p>
              ) : !vault.active ? (
                <EmptyState onCreate={() => void vault.createNote()} onFind={() => setSwitcherOpen(true)} />
              ) : kind === "canvas" ? (
                <CanvasView
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
                    vault.edit(isObsidianDrawing(activePathNow!) ? replaceScene(vault.activeText, json) : json)
                  }
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
      {templatesOpen && (
        <Picker
          title="Insert template"
          placeholder="Choose a template…"
          items={templates.map((p) => ({ id: p, label: noteTitle(p), hint: dirname(p) }))}
          empty={`No templates yet. Add notes to the “${vault.settings.templateFolder}” folder (Settings → This vault).`}
          onPick={(item) => insertTemplate(item.id)}
          onClose={() => setTemplatesOpen(false)}
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
      {graphOpen && <GraphDialog onClose={() => setGraphOpen(false)} />}
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
