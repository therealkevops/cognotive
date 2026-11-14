import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter";
import { renderMarkdown } from "./render";

describe("renderMarkdown", () => {
  it("renders GFM: tables, task lists, strikethrough, autolinks", () => {
    const html = renderMarkdown(
      "| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~ https://example.com",
    );
    expect(html).toContain("<table>");
    expect(html).toMatch(/<input type="checkbox" checked disabled>/);
    expect(html).toContain("<del>old</del>");
    expect(html).toContain('href="https://example.com"');
  });

  it("opens external links in a new tab", () => {
    expect(renderMarkdown("[x](https://example.com)")).toContain(
      'target="_blank" rel="noopener noreferrer"',
    );
  });

  it("renders ==highlight== as <mark>", () => {
    expect(renderMarkdown("a ==big deal== b")).toContain("<mark>big deal</mark>");
  });

  it("leaves lone == alone", () => {
    expect(renderMarkdown("x == y")).toContain("x == y");
  });

  it("renders inline and display math with KaTeX", () => {
    const html = renderMarkdown("Inline $e^{i\\pi}$\n\n$$\nx^2\n$$");
    expect(html).toContain('class="katex"');
    expect(html).toContain("katex-display");
  });

  it("highlights fenced code but leaves mermaid for the client", () => {
    const html = renderMarkdown("```js\nconst a = 1\n```\n\n```mermaid\ngraph TD; A-->B\n```");
    expect(html).toContain('class="hljs language-js"');
    expect(html).toContain("hljs-keyword");
    expect(html).toContain('class="language-mermaid"');
    expect(html).toContain("graph TD; A-->B");
  });

  it("turns callouts into styled blocks", () => {
    const html = renderMarkdown("> [!warning] Mind the gap\n> Body **text**");
    expect(html).toContain('class="callout callout-warning"');
    expect(html).toContain('<div class="callout-title">Mind the gap</div>');
    expect(html).toContain("<strong>text</strong>");
  });

  it("defaults a callout title to its type, and maps aliases", () => {
    const html = renderMarkdown("> [!tldr]\n> Short");
    expect(html).toContain("callout-abstract");
    expect(html).toContain('<div class="callout-title">Tldr</div>');
  });

  it("leaves ordinary blockquotes alone", () => {
    expect(renderMarkdown("> just a quote")).toContain("<blockquote>");
  });

  it("strips scripts, event handlers and javascript: links", () => {
    const html = renderMarkdown(
      '<script>alert(1)</script><img src="x" onerror="alert(1)">[x](javascript:alert(1))',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("does not render frontmatter", () => {
    const html = renderMarkdown("---\ntags: [a]\n---\n# Title");
    expect(html).not.toContain("tags");
    expect(html).toContain("<h1>Title</h1>");
  });
});

describe("splitFrontmatter", () => {
  it("only matches a block at the very top", () => {
    expect(splitFrontmatter("text\n---\na: 1\n---\n").frontmatter).toBe("");
    expect(splitFrontmatter("---\na: 1\n---\nbody")).toEqual({
      frontmatter: "---\na: 1\n---\n",
      body: "body",
    });
  });
});
