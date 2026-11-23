import { describe, expect, it } from "vitest";
import { markWords, snippet } from "./snippet";

describe("snippet", () => {
  it("shows links as their words, marked", () => {
    expect(snippet("- [[Welcome#Formatting|Link to a heading]] with `#`, and change the text")).toEqual([
      { text: "Link to a heading", link: true },
      { text: " with #, and change the text" },
    ]);
    expect(snippet("![[Welcome#Maths and diagrams]]")).toEqual([{ text: "Welcome › Maths and diagrams", link: true }]);
    expect(snippet("See [[Garden]] and [the site](https://x.io).")).toEqual([
      { text: "See " },
      { text: "Garden", link: true },
      { text: " and " },
      { text: "the site", link: true },
      { text: "." },
    ]);
    expect(snippet("Back to [[#Top]]")).toEqual([{ text: "Back to " }, { text: "Top", link: true }]);
  });

  it("keeps code spans as they are: brackets in one aren't a link", () => {
    expect(snippet("Type `[[` to link another note, such as [[Welcome]].")).toEqual([
      { text: "Type [[ to link another note, such as " },
      { text: "Welcome", link: true },
      { text: "." },
    ]);
  });

  it("takes out markdown around the words", () => {
    expect(snippet("## A **bold** and _soft_ ==plan==")).toEqual([{ text: "A bold and soft plan" }]);
    expect(snippet("- [ ] Ask about snake_case_names")).toEqual([{ text: "Ask about snake_case_names" }]);
    expect(snippet("> quoted")).toEqual([{ text: "quoted" }]);
  });
});

describe("markWords", () => {
  it("marks the first appearance outside links", () => {
    expect(markWords(snippet("[[Welcome]] says Welcome is a good start"), "welcome")).toEqual([
      { text: "Welcome", link: true },
      { text: " says " },
      { text: "Welcome", mark: true },
      { text: " is a good start" },
    ]);
    expect(markWords([{ text: "nothing" }], "else")).toEqual([{ text: "nothing" }]);
  });
});
