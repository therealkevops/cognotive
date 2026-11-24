import { compressToBase64 } from "lz-string";
import { describe, expect, it } from "vitest";
import { drawingJson, embeddedFiles, extractScene, replaceScene, retargetEmbeddedFiles, sceneWithEmbedded, withEmbeddedFiles } from "./obsidian";

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

describe("the plugin's embedded files", () => {
  const md = [
    "---",
    "excalidraw-plugin: parsed",
    "---",
    "# Excalidraw Data",
    "## Text Elements",
    "Hello ^abc",
    "",
    "## Embedded Files",
    "6a3cd3e7f5e0d1b2c3d4e5f60718293a4b5c6d7e: [[Pasted Image 20230101.png]]",
    "aa11: ![[Diagrams/flow.png|100%]]",
    "bb22: https://example.com/pic.png",
    "cc33: $$x^2$$",
    "",
    "%%",
    "## Drawing",
    "```json",
    '{"elements":[]}',
    "```",
    "%%",
  ].join("\n");

  it("lists the pictures the drawing keeps as files", () => {
    expect(embeddedFiles(md)).toEqual([
      { id: "6a3cd3e7f5e0d1b2c3d4e5f60718293a4b5c6d7e", target: "Pasted Image 20230101.png", url: false },
      { id: "aa11", target: "Diagrams/flow.png", url: false },
      { id: "bb22", target: "https://example.com/pic.png", url: true },
    ]);
    expect(embeddedFiles("## Drawing\n```json\n{}\n```")).toEqual([]);
    // The section's name in any case.
    expect(embeddedFiles("## Embedded files\nx1: [[a.png]]\n")).toEqual([{ id: "x1", target: "a.png", url: false }]);
  });

  it("adds new ones to the section, and keeps the drawing readable", () => {
    const out = withEmbeddedFiles(md, [
      { id: "aa11", target: "ignored.png" },
      { id: "dd44", target: "attachments/new.webp" },
    ]);
    expect(embeddedFiles(out).map((f) => f.id)).toEqual(["6a3cd3e7f5e0d1b2c3d4e5f60718293a4b5c6d7e", "aa11", "bb22", "dd44"]);
    expect(out).toContain("cc33: $$x^2$$\ndd44: [[attachments/new.webp]]\n\n%%\n## Drawing");
    expect(extractScene(out)?.json).toBe('{"elements":[]}');
    expect(withEmbeddedFiles(md, [{ id: "aa11", target: "x" }])).toBe(md);
  });

  it("makes the section before the drawing when there isn't one", () => {
    const plain = "# Excalidraw Data\n## Text Elements\n%%\n## Drawing\n```json\n{}\n```\n%%";
    const out = withEmbeddedFiles(plain, [{ id: "ee55", target: "pic.png" }]);
    expect(out).toBe("# Excalidraw Data\n## Text Elements\n## Embedded Files\nee55: [[pic.png]]\n\n%%\n## Drawing\n```json\n{}\n```\n%%");
    expect(embeddedFiles(out)).toEqual([{ id: "ee55", target: "pic.png", url: false }]);
  });
});

describe("sceneWithEmbedded", () => {
  const md = '## Embedded Files\nf1: [[a.png]]\nf2: [[gone.png]]\nf3: https://x.io/p.png\n\n%%\n## Drawing\n```json\n{"elements":[],"files":{}}\n```\n%%';
  it("fills in the pictures that can be loaded", async () => {
    const out = JSON.parse(
      await sceneWithEmbedded("D.excalidraw.md", md, async (t) => (t === "a.png" ? { dataURL: "data:image/png;base64,AA==", mimeType: "image/png" } : null)),
    );
    expect(Object.keys(out.files)).toEqual(["f1"]);
    expect(out.files.f1).toMatchObject({ id: "f1", dataURL: "data:image/png;base64,AA==", mimeType: "image/png" });
  });
  it("leaves plain drawings, and scenes it can't add to, as they are", async () => {
    const load = async () => ({ dataURL: "data:,", mimeType: "image/png" });
    expect(await sceneWithEmbedded("D.excalidraw", '{"elements":[]}', load)).toBe('{"elements":[]}');
    expect(await sceneWithEmbedded("D.excalidraw.md", md, async () => null)).toBe('{"elements":[],"files":{}}');
  });
});

describe("retargetEmbeddedFiles", () => {
  it("points entries at a renamed file, and leaves the rest", () => {
    const md = "## Embedded Files\nf1: [[old.png]]\nf2: [[keep.png|50%]]\nf3: [[old.png|100%]]\n\n%%\n## Drawing\n```json\n{}\n```";
    expect(retargetEmbeddedFiles(md, (t) => t === "old.png", "pics/new.webp")).toBe(
      "## Embedded Files\nf1: [[pics/new.webp]]\nf2: [[keep.png|50%]]\nf3: [[pics/new.webp|100%]]\n\n%%\n## Drawing\n```json\n{}\n```",
    );
    expect(retargetEmbeddedFiles(md, () => false, "x")).toBeNull();
    expect(retargetEmbeddedFiles("## Drawing", () => true, "x")).toBeNull();
  });
});
