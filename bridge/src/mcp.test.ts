// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { NoteFolder } from "./folder";
import { mcpServer } from "./mcp";

function folderWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "noted-ai-mcp-"));
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(path.join(root, p), c);
  }
  return root;
}
const files = {
  "Cooking.md": "---\nhub: true\n---\n# Cooking\n\n## Notes\n\n- [[Bread]]\n",
  "Recipes/Bread.md": "# Bread\n\nSourdough needs a starter. Goes with Soup.\n",
  "Recipes/Soup.md": "# Soup\n\nLentils.\n",
  ".git/HEAD": "ref: refs/heads/main\n",
  "node_modules/x/README.md": "# not a note\n",
};

const call = async (server: ReturnType<typeof mcpServer>, name: string, args: object) =>
  (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) as {
    result: { content: Array<{ text: string }>; isError?: boolean };
  });

describe("MCP server", () => {
  it("introduces itself and lists the tools", async () => {
    const s = mcpServer(new NoteFolder(folderWith(files)), { version: "1.0" });
    const init = (await s.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } })) as { result: Record<string, unknown> };
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "noted-ai" } });
    expect(await s.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const list = (await s.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as { result: { tools: Array<{ name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }> } };
    const names = list.result.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["search_notes", "read_note", "create_note", "add_link"]));
    expect(list.result.tools.find((t) => t.name === "read_note")!.annotations.readOnlyHint).toBe(true);
    expect(list.result.tools[0].inputSchema.type).toBe("object");
    const ro = mcpServer(new NoteFolder(folderWith(files)), { readOnly: true });
    expect(((await ro.handle({ jsonrpc: "2.0", id: 3, method: "tools/list" })) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name)).not.toContain("create_note");
    expect(await s.handle({ jsonrpc: "2.0", id: 4, method: "nope" })).toMatchObject({ error: { code: -32601 } });
  });

  it("searches and reads the folder, skipping hidden folders and node_modules", async () => {
    const s = mcpServer(new NoteFolder(folderWith(files)));
    const hits = JSON.parse((await call(s, "search_notes", { query: "sourdough" })).result.content[0].text);
    expect(hits.results[0].path).toBe("Recipes/Bread.md");
    expect((await call(s, "read_note", { path: "Bread" })).result.content[0].text).toContain("Sourdough needs a starter");
    expect(JSON.parse((await call(s, "list_folder", { path: "" })).result.content[0].text)).toMatchObject({ folders: ["Recipes"], files: ["Cooking.md"] });
    expect(JSON.parse((await call(s, "list_hubs", {})).result.content[0].text).hubs[0].path).toBe("Cooking.md");
  });

  it("writes changes to disk, and sees edits made outside it", async () => {
    const root = folderWith(files);
    const s = mcpServer(new NoteFolder(root));
    expect((await call(s, "add_link", { from: "Bread", to: "Soup" })).result.content[0].text).toBe("Done: Link Soup from Bread (Recipes/Bread.md).");
    expect(fs.readFileSync(path.join(root, "Recipes/Bread.md"), "utf8")).toContain("Goes with [[Soup]].");
    await call(s, "create_note", { path: "Recipes/Stew", content: "# Stew\n\nWith [[Bread]].", properties: { tags: ["food"] } });
    expect(fs.readFileSync(path.join(root, "Recipes/Stew.md"), "utf8")).toBe("---\ntags: [food]\n---\n# Stew\n\nWith [[Bread]].\n");
    await call(s, "set_property", { path: "Soup", key: "status", value: "draft" });
    expect(fs.readFileSync(path.join(root, "Recipes/Soup.md"), "utf8")).toBe("---\nstatus: draft\n---\n# Soup\n\nLentils.\n");
    // Edited by someone else meanwhile: the next call sees it.
    fs.writeFileSync(path.join(root, "Recipes/Soup.md"), "# Soup\n\nRed lentils and cumin.\n");
    expect((await call(s, "read_note", { path: "Soup" })).result.content[0].text).toContain("cumin");
    expect(JSON.parse((await call(s, "get_links", { path: "Bread" })).result.content[0].text).backlinks.map((b: { from: string }) => b.from)).toContain("Recipes/Stew.md");
  });

  it("refuses paths outside the folder", async () => {
    const root = folderWith(files);
    const s = mcpServer(new NoteFolder(root));
    expect((await call(s, "create_note", { path: "../escape", content: "x" })).result.content[0].text).toContain("Can't use");
    expect(fs.existsSync(path.join(root, "../escape.md"))).toBe(false);
    // And underneath, the folder itself won't write outside.
    expect(() => new NoteFolder(root).write("../escape.md", "x")).toThrow("outside the notes folder");
  });

  it("speaks JSON lines over stdio", async () => {
    const s = mcpServer(new NoteFolder(folderWith(files)));
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    output.on("data", (d) => lines.push(...String(d).trim().split("\n")));
    const done = s.listen(input, output);
    input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n");
    input.write("not json\n");
    input.end();
    await done;
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
    ]);
  });
});
