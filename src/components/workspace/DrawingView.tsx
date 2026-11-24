"use client";

import "@/lib/drawing/assets";
import "@excalidraw/excalidraw/index.css";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  Excalidraw,
  newElementWith,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { BinaryFileData, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { FilePlus2, ImageOff, ImagePlus, Link2, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isDark } from "@/lib/appearance";
import { completeWikilink, newNoteName, openWikilink, textLinkUpdates } from "@/lib/drawing/links";
import { elementLinkTarget } from "@/lib/drawing/parse";
import type { EmbeddedFile } from "@/lib/drawing/obsidian";
import { splitLinkText } from "@/lib/links/parse";
import { isPluginKey } from "@/lib/drawing/properties";
import type { PropertyInfo } from "@/lib/editor/properties";
import { matches, Picker } from "./Picker";
import { PropertiesEditor } from "./PropertiesEditor";

type InitialData = ExcalidrawInitialDataState;

function useDarkMode() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(isDark());
    mq.addEventListener("change", on);
    window.addEventListener("noted-appearance", on);
    return () => {
      mq.removeEventListener("change", on);
      window.removeEventListener("noted-appearance", on);
    };
  }, []);
  return dark;
}

export interface DrawingNote {
  path: string;
  title: string;
  /** Shortest unambiguous text for a [[link]] to it. */
  linkText: string;
  folder: string;
}

/** What a drawing needs from the vault for Obsidian-style linking and embedding. */
export interface DrawingVault {
  notes(): DrawingNote[];
  /** Images and other drawings that can be placed in the drawing. */
  pictures(): DrawingNote[];
  /** A data URL for an image, or an SVG rendering of a drawing. */
  pictureData(path: string): Promise<{ dataURL: string; mimeType: string } | null>;
  /** The note a link target resolves to, or null if there's no such note yet. */
  resolve(target: string): string | null;
  /**
   * Saves a picture pasted or dropped into the drawing as an attachment (made smaller, as
   * every added image is); null if it wasn't added (over the storage limit, say).
   */
  saveImage?(file: File): Promise<{ path: string; linkText: string } | null>;
}

export interface DrawingViewProps {
  /** Changes when a different drawing is opened. */
  docKey: string;
  initial: string;
  /**
   * The scene changed. For an Obsidian drawing, `embedded` lists pictures pasted since it
   * opened, to add to its "## Embedded Files" section (they're kept as files, not in the scene).
   */
  onChange(json: string, embedded?: Array<{ id: string; target: string }>): void;
  /**
   * Set for an Obsidian plugin drawing: the pictures its "## Embedded Files" section lists.
   * They're loaded from the repository when it opens, and not written into the scene.
   */
  embedded?: EmbeddedFile[];
  /** Follows a note link set on an element ("[[Note]]"). */
  onOpenLink(target: string, heading?: string): void;
  vault?: DrawingVault;
  /** The drawing's own properties, editable from a panel (the Obsidian plugin's keys are left out). */
  properties?: { properties: Record<string, unknown>; info: PropertyInfo; onSet(key: string, value: unknown): void };
}

/** Natural size of an image data URL, scaled to fit within `max` px. */
function imageSize(dataURL: string, max = 480): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      resolve({
        width: Math.round((img.naturalWidth || max) * scale),
        height: Math.round((img.naturalHeight || max) * scale),
      });
    };
    img.onerror = () => resolve({ width: max, height: max * 0.75 });
    img.src = dataURL;
  });
}

/**
 * Edits an .excalidraw file. Saves only when the drawing itself changes (an
 * element or embedded image), not when you pan, zoom or select.
 *
 * Obsidian-style extras: typing "[[" in a text box suggests notes; text that
 * contains a [[link]] links its box to that note; "Link to note" links the
 * selection (or adds a linked label); "Insert image or drawing" places vault
 * pictures, linked back to their file.
 */
