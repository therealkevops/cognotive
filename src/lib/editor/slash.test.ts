import { CompletionContext, type Completion, type CompletionResult } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { FrontmatterSyntax } from "./frontmatter-syntax";
import { completeSlash } from "./slash";
import { linkHost, WikiLinkSyntax, type LinkHost } from "./wikilinks";

// Monday 23 November 2026.
const NOW = new Date(2026, 10, 23, 9);
const host = {
  notes: () => [],
  headings: () => [],
  resolve: () => null,
  open: () => {},
  dailyNoteLink: (d: Date) => `[[Daily/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}]]`,
} as LinkHost;
const extensions = [markdown({ base: markdownLanguage, extensions: [FrontmatterSyntax, WikiLinkSyntax] }), linkHost.of(host)];

/** Completions with the cursor at "‸". */
function complete(doc: string): { result: CompletionResult | null; state: EditorState; pos: number } {
  const pos = doc.indexOf("‸");
  const state = EditorState.create({ doc: doc.replace("‸", ""), extensions });
  return { result: completeSlash(new CompletionContext(state, pos, false), NOW), state, pos };
}
const labels = (doc: string) => complete(doc).result?.options.map((o) => o.label) ?? [];

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

/** The document after choosing the option labelled `label`, with "‸" where the cursor ends up. */
function chooseWithCursor(doc: string, label: string): string {
  const { result, state, pos } = complete(doc);
  const option = result?.options.find((o) => o.label === label);
  if (!result || !option) throw new Error(`no "${label}"`);
  const view = new EditorView({ state, parent: document.body });
  views.push(view);
  (option.apply as (v: EditorView, c: Completion, f: number, t: number) => void)(view, option, result.from, pos);
  const head = view.state.selection.main.head;
  const text = view.state.doc.toString();
  return text.slice(0, head) + "‸" + text.slice(head);
}

/** The document after choosing the option labelled `label`. */
function choose(doc: string, label: string): string {
  const { result, state, pos } = complete(doc);
  const option = result?.options.find((o) => o.label === label);
  if (!result || !option) throw new Error(`no "${label}" in ${JSON.stringify(result?.options.map((o) => o.label))}`);
  const view = new EditorView({ state, parent: document.body });
  views.push(view);
  (option.apply as (v: EditorView, c: Completion, f: number, t: number) => void)(view, option, result.from, pos);
  return view.state.doc.toString();
}

