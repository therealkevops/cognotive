import { describe, expect, it } from "vitest";
import { withoutTitle } from "./card-text";

describe("withoutTitle", () => {
  it("drops a first heading that repeats the title", () => {
    expect(withoutTitle("# Linking notes\n\nType [[", "Linking notes")).toBe("\nType [[");
    expect(withoutTitle("\n#  plan ##\nBody", "Plan")).toBe("Body");
    expect(withoutTitle("# Plan", "Plan")).toBe("");
  });

  it("keeps other headings and text", () => {
    expect(withoutTitle("# Something else\nBody", "Plan")).toBe("# Something else\nBody");
    expect(withoutTitle("## Plan\nBody", "Plan")).toBe("## Plan\nBody");
    expect(withoutTitle("Intro\n# Plan", "Plan")).toBe("Intro\n# Plan");
  });
});
