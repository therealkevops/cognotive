import { CompletionContext, type Completion, type CompletionResult } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { FrontmatterSyntax } from "./frontmatter-syntax";
import { completeSlash } from "./slash";
import { WikiLinkSyntax } from "./wikilinks";

// Monday 23 November 2026.
const NOW = new Date(2026, 10, 23, 9);
const extensions = [markdown({ base: markdownLanguage, extensions: [FrontmatterSyntax, WikiLinkSyntax] })];

/** Completions with the cursor at "‸". */
function complete(doc: string): { result: CompletionResult | null; state: EditorState; pos: number } {
  const pos = doc.indexOf("‸");
  const state = EditorState.create({ doc: doc.replace("‸", ""), extensions });
  return { result: completeSlash(new CompletionContext(state, pos, false), NOW), state, pos };
}
const labels = (doc: string) => complete(doc).result?.options.map((o) => o.label) ?? [];

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

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
    expect(labels("/‸")).toEqual(["Due date", "Scheduled date", "Start date", "Date"]);
    expect(labels("- [ ] Call Sam /‸")).toContain("Due date");
    expect(labels("/s‸")).toEqual(["Scheduled date", "Start date"]);
    expect(labels("/dead‸")).toEqual(["Due date"]);
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
});
