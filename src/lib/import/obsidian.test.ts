import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { LocalStore } from "../vault/local-store";
import { isBinary } from "../vault/paths";
import { importInto, obsidianSettings, settingsFile, vaultFolder } from "./obsidian";

describe("vaultFolder", () => {
  it("drops the folder's name, leaves out Obsidian's and system files, keeps its settings aside", () => {
    const picked = [
      "Brain/Notes/Plan.md",
      "Brain/Welcome.md",
      "Brain/Attachments/photo 1.png",
      "Brain/Drawings/Sketch.excalidraw.md",
      "Brain/.obsidian/app.json",
      "Brain/.obsidian/daily-notes.json",
      "Brain/.obsidian/plugins/x/main.js",
      "Brain/.obsidian/workspace.json",
      "Brain/.trash/Old.md",
      "Brain/.git/HEAD",
      "Brain/Notes/.DS_Store",
      "Brain/.hidden/secret.md",
    ].map((relativePath) => ({ relativePath, file: relativePath }));
    const v = vaultFolder(picked);
    expect(v.name).toBe("Brain");
    expect(v.files.map((f) => f.path)).toEqual([
      "Attachments/photo 1.png",
      "Drawings/Sketch.excalidraw.md",
      "Notes/Plan.md",
      "Welcome.md",
    ]);
    expect([...v.config.keys()]).toEqual(["app.json", "daily-notes.json", "workspace.json"]);
    expect(v.files.find((f) => f.path === "Welcome.md")?.file).toBe("Brain/Welcome.md");
  });
});

describe("obsidianSettings", () => {
  it("carries over what this app can do", () => {
    expect(
      obsidianSettings({
        app: { attachmentFolderPath: "Assets/Images", useMarkdownLinks: true, newFileLocation: "folder", newFileFolderPath: "/Inbox/" },
        daily: { folder: "Journal/Daily", format: "YYYY-MM-DD ddd", template: "Templates/Daily" },
        templates: { folder: "Templates" },
      }),
    ).toEqual({
      attachmentFolder: "Assets/Images",
      linkFormat: "markdown",
      newNoteLocation: "folder",
      newNoteFolder: "Inbox",
      dailyFolder: "Journal/Daily",
      dailyFormat: "YYYY-MM-DD ddd",
      dailyTemplate: "Templates/Daily.md",
      templateFolder: "Templates",
    });
  });

  it("leaves out what has no match here, and what wasn't set", () => {
    expect(obsidianSettings({ app: { attachmentFolderPath: "./", newFileLocation: "current" } })).toEqual({ newNoteLocation: "current" });
    expect(obsidianSettings({ app: { attachmentFolderPath: "/" }, daily: { folder: "" } })).toEqual({ dailyFolder: "" });
    expect(obsidianSettings({})).toEqual({});
    expect(obsidianSettings({ app: "nonsense", daily: null })).toEqual({});
  });

  it("writes a complete settings file", () => {
    const json = JSON.parse(settingsFile({ attachmentFolder: "Assets" }));
    expect(json.attachmentFolder).toBe("Assets");
    expect(json.dailyFolder).toBe("Daily");
  });
});

describe("importInto", () => {
  it("writes notes as text, attachments as bytes, then the settings, reporting progress", async () => {
    const store = new LocalStore("obsidian-import-test");
    const steps: string[] = [];
    const n = await importInto(
      store,
      [
        { path: "Notes/Plan.md", file: new Blob(["# Plan\nSee [[photo.png]]"]) },
        { path: "Attachments/photo.png", file: new Blob([new Uint8Array([137, 80, 78, 71])]) },
      ],
      settingsFile({ attachmentFolder: "Attachments" }),
      isBinary,
      (done, total) => steps.push(`${done}/${total}`),
    );
    expect(n).toBe(2);
    expect(steps).toEqual(["0/2", "1/2", "2/2"]);
    expect((await store.read("Notes/Plan.md"))?.content).toBe("# Plan\nSee [[photo.png]]");
    expect([...(await store.readBinary("Attachments/photo.png"))!]).toEqual([137, 80, 78, 71]);
    expect(JSON.parse((await store.read(".noted/settings.json"))!.content).attachmentFolder).toBe("Attachments");
    await store.close();
  });
});