export default function DrawingView({ docKey, initial, onChange, onOpenLink, vault, properties, embedded }: DrawingViewProps) {
  const [showProps, setShowProps] = useState(false);
  const dark = useDarkMode();
  const onChangeRef = useRef(onChange);
  const onOpenLinkRef = useRef(onOpenLink);
  useEffect(() => {
    onChangeRef.current = onChange;
    onOpenLinkRef.current = onOpenLink;
  }, [onChange, onOpenLink]);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [picker, setPicker] = useState<null | "link" | "picture">(null);
  const [notice, setNotice] = useState<{ text: string; key: number } | null>(null);
  /** Pictures an Obsidian drawing links to that aren't in this repository. */
  const [missingFor, setMissingFor] = useState<{ scene: unknown; names: string[] } | null>(null);

  // Say what a new link points to, and whether that note exists yet.
  const announce = useCallback(
    (links: string[]) => {
      if (!vault || !links.length) return;
      const target = elementLinkTarget(links[0])?.split("|")[0].split("#")[0].trim();
      if (!target) return;
      const text = vault.resolve(target)
        ? `Linked to ${target}`
        : `Linked to “${target}”, a new note. Open the link to create it.`;
      setNotice({ text, key: Date.now() });
    },
    [vault],
  );
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);


  // Parsed once per drawing; Excalidraw owns the scene afterwards.
  const { initialData, error } = useMemo(() => {
    try {
      const d = JSON.parse(initial || "{}") as Partial<InitialData> & { appState?: Record<string, unknown> };
      return {
        initialData: {
          elements: d.elements ?? [],
          appState: { ...(d.appState ?? {}), collaborators: new Map() },
          files: d.files ?? {},
          scrollToContent: true,
        } as InitialData,
        error: null,
      };
    } catch {
      return { initialData: null, error: "This drawing file isn't valid JSON, so it can't be opened." };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read `initial` only when the drawing changes
  }, [docKey]);

  const lastFingerprint = useRef<string | null>(null);

  // Pictures pasted or dropped into the drawing are also saved as attachments, so they're in the
  // file tree and smaller; the drawing keeps (the smaller) copy, so it still opens anywhere, and
  // the image is linked to its file. Those already in the drawing when it opened are left alone.
  const seenFiles = useRef<Set<string>>(new Set());
  // An Obsidian drawing's pictures kept as files (listed under "## Embedded Files"): shown, but
  // not written into the scene. `addedEmbeds` are those pasted since it opened, still to be listed.
  const linkedFiles = useRef<Set<string>>(new Set());
  const addedEmbeds = useRef<Array<{ id: string; target: string }>>([]);
  const obsidian = embedded !== undefined;
  const embeddedRef = useRef(embedded);
  useEffect(() => {
    embeddedRef.current = embedded;
  });
  useEffect(() => {
    const listed = embeddedRef.current ?? [];
    seenFiles.current = new Set([...Object.keys(initialData?.files ?? {}), ...listed.map((f) => f.id)]);
    linkedFiles.current = new Set(listed.map((f) => f.id));
    addedEmbeds.current = [];
  }, [initialData]);

  // Load an Obsidian drawing's pictures from the repository.
  useEffect(() => {
    const listed = embeddedRef.current ?? [];
    if (!api || !vault || !listed.length) return;
    let live = true;
    void (async () => {
      const gone: string[] = [];
      const found: BinaryFileData[] = [];
      for (const f of listed) {
        const path = f.url ? null : vault.resolve(f.target);
        const data = path ? await vault.pictureData(path).catch(() => null) : null;
        if (data) found.push({ id: f.id, dataURL: data.dataURL, mimeType: data.mimeType, created: Date.now() } as unknown as BinaryFileData);
        else gone.push(f.url ? `${f.target} (a web picture)` : f.target);
      }
      if (!live) return;
      if (found.length) api.addFiles(found);
      setMissingFor({ scene: initialData, names: gone });
    })();
    return () => {
      live = false;
    };
  }, [api, vault, initialData]);
  const keepAsAttachment = useCallback(
    async (fileId: string, file: { dataURL: string; mimeType: string }) => {
      if (!api || !vault?.saveImage) return;
      try {
        const blob = await (await fetch(file.dataURL)).blob();
        const ext = file.mimeType.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "png";
        // "image.png" is named like a pasted image: "Pasted image 20261124….webp".
        const saved = await vault.saveImage(new File([blob], `image.${ext}`, { type: file.mimeType }));
        if (!saved) return;
        if (obsidian) {
          // As the plugin does it: the picture is listed under "## Embedded Files", not kept in the scene.
          linkedFiles.current.add(fileId);
          addedEmbeds.current = [...addedEmbeds.current, { id: fileId, target: saved.linkText }];
          api.updateScene({
            elements: api
              .getSceneElements()
              .map((e) => (e.type === "image" && e.fileId === fileId ? newElementWith(e, { link: e.link ?? `[[${saved.linkText}]]` }) : e)),
            captureUpdate: CaptureUpdateAction.EVENTUALLY,
          });
          return;
        }
        const data = await vault.pictureData(saved.path);
        if (!data) return;
        const newId = `vault-${Array.from(new TextEncoder().encode(saved.path + data.dataURL.length), (b) => b.toString(16))
          .join("")
          .slice(0, 40)}`;
        seenFiles.current.add(newId);
        api.addFiles([{ id: newId, dataURL: data.dataURL, mimeType: data.mimeType, created: Date.now() } as unknown as BinaryFileData]);
        api.updateScene({
          elements: api
            .getSceneElements()
            .map((e) =>
              e.type === "image" && e.fileId === fileId
                ? newElementWith(e, { fileId: newId as never, link: e.link ?? `[[${saved.linkText}]]` })
                : e,
            ),
          captureUpdate: CaptureUpdateAction.EVENTUALLY,
        });
      } catch {
        // Left as it is: the drawing still has the picture.
      }
    },
    [api, vault, obsidian],
  );

  /** The middle of what's on screen, in scene coordinates. */
  const viewCenter = useCallback(() => {
    const s = api!.getAppState();
    return { x: s.width / 2 / s.zoom.value - s.scrollX, y: s.height / 2 / s.zoom.value - s.scrollY };
  }, [api]);

  /** Links the selected elements to a note, or adds a "[[Note]]" label linked to it. */
  const linkTo = useCallback(
    (linkText: string) => {
      if (!api) return;
      const link = `[[${linkText}]]`;
      const selected = api.getAppState().selectedElementIds;
      const elements = api.getSceneElements();
      if (Object.keys(selected).length) {
        api.updateScene({
          elements: elements.map((e) => (selected[e.id] ? newElementWith(e, { link }) : e)),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        announce([link]);
        return;
      }
      const { x, y } = viewCenter();
      const [label] = convertToExcalidrawElements([{ type: "text", x: x - 40, y: y - 12, text: link }]);
      api.updateScene({
        elements: [...elements, newElementWith(label, { link })],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      announce([link]);
    },
    [api, viewCenter, announce],
  );

  /** Places an image (or another drawing, as a picture) linked back to its file. */
  const insertPicture = useCallback(
    async (path: string) => {
      if (!api || !vault) return;
      const data = await vault.pictureData(path);
      if (!data) return;
      const fileId = `vault-${Array.from(new TextEncoder().encode(path + data.dataURL.length), (b) => b.toString(16))
        .join("")
        .slice(0, 40)}`;
      api.addFiles([
        {
          id: fileId,
          dataURL: data.dataURL,
          mimeType: data.mimeType,
          created: Date.now(),
        } as unknown as BinaryFileData,
      ]);
      const { width, height } = await imageSize(data.dataURL);
      const { x, y } = viewCenter();
      const linkText = vault.pictures().find((p) => p.path === path)?.linkText ?? path;
      const [image] = convertToExcalidrawElements([
        { type: "image", x: x - width / 2, y: y - height / 2, width, height, fileId: fileId as never },
      ]);
      api.updateScene({
        elements: [...api.getSceneElements(), newElementWith(image, { link: `[[${linkText}]]` })],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    [api, vault, viewCenter],
  );

  // Only for the drawing it was worked out for.
  const missing = missingFor && missingFor.scene === initialData ? missingFor.names : [];

  if (error || !initialData) {
    return <p className="p-8 text-red-600 dark:text-red-400">{error}</p>;
  }

  return (
    <div className="relative h-full w-full" data-testid="drawing">
      <Excalidraw
        key={docKey}
        initialData={initialData}
        excalidrawAPI={setApi}
        theme={dark ? "dark" : "light"}
        UIOptions={{ canvasActions: { loadScene: false } }}
        renderTopRightUI={() =>
          vault ? (
            <div className="flex gap-1">
              <button
                type="button"
                className="drawing-tool"
                aria-label="Link to note"
                title="Link the selection to a note, or add a linked label"
                onClick={() => setPicker("link")}
              >
                <Link2 size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="drawing-tool"
                aria-label="Insert image or drawing"
                title="Insert an image or drawing from the repository"
                onClick={() => setPicker("picture")}
              >
                <ImagePlus size={16} aria-hidden />
              </button>
              {properties && (
                <button
                  type="button"
                  className="drawing-tool"
                  aria-label="Properties"
                  aria-expanded={showProps}
                  title="Properties of this drawing (tags, aliases…)"
                  onClick={() => setShowProps((v) => !v)}
                >
                  <SlidersHorizontal size={16} aria-hidden />
                </button>
              )}
            </div>
          ) : null
        }
        onChange={(elements, appState, files) => {
          for (const [id, f] of Object.entries(files)) {
            if (seenFiles.current.has(id)) continue;
            seenFiles.current.add(id);
            if (!id.startsWith("vault-") && f.dataURL) void keepAsAttachment(id, f);
          }
          // Text that mentions [[a note]] links its box to that note.
          const links = textLinkUpdates(elements);
          if (links.size && api) {
            api.updateScene({
              elements: elements.map((e) => (links.has(e.id) ? newElementWith(e, { link: links.get(e.id)! }) : e)),
              captureUpdate: CaptureUpdateAction.EVENTUALLY,
            });
            if (lastFingerprint.current !== null) announce([...links.values()]);
            return; // the update triggers another onChange, which saves
          }
          // An Obsidian drawing's pictures kept as files aren't written into its scene.
          const own = linkedFiles.current.size
            ? Object.fromEntries(Object.entries(files).filter(([id]) => !linkedFiles.current.has(id)))
            : files;
          // Element versions change on every real edit; selection and scrolling don't.
          const fingerprint = `${elements.map((e) => `${e.id}:${e.version}`).join(",")}|${Object.keys(own).join(",")}|${appState.viewBackgroundColor}`;
          if (lastFingerprint.current === null) {
            lastFingerprint.current = fingerprint; // the initial load isn't an edit
            return;
          }
          if (fingerprint === lastFingerprint.current) return;
          lastFingerprint.current = fingerprint;
          onChangeRef.current(serializeAsJSON(elements, appState, own, "local"), obsidian ? addedEmbeds.current : undefined);
        }}
        onLinkOpen={(element, event) => {
          const target = elementLinkTarget(element.link);
          if (!target) return; // a web link: let Excalidraw open it
          event.preventDefault();
          const parts = splitLinkText(target);
          onOpenLinkRef.current(parts.target, parts.heading ?? (parts.block ? `^${parts.block}` : undefined));
        }}
      />
      {missing.length > 0 && (
        <div
          role="status"
          aria-label="Missing pictures"
          className="menu-panel absolute bottom-16 left-1/2 z-10 flex w-[min(30rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-2.5 px-3 py-2.5 text-sm"
        >
          <ImageOff size={16} aria-hidden className="mt-0.5 shrink-0 text-muted" />
          <p className="min-w-0 flex-1">
            {missing.length === 1 ? "A picture" : `${missing.length} pictures`} in this drawing{" "}
            {missing.length === 1 ? "isn't" : "aren't"} in this repository: {missing.join(", ")}. Import{" "}
            {missing.length === 1 ? "it" : "them"} (the Obsidian vault&apos;s attachments, for example), then open the drawing again.
          </p>
          <button type="button" className="icon-button h-6 w-6 shrink-0" aria-label="Dismiss" onClick={() => setMissingFor(null)}>
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
      {notice && (
        <div
          key={notice.key}
          aria-live="polite"
          data-testid="drawing-notice"
          className="pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-lg"
        >
          {notice.text}
        </div>
      )}
      {vault && <TextLinkSuggestions vault={vault} />}
      {properties && showProps && (
        <div
          role="dialog"
          aria-label="Drawing properties"
          className="drawing-properties menu-panel"
          onKeyDown={(e) => {
            // Keys typed here are for the text boxes, not Excalidraw's shortcuts.
            e.stopPropagation();
            if (e.key === "Escape") setShowProps(false);
          }}
        >
          <PropertiesEditor
            properties={Object.fromEntries(Object.entries(properties.properties).filter(([k]) => !isPluginKey(k)))}
            info={properties.info}
            onSet={properties.onSet}
          />
        </div>
      )}
      {picker === "link" && vault && (
        <Picker
          title="Link to note"
          placeholder="Link to which note?"
          items={vault.notes().map((n) => ({ id: n.linkText, label: n.title, hint: n.folder }))}
          onPick={(item) => linkTo(item.id)}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === "picture" && vault && (
        <Picker
          title="Insert image or drawing"
          placeholder="Insert which image or drawing?"
          empty="No images or other drawings in this repository yet."
          items={vault.pictures().map((p) => ({ id: p.path, label: p.title, hint: p.folder }))}
          onPick={(item) => void insertPicture(item.id)}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

/** A note to link to, or (isNew) a note that doesn't exist yet. */
type Suggestion = DrawingNote & { isNew?: boolean };

/**
 * Note suggestions while typing "[[" in an Excalidraw text box. Excalidraw edits
 * text in a <textarea class="excalidraw-wysiwyg">; this listens to it and writes
 * the chosen link back through a normal input event, so Excalidraw sees typing.
 */
function TextLinkSuggestions({ vault }: { vault: DrawingVault }) {
  const [state, setState] = useState<{
    textarea: HTMLTextAreaElement;
    start: number;
    query: string;
    left: number;
    top: number;
  } | null>(null);
  const [selected, setSelected] = useState(0);
  const options = useMemo<Suggestion[]>(() => {
    if (!state) return [];
    const notes = vault.notes();
    const found: Suggestion[] = notes.filter((n) => matches(n.title, state.query)).slice(0, 8);
    const name = newNoteName(state.query, notes);
    return name ? [...found, { path: "", title: name, linkText: name, folder: "", isNew: true }] : found;
  }, [state, vault]);
  const live = useRef({ state, options, selected });
  useEffect(() => {
    live.current = { state, options, selected };
  });

  const choose = useCallback((note: Suggestion) => {
    const s = live.current.state;
    if (!s) return;
    const ta = s.textarea;
    const next = completeWikilink(ta.value, s.start, ta.selectionStart, note.linkText);
    // Set the value the way a user edit would, so React-controlled Excalidraw picks it up.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(ta, next.text);
    ta.setSelectionRange(next.caret, next.caret);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    setState(null);
    ta.focus();
  }, []);

  useEffect(() => {
    const isEditor = (t: EventTarget | null): t is HTMLTextAreaElement =>
      t instanceof HTMLTextAreaElement && t.classList.contains("excalidraw-wysiwyg");
    const onInput = (e: Event) => {
      if (!isEditor(e.target)) return;
      const ta = e.target;
      const open = openWikilink(ta.value, ta.selectionStart);
      if (!open) return setState(null);
      const r = ta.getBoundingClientRect();
      setState({ textarea: ta, ...open, left: r.left, top: r.bottom + 4 });
      setSelected(0);
    };
    // Capture phase, so Enter/Escape/arrows reach us before Excalidraw's own handlers.
    const onKey = (e: KeyboardEvent) => {
      const { state: s, options: opts, selected: sel } = live.current;
      if (!s || !isEditor(e.target) || opts.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((i) => (e.key === "ArrowDown" ? Math.min(i + 1, opts.length - 1) : Math.max(i - 1, 0)));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        choose(opts[sel]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setState(null);
      }
    };
    const onBlur = (e: FocusEvent) => isEditor(e.target) && setTimeout(() => setState(null), 150);
    document.addEventListener("input", onInput, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusout", onBlur, true);
    return () => {
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusout", onBlur, true);
    };
  }, [choose]);

  if (!state || options.length === 0) return null;
  return (
    <ul
      role="listbox"
      aria-label="Link suggestions"
      className="menu-panel fixed z-50 max-h-64 w-64 overflow-y-auto p-1 text-sm"
      style={{ left: state.left, top: state.top }}
    >
      {options.map((n, i) => (
        <li
          key={n.isNew ? "\u0000new" : n.path}
          role="option"
          aria-selected={i === selected}
          className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${i === selected ? "bg-accent/15" : ""}`}
          // mousedown, not click: keep focus in Excalidraw's text box.
          onMouseDown={(e) => {
            e.preventDefault();
            choose(n);
          }}
        >
          {n.isNew ? (
            <>
              <FilePlus2 size={14} aria-hidden className="shrink-0 text-accent" />
              <span className="truncate">
                New note <span className="font-medium">“{n.title}”</span>
              </span>
            </>
          ) : (
            <>
              <span className="truncate">{n.title}</span>
              {n.folder && <span className="ml-auto truncate text-xs text-muted">{n.folder}</span>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
