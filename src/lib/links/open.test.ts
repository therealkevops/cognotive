import { describe, expect, it } from "vitest";
import { openHow } from "./open";

const ev = (o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; button: number }>) => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  button: 0,
  ...o,
});

describe("openHow", () => {
  it("maps clicks and modifier keys to where a link opens", () => {
    // jsdom's navigator.platform isn't a Mac, so Ctrl is the modifier.
    expect(openHow(ev({}))).toBe("here");
    expect(openHow(ev({ ctrlKey: true }))).toBe("tab");
    expect(openHow(ev({ button: 1 }))).toBe("tab");
    expect(openHow(ev({ ctrlKey: true, altKey: true }))).toBe("side");
    expect(openHow(ev({ altKey: true }))).toBe("here");
  });
});
