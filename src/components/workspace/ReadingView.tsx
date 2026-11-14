"use client";

import "katex/dist/katex.min.css";
import { useEffect, useMemo, useRef } from "react";
import { renderMarkdown } from "@/lib/markdown/render";

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

/** Rendered, read-only view of a note. HTML comes from the sanitizing pipeline. */
export default function ReadingView({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    void drawMermaid(ref.current, dark);
  }, [html]);

  return (
    <div
      ref={ref}
      className="prose-note mx-auto max-w-[46rem] px-6 pt-8 pb-[40vh]"
      data-testid="reading-view"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
