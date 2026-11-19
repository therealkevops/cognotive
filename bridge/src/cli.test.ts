// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cleanOrigin, parseArgs } from "./cli";

describe("cli", () => {
  it("reads commands and flags", () => {
    expect(parseArgs(["bridge", "--origin", "https://a.example", "--origin=https://b.example", "--port", "5000", "--new-code"])).toEqual({
      command: "bridge",
      flags: { origin: ["https://a.example", "https://b.example"], port: ["5000"], "new-code": ["true"] },
      positional: [],
    });
    expect(parseArgs(["mcp", "~/notes", "--read-only"])).toMatchObject({ positional: ["~/notes"], flags: { "read-only": ["true"] } });
  });
  it("keeps only the origin of an address", () => {
    expect(cleanOrigin("https://notes.example.com/page?x=1")).toBe("https://notes.example.com");
    expect(() => cleanOrigin("ftp://x")).toThrow("Not a web address");
  });
});
