// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The app never shows or writes emoji: not in its text, its messages, or what
 * it writes into notes. The task parser is the one exception, because it has to
 * read the emoji markers Obsidian's Tasks plugin puts in people's notes.
 */
const ROOTS = ["src", "bridge/src"];
const EXCEPT = ["src/lib/tasks/tasks.ts"];
// Arrows drawn as plain text, not emoji.
const ALLOWED = new Set(["↗", "↔"]);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.(tsx?|css|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("no emoji", () => {
  it("appear in the app's code", () => {
    const found: string[] = [];
    for (const f of ROOTS.flatMap(files)) {
      if (EXCEPT.includes(f.split(path.sep).join("/"))) continue;
      fs.readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(/\p{Extended_Pictographic}|\u{FE0F}/gu)) {
            if (!ALLOWED.has(m[0])) found.push(`${f}:${i + 1} ${m[0]}`);
          }
        });
    }
    expect(found).toEqual([]);
  });
});
