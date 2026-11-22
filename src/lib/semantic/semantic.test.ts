import { describe, expect, it } from "vitest";
import { chunkNote, CHUNK_SIZE, contentHash, passageText } from "./chunk";
import { HashEmbedder, type Embedder } from "./embedder";
import { fuseResults } from "./hybrid";
import { MemoryVectorStore, SemanticIndex } from "./semantic-index";

describe("chunkNote", () => {
  it("splits by heading, keeps offsets, and skips frontmatter", () => {
    const note = "---\ntags: [x]\n---\n# Garden\n\nTomatoes in May.\n\n## Watering\n\nEvery Tuesday.\n\n```\n# not a heading\n```\n";
    const chunks = chunkNote(note);
    expect(chunks.map((c) => [c.heading, c.text])).toEqual([
      ["Garden", "Tomatoes in May."],
      ["Watering", "Every Tuesday.\n\n```\n# not a heading\n```"],
    ]);
    expect(note.slice(chunks[1].from, chunks[1].from + 14)).toBe("Every Tuesday.");
    expect(passageText("Garden", chunks[1])).toMatch(/^Garden › Watering\nEvery Tuesday/);
  });

  it("packs short paragraphs and cuts long ones at sentences", () => {
    const sentence = "This sentence is about forty-five characters. ";
    const note = Array.from({ length: 40 }, () => sentence).join("");
    const chunks = chunkNote(note);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(CHUNK_SIZE * 1.5);
    expect(chunks[0].text.endsWith(".")).toBe(true);
    expect(chunkNote("a\n\nb\n\nc").map((c) => c.text)).toEqual(["a\n\nb\n\nc"]);
  });

  it("fingerprints text", () => {
    expect(contentHash("a")).toBe(contentHash("a"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
});

/** Counts how many passages were embedded, to check only changes are redone. */
class CountingEmbedder implements Embedder {
  readonly id = "count";
  readonly minScore = 0.2;
  passages = 0;
  private inner = new HashEmbedder();
  async embed(texts: string[], kind: "query" | "passage") {
    if (kind === "passage") this.passages += texts.length;
    return this.inner.embed(texts);
  }
}

const notes = [
  { path: "Garden.md", title: "Garden", content: "# Garden\n\nWater the tomatoes every morning.\n\n## Soil\n\nCompost and mulch." },
  { path: "Bread.md", title: "Bread", content: "# Bread\n\nSourdough starter, flour and water." },
  { path: "Budget.md", title: "Budget", content: "# Budget\n\nQuarterly finance review." },
];

describe("SemanticIndex", () => {
  it("embeds notes once, redoes only changed ones, and forgets removed ones", async () => {
    const store = new MemoryVectorStore();
    const e = new CountingEmbedder();
    const ix = new SemanticIndex(store, e);
    const progress: string[] = [];
    await ix.sync(notes, { onProgress: (d, t) => progress.push(`${d}/${t}`) });
    expect(progress).toEqual(["0/3", "1/3", "2/3", "3/3"]);
    expect(e.passages).toBe(4);
    expect(store.notes.size).toBe(3);

    await ix.sync([{ ...notes[0], content: notes[0].content + "\n\nAlso beans." }, notes[1]]);
    expect(e.passages).toBe(4 + 2);
    expect(ix.size).toBe(2);
    expect(store.notes.has("Budget.md")).toBe(false);

    // A fresh index loads from the store without embedding again.
    const again = new SemanticIndex(store, e);
    await again.sync([{ ...notes[0], content: notes[0].content + "\n\nAlso beans." }, notes[1]]);
    expect(e.passages).toBe(6);
  });

  it("drops vectors from another model", async () => {
    const store = new MemoryVectorStore();
    await new SemanticIndex(store, new HashEmbedder()).sync(notes);
    const other = new SemanticIndex(store, new CountingEmbedder());
    await other.load();
    expect(other.size).toBe(0);
    expect(store.notes.size).toBe(0);
  });

  it("finds notes by their best passage, and similar notes", async () => {
    const ix = new SemanticIndex(new MemoryVectorStore(), new HashEmbedder());
    await ix.sync([...notes, { path: "Tomatoes.md", title: "Tomatoes", content: "Tomatoes need water and compost." }]);
    const hits = await ix.search("water tomatoes every morning");
    expect(hits[0]).toMatchObject({ path: "Garden.md", heading: "Garden" });
    expect(hits.map((h) => h.path)).toContain("Tomatoes.md");
    expect(hits.map((h) => h.path)).not.toContain("Budget.md");
    expect(ix.similar("Garden.md")[0].path).toBe("Tomatoes.md");
    expect(await ix.search("   ")).toEqual([]);
  });

  it("stops when aborted", async () => {
    const ctrl = new AbortController();
    const ix = new SemanticIndex(new MemoryVectorStore(), new HashEmbedder());
    await ix.sync(notes, { signal: ctrl.signal, onProgress: (d) => d === 1 && ctrl.abort() });
    expect(ix.size).toBe(1);
  });
});

describe("fuseResults", () => {
  it("ranks notes found both ways first, then by rank in either list", () => {
    const words = [
      { path: "A.md", title: "A", snippet: "a", matches: [[0, 1]] as Array<[number, number]>, score: 3 },
      { path: "B.md", title: "B", snippet: "b", matches: [], score: 2 },
    ];
    const meaning = [
      { path: "C.md", score: 0.8, from: 10, preview: "about  c", heading: "Intro" },
      { path: "B.md", score: 0.7, from: 0, preview: "b" },
    ];
    const r = fuseResults(words, meaning, (p) => p.replace(".md", ""));
    expect(r.map((h) => [h.path, h.via])).toEqual([
      ["B.md", "both"],
      ["A.md", "words"],
      ["C.md", "meaning"],
    ]);
    expect(r[2]).toMatchObject({ title: "C", snippet: "about c", from: 10, heading: "Intro" });
  });
});
