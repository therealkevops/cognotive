import { describe, expect, it, vi } from "vitest";
import { onRendererChange, renderMarkdown, renderMarkdownReady, rendererVersion } from "./render";

// A file of its own: KaTeX and the highlighter start unloaded here.
describe("loading KaTeX and the highlighter when first needed", () => {
  it("renders plain text without loading either", () => {
    const heard = vi.fn();
    const stop = onRendererChange(heard);
    expect(renderMarkdown("Just words, and ```inline``` code.")).not.toContain("katex");
    expect(rendererVersion()).toBe(0);
    stop();
  });

  it("shows maths as source at first, loads KaTeX, and then draws it", async () => {
    const before = renderMarkdown("Inline $e^{i\\pi}$");
    expect(before).toContain("math-inline");
    expect(before).not.toContain('class="katex"');
    const changed = new Promise<void>((done) => {
      const stop = onRendererChange(() => {
        stop();
        done();
      });
    });
    await changed;
    expect(rendererVersion()).toBe(1);
    expect(renderMarkdown("Inline $e^{i\\pi}$")).toContain('class="katex"');
  });

  it("renderMarkdownReady waits for the highlighter when the code needs it", async () => {
    const html = await renderMarkdownReady("```js\nconst a = 1\n```");
    expect(html).toContain("hljs-keyword");
    // Mermaid alone doesn't need it.
    expect(await renderMarkdownReady("```mermaid\ngraph TD; A-->B\n```")).toContain("language-mermaid");
  });
});
