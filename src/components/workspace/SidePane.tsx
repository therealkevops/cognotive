"use client";

import { ArrowLeftToLine, X } from "lucide-react";
import dynamic from "next/dynamic";
import { reloadOnChunkError } from "@/lib/chunk";
import { createContext, useEffect, useMemo, useState } from "react";
import { isDark } from "@/lib/appearance";
import { collectPropertyInfo, yamlValue } from "@/lib/editor/properties";
import { splitLinkText } from "@/lib/links/parse";
import { setFrontmatterProperty } from "@/lib/markdown/frontmatter";
import type { LinkContext } from "@/lib/markdown/remark-links";
import { canvasName, drawingName, isCanvas, isDrawing, isNote, noteTitle } from "@/lib/vault/paths";
import { useVault } from "../vault/useVault";
import { FileView } from "./FileView";
import { PropertiesEditor } from "./PropertiesEditor";
import { isPluginKey } from "@/lib/drawing/properties";

const ReadingView = dynamic(() => reloadOnChunkError(() => import("./ReadingView"))(), { ssr: false });

/** Opens a file in the side pane (provided by the workspace, used by the file tree). */
export const SidePaneContext = createContext<((path: string) => void) | null>(null);

/**
 * A second note shown beside the open one: handy for referring to a note while
 * writing another. Its text is read-only; its properties can be edited. Links
 * clicked here open in the side pane too.
 */
export function SidePane({
  path,
  onNavigate,
  onClose,
  onOpenHere,
}: {
  path: string;
  onNavigate(path: string): void;
  onClose(): void;
  onOpenHere(path: string): void;
}) {
  const vault = useVault();
  const content = vault.links.content(path) ?? "";
  const links = useMemo<LinkContext>(
    () => ({ resolve: (t) => vault.links.resolve(t, path), read: (p) => vault.links.content(p) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
    [vault.links, path, vault.indexVersion],
  );
  const propertyInfo = useMemo(
    () => collectPropertyInfo(vault.links, vault.settings.propertyTypes),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- indexVersion signals index changes
    [vault.links, vault.indexVersion, vault.settings.propertyTypes],
  );
  // Drawings and canvases: their own properties, above the picture or the link to open it.
  const sideProperties = (
    <PropertiesEditor
      properties={Object.fromEntries(Object.entries(vault.links.get(path)?.properties ?? {}).filter(([k]) => !isPluginKey(k)))}
      info={propertyInfo}
      onSet={(key, value) => void vault.setProperty(path, key, value)}
    />
  );
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isDrawing(path)) return;
    let live = true;
    void vault.fileUrl(path, { dark: isDark() }).then((u) => live && setDrawingUrl(u));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, vault.indexVersion]);

  return (
    <section aria-label="Side pane" className="hidden min-h-0 min-w-0 flex-1 flex-col border-l border-border lg:flex">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {isDrawing(path) ? drawingName(path) : isCanvas(path) ? canvasName(path) : noteTitle(path)}
        </h2>
        <button type="button" className="icon-button" aria-label="Open in main pane" title="Open in main pane" onClick={() => onOpenHere(path)}>
          <ArrowLeftToLine size={15} aria-hidden />
        </button>
        <button type="button" className="icon-button" aria-label="Close side pane" onClick={onClose}>
          <X size={15} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isNote(path) ? (
          <ReadingView
            markdown={content}
            links={links}
            properties={vault.links.get(path)?.properties}
            editProperties={{
              info: propertyInfo,
              onSet: (key, value) => {
                // The open note's latest text (it may be in the main editor too), else the saved text.
                const text = path === vault.active?.path ? vault.activeText : (vault.links.content(path) ?? "");
                const next = setFrontmatterProperty(text, key, value === undefined ? undefined : yamlValue(value));
                if (next !== text) void vault.writeNote(path, next);
              },
            }}
            fileUrl={(p) => vault.fileUrl(p, { dark: isDark() })}
            onOpenFile={onNavigate}
            onOpenLink={(target) => {
              const p = target ? vault.links.resolve(splitLinkText(target).target, path) : null;
              if (p) onNavigate(p);
            }}
          />
        ) : isDrawing(path) ? (
          <>
            <div className="px-6 pt-6">{sideProperties}</div>
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG object URL from the vault */}
            {drawingUrl ? <img src={drawingUrl} alt="" className="mx-auto max-w-full p-4" /> : <p className="p-6 text-muted">Rendering…</p>}
          </>
        ) : isCanvas(path) ? (
          <div className="p-6 text-sm text-muted">
            {sideProperties}
            <p className="mb-3">Canvases open in the main pane.</p>
            <button type="button" className="button-secondary" onClick={() => onOpenHere(path)}>
              Open the canvas
            </button>
          </div>
        ) : (
          <FileView path={path} />
        )}
      </div>
    </section>
  );
}
