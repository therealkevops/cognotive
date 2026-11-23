import { beforeAll, describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter";
import { loadRendererExtras, renderMarkdown } from "./render";

// KaTeX and the highlighter normally load on first need; here they are loaded up front.
beforeAll(() => loadRendererExtras());

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

describe("renderMarkdown links", () => {
  const ctx = {
    resolve: (t: string) => ({ garden: "Garden.md", recipes: "Recipes.md" })[t.toLowerCase()] ?? null,
    read: (p: string) =>
      ({
        "Garden.md": "---\ntags: x\n---\n# Garden\nTomatoes.\n## Beds\nThree beds.\n## Shed\nTools.",
        "Recipes.md": "See ![[Recipes]] forever",
      })[p],
  };

  it("renders wikilinks with their target, alias and resolution", () => {
    const html = renderMarkdown("Go to [[Garden]], [[Garden#Beds|the beds]] or [[Nowhere]].", ctx);
    expect(html).toContain('<a href="#" class="internal-link" data-href="Garden">Garden</a>');
    expect(html).toContain('data-href="Garden#Beds">the beds</a>');
    expect(html).toContain('class="internal-link unresolved" data-href="Nowhere"');
  });

  it("renders tags as links, not headings or numbers", () => {
    const html = renderMarkdown("# Title\nA #Idea and #area/home but not #42.", ctx);
    expect(html).toContain('<a href="#" class="tag" data-tag="idea">#Idea</a>');
    expect(html).toContain('data-tag="area/home"');
    expect(html).not.toContain('data-tag="42"');
    expect(html).toContain("<h1>Title</h1>");
  });

  it("embeds a note, or one section of it", () => {
    const whole = renderMarkdown("![[Garden]]", ctx);
    expect(whole).toContain('<div class="embed" data-href="Garden">');
    expect(whole).toContain("Three beds.");
    expect(whole).not.toContain("tags: x");
    const section = renderMarkdown("![[Garden#Beds]]", ctx);
    expect(section).toContain("Three beds.");
    expect(section).not.toContain("Tools.");
  });

  it("stops embedding at a fixed depth", () => {
    // Recipes embeds itself; rendering must terminate.
    expect(renderMarkdown("![[Recipes]]", ctx)).toContain("embed");
  });

  it("leaves wikilinks in code alone", () => {
    expect(renderMarkdown("`[[Garden]]`", ctx)).toContain("<code>[[Garden]]</code>");
  });
});

describe("renderMarkdown attachments", () => {
  const ctx = {
    resolve: (t: string) =>
      ({ "pic.png": "attachments/pic.png", "attachments/pic.png": "attachments/pic.png", "map.excalidraw": "Map.excalidraw" })[
        t.toLowerCase()
      ] ?? null,
    read: () => undefined,
  };

  it("embeds images and drawings by vault path, for the view to load", () => {
    const html = renderMarkdown("![[pic.png|300]]\n\nInline ![[Map.excalidraw]] here", ctx);
    expect(html).toContain('<img src="" alt="pic.png" class="embed-image" data-asset="attachments/pic.png" width="300">');
    expect(html).toContain('class="embed-drawing" data-asset="Map.excalidraw"');
  });

  it("rewrites markdown images that point into the vault, and leaves web images alone", () => {
    const html = renderMarkdown("![a](attachments/pic.png) ![b](https://x.io/b.png)", ctx);
    expect(html).toContain('data-asset="attachments/pic.png"');
    expect(html).toContain('src="https://x.io/b.png"');
  });
});

describe("renderMarkdown block ids", () => {
  it("hides block ids at the end of a paragraph or list item", () => {
    const html = renderMarkdown("A thought ^idea-1\n\n- item ^b2");
    expect(html).toContain("<p>A thought</p>");
    expect(html).toContain("<li>item</li>");
  });
});