describe("the / menu", () => {
  it("lists the commands at the start of a line or after a space", () => {
    const all = complete("/‸").result!.options;
    expect(new Set(all.map((o) => (typeof o.section === "object" ? o.section.name : o.section)))).toEqual(new Set(["Blocks", "Insert", "Tasks and dates"]));
    // Commands that need the app (attachments, drawings, templates) are only offered when it can do them.
    expect(all.map((o) => o.label)).toContain("Link a daily note");
    expect(all.map((o) => o.label)).not.toContain("Attach a file or photo");
    expect(labels("- [ ] Call Sam /‸")).toContain("Due date");
    expect(labels("/sch‸")).toEqual(["Scheduled date"]);
    expect(labels("/s‸")).toEqual(expect.arrayContaining(["Scheduled date", "Start date", "Code block", "Divider"]));
    expect(labels("/dead‸")).toEqual(["Due date"]);
    expect(labels("/heading‸")).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
    expect(labels("/code‸")[0]).toBe("Code block");
  });

  it("stays shut where a slash is just a slash", () => {
    for (const doc of ["24/‸", "and/‸", "see https://x.io/‸", "`code /‸`", "```\n/‸\n```", "---\ntags: /‸\n---\n", "/zzz‸", "a / ‸"]) {
      expect(complete(doc).result, doc).toBeNull();
    }
  });

  it("shows the date a phrase means, and phrases that finish what's typed", () => {
    expect(labels("- [ ] Call Sam /due this tue‸")[0]).toBe("Due Tue 24 Nov");
    expect(labels("/due next t‸")).toEqual(["Due Tue 1 Dec", "Due Thu 3 Dec"]);
    expect(complete("/due 24 nov‸").result?.options[0]).toMatchObject({ label: "Due Tue 24 Nov", detail: "24 nov · tomorrow" });
    expect(labels("/due ‸")).toEqual(["Due Mon 23 Nov", "Due Tue 24 Nov", "Due Sat 28 Nov", "Due Mon 30 Nov", "Due Mon 7 Dec"]);
    expect(labels("/date tomorrow‸")[0]).toBe("Tue 24 Nov");
    expect(complete("/due whenever‸").result).toBeNull();
  });

  it("writes the field in place of what was typed", () => {
    expect(choose("- [ ] Call Sam /due this tue‸", "Due Tue 24 Nov")).toBe("- [ ] Call Sam [due:: 2026-11-24]");
    expect(choose("- [ ] Plan /scheduled next mon‸ #work", "Scheduled Mon 30 Nov")).toBe("- [ ] Plan [scheduled:: 2026-11-30] #work");
    expect(choose("Met on /date yesterday‸", "Sun 22 Nov")).toBe("Met on 2026-11-22");
  });

  it("replaces a due date the task already has", () => {
    expect(choose("- [ ] Call Sam [due:: 2026-11-20] /due fri‸", "Due Fri 27 Nov")).toBe("- [ ] Call Sam [due:: 2026-11-27]");
  });

  it("finishes the command name, ready for a date", () => {
    expect(choose("- [ ] Call Sam /du‸", "Due date")).toBe("- [ ] Call Sam /due ");
  });

  it("leaves the cursor after the marker, so typing carries on", () => {
    expect(chooseWithCursor("/task‸", "Task")).toBe("- [ ] ‸");
    expect(chooseWithCursor("Intro\n/task‸", "Task")).toBe("Intro\n- [ ] ‸");
    expect(chooseWithCursor("  /task‸", "Task")).toBe("  - [ ] ‸");
    expect(chooseWithCursor("/h2‸", "Heading 2")).toBe("## ‸");
    expect(chooseWithCursor("/quote‸", "Quote")).toBe("> ‸");
    expect(chooseWithCursor("Buy milk /task‸", "Task")).toBe("- [ ] Buy milk ‸");
  });

  it("turns lines into headings, quotes and tasks", () => {
    expect(choose("Shopping /h2‸", "Heading 2")).toBe("## Shopping ");
    expect(choose("Ideas /quote‸", "Quote")).toBe("> Ideas ");
    expect(choose("Buy milk /task‸", "Task")).toBe("- [ ] Buy milk ");
    expect(choose("- [ ] Buy milk /task‸", "Task")).toBe("- [ ] Buy milk ");
  });

  it("puts blocks on their own lines", () => {
    expect(choose("Intro\n/math‸", "Maths block")).toBe("Intro\n\n$$\n\n$$");
    expect(choose("/divider‸", "Divider")).toBe("\n---\n");
    expect(choose("Steps /diagram‸", "Diagram")).toBe("Steps\n\n```mermaid\ngraph LR\n  A --> B\n```");
    expect(choose("/callout ti‸", "Tip")).toBe("> [!tip]\n> ");
    expect(choose("/code py‸", "Python")).toBe("```python\n\n```");
    expect(choose("/code rust‸", "rust")).toBe("```rust\n\n```");
  });

  it("makes tables by size, columns first", () => {
    expect(labels("/table ‸")).toEqual(["Table, 2 × 2", "Table, 3 × 2", "Table, 3 × 3", "Table, 4 × 3", "Table, 4 × 4"]);
    expect(labels("/table 5x3‸")).toEqual(["Table, 5 × 3"]);
    const table = choose("/table 3x1‸", "Table, 3 × 1");
    expect(table.split("\n")).toHaveLength(3);
    expect(table.split("\n")[0].match(/\|/g)).toHaveLength(4);
  });

  it("sets and clears a task's priority", () => {
    expect(labels("/priority h‸")).toEqual(["Highest priority", "High priority"]);
    expect(choose("- [ ] Call Sam /priority high‸", "High priority")).toBe("- [ ] Call Sam [priority:: high]");
    expect(choose("- [ ] Call Sam [priority:: low] /priority hi‸", "Highest priority")).toBe("- [ ] Call Sam [priority:: highest]");
    expect(choose("- [ ] Call Sam [priority:: low] /priority no‸", "No priority")).toBe("- [ ] Call Sam");
  });

  it("links the daily note for a date in words", () => {
    expect(choose("Discuss on /daily this fri‸", "Daily note Fri 27 Nov")).toBe("Discuss on [[Daily/2026-11-27]]");
  });

  it("starts a link or an embed and opens the note suggestions", () => {
    expect(choose("See /link‸", "Link to a note")).toBe("See [[]]");
    expect(choose("/embed‸", "Embed a note or image")).toBe("![[]]");
  });

  it("offers AI commands only when AI is set up", () => {
    expect(labels("/‸")).not.toContain("Summarise this note");
    const calls: unknown[] = [];
    const ai = { ...host, aiReady: () => true, askAbout: (p: unknown, q?: string) => calls.push(["ask", p, q]), aiAction: (k: string) => calls.push(["run", k]) } as LinkHost;
    const make = (doc: string) => {
      const pos = doc.indexOf("‸");
      const state = EditorState.create({ doc: doc.replace("‸", ""), extensions: [markdown({ base: markdownLanguage, extensions: [FrontmatterSyntax, WikiLinkSyntax] }), linkHost.of(ai)] });
      return { result: completeSlash(new CompletionContext(state, pos, false), NOW), state, pos };
    };
    const run = (doc: string, label: string) => {
      const { result, state, pos } = make(doc);
      const option = result!.options.find((o) => o.label === label)!;
      const view = new EditorView({ state, parent: document.body });
      views.push(view);
      (option.apply as (v: EditorView, c: Completion, f: number, t: number) => void)(view, option, result!.from, pos);
      return view.state.doc.toString();
    };

    const section = make("/‸").result!.options.filter((o) => typeof o.section === "object" && o.section.name === "AI").map((o) => o.label);
    expect(section).toEqual(["Ask AI about this paragraph", "Summarise this note", "Suggest links", "Suggest tags and properties", "Review my week"]);

    // /ask with a question: about the paragraph it's typed in, with the command taken out.
    expect(run("Intro.\n\nTomatoes need sun.\nWater them daily. /ask why daily‸\n\nMore.", "Ask: Why daily")).toBe("Intro.\n\nTomatoes need sun.\nWater them daily. \n\nMore.");
    expect(calls.at(-1)).toEqual(["ask", { from: 8, to: 44, text: "Tomatoes need sun.\nWater them daily." }, "why daily"]);
    // On an empty line, the paragraph above.
    expect(make("Tomatoes need sun.\n\n/ask ‸").result!.options.map((o) => o.label)[0]).toBe("Ask about this paragraph…");
    run("Tomatoes need sun.\n\n/ask ‸", "Explain this");
    expect(calls.at(-1)).toEqual(["ask", { from: 0, to: 18, text: "Tomatoes need sun." }, "Explain this"]);

    expect(run("Notes /summarise‸", "Summarise this note")).toBe("Notes ");
    expect(calls.at(-1)).toEqual(["run", "summarise"]);
    run("/review‸", "Review my week");
    expect(calls.at(-1)).toEqual(["run", "daily-review"]);
  });
});
