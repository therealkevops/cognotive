"use client";

import "katex/dist/katex.min.css";
import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { splitLinkText } from "@/lib/links/parse";
import { isDark } from "@/lib/appearance";
import { renderMarkdown } from "@/lib/markdown/render";
import type { LinkContext } from "@/lib/markdown/remark-links";

let mermaidId = 0;

async function drawMermaid(root: HTMLElement, dark: boolean) {
  const blocks = root.querySelectorAll<HTMLElement>("pre > code.language-mermaid");
  if (!blocks.length) return;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "default",
  });
  for (const code of blocks) {
    const pre = code.parentElement!;
    try {
      const { svg } = await mermaid.render(`mermaid-${++mermaidId}`, code.textContent ?? "");
      const figure = document.createElement("figure");
      figure.className = "mermaid-diagram";
      figure.innerHTML = svg;
      pre.replaceWith(figure);
    } catch (e) {
      pre.dataset.error = e instanceof Error ? e.message : "Diagram error";
      pre.classList.add("mermaid-error");
    }
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(formatValue).join(", ");
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export interface ReadingViewProps {
  markdown: string;
  links?: LinkContext;
  properties?: Record<string, unknown>;
  onOpenLink?(target: string, heading?: string): void;
  onTag?(tag: string): void;
  /** Loads embedded images and drawings (rendered with only a vault path). */
  fileUrl?(path: string): Promise<string | null>;
  onOpenFile?(path: string): void;
}

/** Rendered, read-only view of a note. HTML comes from the sanitizing pipeline. */
export default function ReadingView({
  markdown,
  links,
  properties,
  onOpenLink,
  onTag,
  fileUrl,
  onOpenFile,
}: ReadingViewProps) {
  const html = useMemo(() => renderMarkdown(markdown, links), [markdown, links]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const dark = isDark();
    void drawMermaid(ref.current, dark);
    let live = true;
    for (const img of ref.current.querySelectorAll<HTMLImageElement>("img[data-asset]")) {
      void fileUrl?.(img.dataset.asset!).then((url) => {
        if (!live) return;
        if (url) img.src = url;
        else img.classList.add("embed-missing");
      });
    }
    return () => {
      live = false;
    };
    // fileUrl changes identity each render; the HTML decides what to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  const onClick = (e: MouseEvent) => {
    const drawing = (e.target as HTMLElement).closest<HTMLImageElement>("img.embed-drawing");
    if (drawing?.dataset.asset) {
      onOpenFile?.(drawing.dataset.asset);
      return;
    }
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    if (a.classList.contains("internal-link")) {
      e.preventDefault();
      const { target, heading, block } = splitLinkText(a.dataset.href ?? "");
      onOpenLink?.(target, heading ?? (block ? `^${block}` : undefined));
    } else if (a.classList.contains("tag")) {
      e.preventDefault();
      onTag?.(a.dataset.tag ?? "");
    }
  };

  const props = Object.entries(properties ?? {});
  return (
    <div className="mx-auto px-6 pt-8 pb-[40vh]" style={{ maxWidth: "var(--line-width, 46rem)", fontSize: "var(--editor-font-size, 16px)" }}>
      {props.length > 0 && (
        <dl aria-label="Properties" className="properties mb-6">
          {props.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>{k}</dt>
              <dd>{formatValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div
        ref={ref}
        className="prose-note"
        data-testid="reading-view"
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
