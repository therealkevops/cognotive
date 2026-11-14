import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  insertLink,
  insertTable,
  setHeading,
  toggleBold,
  toggleItalic,
  toggleLinePrefix,
  toggleTaskDone,
  type Command,
} from "./formatting";

/** Runs a command on a doc where "|" marks the cursor or "[" "]" mark a selection. */
function run(cmd: Command, doc: string) {
  let anchor: number, head: number;
  if (doc.includes("[")) {
    anchor = doc.indexOf("[");
    doc = doc.replace("[", "");
    head = doc.indexOf("]");
    doc = doc.replace("]", "");
  } else {
    anchor = head = doc.indexOf("|");
    doc = doc.replace("|", "");
  }
  let state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  cmd({ state, dispatch: (tr) => (state = tr.state) });
  const { from, to } = state.selection.main;
  const text = state.doc.toString();
  return from === to
    ? text.slice(0, from) + "|" + text.slice(from)
    : text.slice(0, from) + "[" + text.slice(from, to) + "]" + text.slice(to);
}

describe("toggleInline", () => {
  it("wraps a selection", () => {
    expect(run(toggleBold, "a [word] b")).toBe("a **[word]** b");
  });
  it("unwraps when markers are outside the selection", () => {
    expect(run(toggleBold, "a **[word]** b")).toBe("a [word] b");
  });
  it("unwraps when markers are inside the selection", () => {
    expect(run(toggleBold, "a [**word**] b")).toBe("a [word] b");
  });
  it("inserts a pair around an empty cursor", () => {
    expect(run(toggleItalic, "a | b")).toBe("a *|* b");
  });
  it("does not mistake bold markers for italics", () => {
    expect(run(toggleItalic, "**[word]**")).toBe("***[word]***");
  });
});

describe("setHeading", () => {
  it("adds a heading", () => {
    expect(run(setHeading(2), "Ti|tle")).toBe("## Ti|tle");
  });
  it("changes the level", () => {
    expect(run(setHeading(1), "### Ti|tle")).toBe("# Ti|tle");
  });
  it("removes the heading when applied twice", () => {
    expect(run(setHeading(2), "## Ti|tle")).toBe("Ti|tle");
  });
});

describe("toggleLinePrefix", () => {
  it("bullets every selected line", () => {
    expect(run(toggleLinePrefix("bullet"), "[one\ntwo]")).toBe("- [one\n- two]");
  });
  it("numbers lines in order", () => {
    expect(run(toggleLinePrefix("ordered"), "[a\nb\nc]")).toBe("1. [a\n2. b\n3. c]");
  });
  it("switches list kinds and keeps indentation", () => {
    expect(run(toggleLinePrefix("task"), "  - it|em")).toBe("  - [ ] it|em");
  });
  it("removes the prefix when every line has it", () => {
    expect(run(toggleLinePrefix("quote"), "[> a\n> b]")).toBe("[a\nb]");
  });
  it("skips blank lines in a multi-line selection", () => {
    expect(run(toggleLinePrefix("bullet"), "[a\n\nb]")).toBe("- [a\n\n- b]");
  });
});

describe("toggleTaskDone", () => {
  it("ticks and unticks", () => {
    // Square brackets mean "selection" to run(), so build the state directly here.
    const tick = (doc: string) => {
      let state = EditorState.create({ doc, selection: { anchor: doc.length } });
      toggleTaskDone({ state, dispatch: (tr) => (state = tr.state) });
      return state.doc.toString();
    };
    expect(tick("- [ ] job")).toBe("- [x] job");
    expect(tick("  * [X] job")).toBe("  * [ ] job");
    expect(tick("plain")).toBe("plain");
  });
});

describe("insertLink", () => {
  it("uses the selection as the label and selects the url", () => {
    expect(run(insertLink, "see [docs] now")).toBe("see [docs]([url]) now");
  });
  it("uses a selected URL as the target", () => {
    expect(run(insertLink, "[https://x.io]")).toBe("[|](https://x.io)");
  });
});

describe("insertTable", () => {
  it("starts the table on its own line", () => {
    expect(run(insertTable, "text|")).toBe("text\n| |Column 1 | Column 2 |\n| --- | --- |\n|  |  |");
  });
});
