"use client";

import { useCallback, useMemo, type RefObject } from "react";
import { isDark, loadAppearance } from "@/lib/appearance";
import type { OpenHow } from "@/lib/links/open";
import type { LinkHost } from "@/lib/editor/wikilinks";
import { collectPropertyInfo, yamlValue, type PropertyInfo } from "@/lib/editor/properties";
import type { LinkContext } from "@/lib/markdown/remark-links";
import { formatLink, markdownLink } from "@/lib/links/format";
import { splitLinkText } from "@/lib/links/parse";
import { setFrontmatterProperty, splitFrontmatter } from "@/lib/markdown/frontmatter";
import { todayStamp } from "@/lib/links/health";
import { queryCacheFor, queryContext } from "@/lib/query/context";
import { queryToMarkdown } from "@/lib/query/query";
import { blockIdChange, listBlocks } from "@/lib/markdown/blocks";
import { previewMarkdown } from "@/lib/markdown/preview";
import { sectionUnder } from "@/lib/markdown/remark-links";
import { basename, canvasName, dirname, displayName, drawingName, isCanvas, isDrawing, isImage, isNote, joinPath, noteTitle, uniquePath } from "@/lib/vault/paths";
import type { CanvasVault } from "./CanvasView";
import type { DrawingVault } from "./DrawingView";
import { useVault } from "../vault/useVault";
import { EMPTY_DRAWING } from "@/lib/drawing/parse";
import { formatDate } from "@/lib/vault/settings";

const prefersDark = isDark;

/**
 * What the editor, drawings and canvases need from the vault: link resolution and
 * suggestions, previews, embeds, live query results and property names. Each is
 * rebuilt when the indexes change.
 */
