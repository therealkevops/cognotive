import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { editorExtensions } from "./setup";

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

function view(doc: string, cursor: number, livePreview = true) {
  const v = new EditorView({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: editorExtensions({ livePreview, onChange: () => {} }),
    parent: document.body,
  });
  views.push(v);
  return v;
}

const lineText = (v: EditorView, n: number) =>
  v.contentDOM.querySelectorAll(".cm-line")[n - 1]?.textContent;

describe("live preview", () => {
  const doc = "# Title\nSome **bold** and [a link](https://x.io) ==hi==\n- item\n- [ ] task\nend";

  it("hides syntax on lines without the cursor", () => {
    const v = view(doc, doc.length);
    expect(lineText(v, 1)).toBe("Title");
    expect(lineText(v, 2)).toBe("Some bold and a link hi");
    expect(lineText(v, 3)).toBe("• item");
    expect(v.contentDOM.querySelector("input.cm-task-checkbox")).not.toBeNull();
  });

  it("reveals syntax where the cursor is", () => {
    const v = view(doc, 3);
    expect(lineText(v, 1)).toBe("# Title");
    v.dispatch({ selection: { anchor: doc.indexOf("bold") + 1 } });
    expect(lineText(v, 2)).toBe("Some **bold** and a link hi");
  });

  it("shows everything in source mode", () => {
    const v = view(doc, doc.length, false);
    expect(lineText(v, 1)).toBe("# Title");
    expect(lineText(v, 2)).toBe("Some **bold** and [a link](https://x.io) ==hi==");
  });

  it("leaves bracketed text that isn't a link alone", () => {
    const v = view("> [!tip] Title\nend", 18);
    expect(lineText(v, 1)).toBe("> [!tip] Title");
  });

  it("shows wikilinks as their text, or their alias", () => {
    const doc = "See [[Garden]] and [[Recipes/Pasta|pasta]] and ![[Pic]]\nend";
    const v = view(doc, doc.length);
    expect(lineText(v, 1)).toBe("See Garden and pasta and Pic");
    v.dispatch({ selection: { anchor: 8 } });
    expect(lineText(v, 1)).toBe("See [[Garden]] and pasta and Pic");
  });

  it("marks unresolved wikilinks and opens links on click", () => {
    const opened: string[] = [];
    const v = new EditorView({
      doc: "[[Known]] [[Unknown]]\nend",
      selection: EditorSelection.cursor(24),
      extensions: editorExtensions({
        livePreview: true,
        onChange: () => {},
        links: {
          resolve: (t) => (t === "Known" ? "Known.md" : null),
          open: (t) => opened.push(t),
          notes: () => [],
          headings: () => [],
          preview: () => "",
        },
      }),
      parent: document.body,
    });
    views.push(v);
    const marks = v.contentDOM.querySelectorAll(".cm-wikilink");
    expect(marks).toHaveLength(2);
    expect(marks[1].classList.contains("cm-wikilink-unresolved")).toBe(true);
    expect(marks[0].classList.contains("cm-wikilink-unresolved")).toBe(false);
  });

  it("treats top-of-note frontmatter as properties, not headings", () => {
    const doc = "---\ntags: [a]\n---\n# Title\nend";
    const v = view(doc, doc.length);
    expect(v.contentDOM.querySelectorAll(".cm-md-frontmatter").length).toBeGreaterThan(0);
    expect(lineText(v, 2)).toBe("tags: [a]");
    expect(lineText(v, 4)).toBe("Title");
  });

  it("shows ![[image]] embeds as images, loaded through the host", async () => {
    const doc = "Before\n![[pic.png|200]]\nend";
    const v = new EditorView({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: editorExtensions({
        livePreview: true,
        onChange: () => {},
        links: {
          resolve: () => "attachments/pic.png",
          open: () => {},
          notes: () => [],
          headings: () => [],
          preview: () => "",
          embedPath: (t) => (t === "pic.png" ? "attachments/pic.png" : null),
          fileUrl: async () => "blob:fake-url",
        },
      }),
      parent: document.body,
    });
    views.push(v);
    const img = v.contentDOM.querySelector<HTMLImageElement>("img.cm-embed")!;
    expect(img.style.width).toBe("200px");
    await new Promise((r) => setTimeout(r, 0));
    expect(img.getAttribute("src")).toBe("blob:fake-url");
  });

  it("renders tables and note embeds as blocks until the cursor enters them", async () => {
    const doc = "Intro #idea\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n![[Other]]\n\nend";
    const v = new EditorView({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: editorExtensions({
        livePreview: true,
        onChange: () => {},
        links: {
          resolve: () => "Other.md",
          open: () => {},
          notes: () => [],
          headings: () => [],
          preview: () => "",
          renderHtml: async (md) => `<p>rendered:${md.length}</p>`,
          noteEmbed: (t) => (t === "Other" ? { markdown: "Other body", title: "Other" } : null),
        },
      }),
      parent: document.body,
    });
    views.push(v);
    expect(v.contentDOM.querySelector(".cm-tag")?.textContent).toBe("#idea");
    expect(v.dom.querySelector(".cm-rendered-table")).not.toBeNull();
    const embed = v.dom.querySelector(".cm-rendered-embed")!;
    expect(embed.querySelector(".cm-rendered-title")?.textContent).toBe("Other");
    await new Promise((r) => setTimeout(r, 0));
    expect(embed.textContent).toContain("rendered:10");

    // Cursor inside the table shows its source again.
    v.dispatch({ selection: { anchor: doc.indexOf("| 1") } });
    expect(v.dom.querySelector(".cm-rendered-table")).toBeNull();
  });

  it("ticks a task when its checkbox is clicked", () => {
    const v = view(doc, doc.length);
    v.contentDOM.querySelector<HTMLInputElement>("input.cm-task-checkbox")!.click();
    expect(v.state.doc.toString()).toContain("- [x] task");
  });
});
