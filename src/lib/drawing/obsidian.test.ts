import { compressToBase64 } from "lz-string";
import { describe, expect, it } from "vitest";
import { drawingJson, extractScene, replaceScene } from "./obsidian";

const scene = '{"type":"excalidraw","elements":[{"id":"a","type":"text","text":"[[Garden]]"}]}';
const plain = `---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n## Text Elements\n[[Garden]] ^a\n\n%%\n## Drawing\n\`\`\`json\n${scene}\n\`\`\`\n%%\n`;
const compressed = plain.replace("```json\n" + scene, "```compressed-json\n" + compressToBase64(scene));

describe("Obsidian Excalidraw files", () => {
  it("reads plain and compressed scenes", () => {
    expect(extractScene(plain)).toEqual({ json: scene, format: "json" });
    expect(extractScene(compressed)).toEqual({ json: scene, format: "compressed-json" });
    expect(drawingJson("D.excalidraw.md", compressed)).toBe(scene);
    expect(drawingJson("D.excalidraw", scene)).toBe(scene);
    expect(extractScene("# just a note")).toBeNull();
  });

  it("writes a new scene back in the same format, keeping the rest", () => {
    const next = scene.replace("Garden", "Shed");
    const out = replaceScene(compressed, next);
    expect(out).toContain("```compressed-json\n");
    expect(extractScene(out)?.json).toBe(next);
    expect(out.startsWith("---\nexcalidraw-plugin: parsed")).toBe(true);
    expect(out.endsWith("```\n%%\n")).toBe(true);
    expect(extractScene(replaceScene(plain, next))).toEqual({ json: next, format: "json" });
  });
});