export function useEditorHosts({
  openLink,
  recent,
  onLinkSelection,
  onInsertTemplate,
  askRef,
  aiRef,
}: {
  openLink(target: string, heading?: string, how?: OpenHow): Promise<void> | void;
  recent: string[];
  /** Opens the picker that links the editor's selection to a note. */
  onLinkSelection(): void;
  /** Opens the template picker to insert one at the cursor. */
  onInsertTemplate(): void;
  /** Opens "Ask" on the editor's selection (a ref, so the host needn't change with it). */
  askRef: RefObject<() => void>;
  /** AI for the "/" menu: whether it's ready, and what asking and actions do (a ref, read when used). */
  aiRef: RefObject<{
    ready: boolean;
    ask(passage: { from: number; to: number; text: string }, question?: string): void;
    run(kind: "summarise" | "suggest-links" | "suggest-properties" | "daily-review"): void;
  }>;
}) {
  const vault = useVault();

  // How many notes link to each file, for ranking link suggestions.
  const inbound = useMemo(
    () => vault.indexed.links.inboundCounts(),
    [vault.indexed],
  );

  // Property names, values and tags across the repository, worked out when first asked for.
  const propertyInfo = useMemo(() => {
    let info: PropertyInfo | null = null;
    return () => (info ??= collectPropertyInfo(vault.indexed.links, vault.settings.propertyTypes));
  }, [vault.indexed, vault.settings.propertyTypes]);

  // What the editor needs for [[links]].
  // Live query blocks: results from the indexes, cached until a note changes.
  const cachedQuery = useMemo(() => queryCacheFor(vault.indexed), [vault.indexed]);
  const runQueryBlock = useCallback(
    (source: string, lang: "query" | "dataview"): string => {
      const self = vault.active?.path;
      return cachedQuery(`${self}\u0000${lang}\u0000${source}`, () => {
        const mtimes = new Map(vault.entries.map((e) => [e.path, e.mtime]));
        return queryToMarkdown(
          source,
          lang,
          queryContext({
            links: vault.indexed.links,
            search: vault.indexed.search,
            mtime: (p) => mtimes.get(p),
            linkFor: (p) => {
              const t = vault.indexed.links.linkText(p);
              return formatLink(vault.settings.linkFormat, self ?? "", { path: p, target: t }, t);
            },
            today: todayStamp(),
            ...(self ? { self } : {}),
          }),
        );
      });
    },
    [cachedQuery, vault.active?.path, vault.entries, vault.indexed, vault.settings.linkFormat],
  );

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
      linkSelection: () => onLinkSelection(),
      askSelection: () => askRef.current(),
      insertTemplate: () => onInsertTemplate(),
      aiReady: () => aiRef.current.ready,
      askAbout: (passage, question) => aiRef.current.ask(passage, question),
      aiAction: (kind) => aiRef.current.run(kind),
      newDrawing: async () => {
        const path = uniquePath(joinPath(vault.settings.attachmentFolder, "Drawing.excalidraw"), vault.exists);
        await vault.writeFile(path, EMPTY_DRAWING);
        return vault.links.linkText(path);
      },
      dailyNoteLink: (date) => {
        const s = vault.settings;
        const name = formatDate(date, s.dailyFormat || "YYYY-MM-DD");
        const path = joinPath(s.dailyFolder, `${name}.md`);
        // An existing note by its usual link; one still to come by its path, so it's made in the right folder.
        const inner = vault.exists(path) ? vault.links.linkText(path) : joinPath(s.dailyFolder, name);
        const from = vault.active?.path;
        if (s.linkFormat === "markdown" && from) return markdownLink(from, { path, target: inner });
        return `[[${inner}]]`;
      },
      queryMarkdown: (src, lang) => runQueryBlock(src, lang),
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
        void vault.writeFile(p, content.slice(0, c.from) + c.insert + content.slice(c.from));
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
        const { renderMarkdownReady } = await import("@/lib/markdown/render");
        return renderMarkdownReady(md, {
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
    [vault, openLink, recent, inbound, propertyInfo, runQueryBlock, onLinkSelection, onInsertTemplate, askRef, aiRef],
  );

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
      saveImage: async (file) => {
        const [path] = await vault.addAttachments([file]);
        return path ? { path, linkText: vault.links.linkText(path) } : null;
      },
    };
  }, [vault]);

  const linkContext = useMemo<LinkContext>(
    () => ({
      resolve: (t) => vault.indexed.links.resolve(t, vault.active?.path),
      read: (p) => vault.indexed.links.content(p),
      query: (src, lang) => runQueryBlock(src, lang),
    }),
    [vault.indexed, vault.active?.path, runQueryBlock],
  );
  const { fileUrl: fileUrlOf, writeFile: writeNoteAt } = vault;
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
        const content = vault.indexed.links.content(p);
        if (content === undefined) return null;
        const sub = subpath?.replace(/^#/, "") || undefined;
        return {
          title: noteTitle(p) + (sub ? ` › ${sub.startsWith("^") ? "block" : sub}` : ""),
          markdown: previewMarkdown(splitFrontmatter(content).body, sub),
        };
      },
      fileUrl: (p) => fileUrlOf(p, { dark: prefersDark() }),
      exists: (p) => vault.entries.some((e) => e.path === p),
      links: linkContext,
      noteLinks: (paths) => {
        const on = new Set(paths);
        const out: Array<{ from: string; to: string }> = [];
        for (const from of paths) {
          for (const { resolved } of vault.indexed.links.outgoing(from)) {
            if (resolved && resolved !== from && on.has(resolved)) out.push({ from, to: resolved });
          }
        }
        return out;
      },
      noteProperties: (p) => ({
        properties: vault.indexed.links.get(p)?.properties ?? {},
        info: propertyInfo(),
        set: (key, value) => {
          const text = vault.indexed.links.content(p) ?? "";
          const next = setFrontmatterProperty(text, key, value === undefined ? undefined : yamlValue(value));
          if (next !== text) void writeNoteAt(p, next);
        },
      }),
    }),
    [vault.entries, vault.indexed, vault.active?.path, linkContext, propertyInfo, fileUrlOf, writeNoteAt],
  );

  return { inbound, propertyInfo, linkHost, linkContext, drawingVault, canvasVault };
}
