import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fake-github";
import { editor, title, tree } from "./helpers";

/** A small red PNG, made in the page so it is a real image. */
async function pasteImage(page: Page) {
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 80;
    c.height = 40;
    const g = c.getContext("2d")!;
    g.fillStyle = "#e33";
    g.fillRect(0, 0, 80, 40);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "image.png", { type: "image/png" }));
    document
      .querySelector(".cm-content")!
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
}

async function drawRectangle(page: Page) {
  const canvas = page.getByTestId("drawing").locator("canvas.interactive");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = (await canvas.boundingBox())!;
  // Focus the canvas so the "r" (rectangle) shortcut reaches Excalidraw.
  await page.mouse.click(box.x + box.width / 2 - 60, box.y + box.height / 2 - 60);
  await page.keyboard.press("r");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

test("draw, then embed the drawing in a note", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "New drawing" }).click();
  await expect(title(page)).toHaveValue("Drawing");
  await expect(tree(page).getByRole("treeitem", { name: "Drawing" })).toBeVisible();
  await drawRectangle(page);
  await expect(page.getByRole("status")).toHaveText("Saving…");
  await expect(page.getByRole("status")).toHaveText("Saved");

  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("![[Drawing.excalidraw]]\n");
  await page.getByRole("radio", { name: "Reading" }).click();
  const img = page.getByTestId("reading-view").locator("img.embed-drawing");
  await expect(img).toHaveAttribute("src", /^blob:/, { timeout: 30_000 });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100);

  // Clicking the embed opens the drawing.
  await img.click();
  await expect(title(page)).toHaveValue("Drawing");
  await expect(page.getByTestId("drawing")).toBeVisible();
});

test("pasting an image saves it as an attachment and shows it", async ({ page }) => {
  await page.goto("/");
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await pasteImage(page);
  await expect(tree(page).getByRole("treeitem", { name: "attachments" })).toBeVisible();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toContainText(/!\[\[Pasted image \d{14}\.png\]\]/);

  await page.getByRole("radio", { name: "Reading" }).click();
  const img = page.getByTestId("reading-view").locator("img.embed-image");
  await expect(img).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(80);
});

test("files can be added from the computer and opened", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByLabel("Choose files to add").setInputFiles({
    name: "receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await expect(title(page)).toHaveValue("receipt");
  await expect(page.getByTestId("file-view").locator("iframe")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download receipt.pdf" })).toBeVisible();
});

test("attachments sync to GitHub as binary files", async ({ page }) => {
  const github = new FakeGitHub({ "Notes.md": "# Notes\n" });
  await github.install(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Repositories & sync" }).click();
  await dialog.getByRole("button", { name: "Connect a GitHub repository" }).click();
  await dialog.getByLabel("GitHub token").fill("github_pat_test");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("combobox", { name: /^Repository/ }).selectOption("me/notes");
  await dialog.getByRole("button", { name: "Connect and open" }).click();
  await expect(tree(page).getByRole("treeitem", { name: "Notes" })).toBeVisible();

  await tree(page).getByRole("treeitem", { name: "Notes" }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await pasteImage(page);
  await expect(tree(page).getByRole("treeitem", { name: "attachments" })).toBeVisible();
  await page.getByRole("button", { name: /unsynced/ }).click();
  await expect(page.getByRole("button", { name: /^Synced/ })).toBeVisible();

  const name = Object.keys(github.files()).find((p) => p.startsWith("attachments/"))!;
  const bytes = github.bytes(name)!;
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG signature
  expect(github.files()["Notes.md"]).toContain(`![[${name.slice("attachments/".length)}]]`);
});

test("a drawing's properties can be edited, are indexed, and survive drawing", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "New drawing" }).click();
  await expect(title(page)).toHaveValue("Drawing");
  await expect(page.getByTestId("drawing").locator("canvas.interactive")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Properties", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Drawing properties" });
  await panel.getByRole("button", { name: "Add property" }).click();
  await panel.getByRole("combobox", { name: "New property name" }).fill("tags");
  await page.keyboard.press("Enter");
  // Letters typed here go to the text box, not Excalidraw's tool shortcuts.
  await panel.getByRole("combobox", { name: "Add to tags" }).fill("sketches");
  await page.keyboard.press("Enter");
  await expect(panel).toContainText("#sketches");
  await expect(page.getByRole("status")).toHaveText("Saved");

  // The tag is in the Tags pane, and drawing keeps the properties.
  await page.getByRole("tab", { name: "Tags" }).click();
  await expect(page.getByRole("button", { name: "#sketches 1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await drawRectangle(page);
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(title(page)).toHaveValue("Drawing");
  await expect(page.getByTestId("drawing").locator("canvas.interactive")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Properties", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Drawing properties" })).toContainText("#sketches");
});

test("an image pasted into a drawing is also kept as an attachment, linked from the drawing", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "New drawing" }).click();
  await expect(title(page)).toHaveValue("Drawing");
  const canvas = page.getByTestId("drawing").locator("canvas.interactive");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // Paste a picture where Excalidraw listens for it.
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 60;
    const g = c.getContext("2d")!;
    g.fillStyle = "#3a6";
    g.fillRect(0, 0, 120, 60);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "image.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });

  // It lands in attachments/, like an image pasted into a note.
  await tree(page).getByRole("treeitem", { name: "attachments" }).click();
  const attachment = tree(page).getByRole("treeitem", { name: /^Pasted image \d{14}\.png/ });
  await expect(attachment).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status")).toHaveText("Saved");

  // The drawing links it, so it isn't counted as unused.
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: "Storage" }).click();
  await expect(dialog.getByRole("region", { name: "Unused attachments" })).toContainText("Every attachment in this repository is used");
  await page.keyboard.press("Escape");

  // And the image's file shows the drawing among its backlinks.
  await attachment.click();
  await expect(page.getByRole("region", { name: "Backlinks" }).getByRole("button", { name: /Drawing/ })).toBeVisible();
});

/** A text file as stored in the browser, read straight from the repository's database. */
async function stored(page: Page, path: string): Promise<string | undefined> {
  return page.evaluate(async (path) => {
    const id = JSON.parse(localStorage.getItem("noted-ai:activeVault") ?? '"default"') ?? "default";
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(`noted-ai:vault:${id}`);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const file = await new Promise<{ content?: string } | undefined>((resolve, reject) => {
      const r = db.transaction("files").objectStore("files").get(path);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return file?.content;
  }, path);
}

test("an Obsidian drawing's pictures come from its Embedded Files, and missing ones are named", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  // A picture made in the page, and an Obsidian vault with a drawing that links it (and one more).
  const png = Buffer.from(
    await page.evaluate(async () => {
      const c = new OffscreenCanvas(60, 40);
      const g = c.getContext("2d")!;
      g.fillStyle = "#36c";
      g.fillRect(0, 0, 60, 40);
      return [...new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer())];
    }),
  );
  const scene = {
    type: "excalidraw",
    version: 2,
    elements: [
      { id: "img1", type: "image", x: 0, y: 0, width: 60, height: 40, fileId: "f1", status: "saved", angle: 0, strokeColor: "transparent", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, scale: [1, 1], crop: null },
      { id: "img2", type: "image", x: 100, y: 0, width: 60, height: 40, fileId: "f2", status: "saved", angle: 0, strokeColor: "transparent", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", roughness: 0, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 2, version: 1, versionNonce: 2, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, scale: [1, 1], crop: null },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  };
  const md = [
    "---",
    "excalidraw-plugin: parsed",
    "---",
    "# Excalidraw Data",
    "## Text Elements",
    "## Embedded Files",
    "f1: [[Pasted Image 20230101.png]]",
    "f2: [[Gone.png]]",
    "",
    "%%",
    "## Drawing",
    "```json",
    JSON.stringify(scene),
    "```",
    "%%",
  ].join("\n");
  const { strToU8, zipSync } = await import("fflate");
  const zip = zipSync({ "Vault/Sketch.excalidraw.md": strToU8(md), "Vault/Attachments/Pasted Image 20230101.png": new Uint8Array(png) });
  await page.getByLabel("Choose a zip to import").setInputFiles({ name: "vault.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });

  await tree(page).getByRole("treeitem", { name: "Sketch" }).click();
  await expect(page.getByTestId("drawing").locator("canvas.interactive")).toBeVisible({ timeout: 30_000 });
  const missing = page.getByRole("status", { name: "Missing pictures" });
  await expect(missing).toContainText("A picture in this drawing isn't in this repository: Gone.png");
  await expect(missing).not.toContainText("Pasted Image");
  // Opening it changes nothing: the pictures aren't copied into the file.
  await page.waitForTimeout(800);
  expect(await stored(page, "Sketch.excalidraw.md")).toBe(md);

  // A picture pasted in is listed under Embedded Files, as the plugin would, not kept in the scene.
  const canvas = page.getByTestId("drawing").locator("canvas.interactive");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + 120);
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 30;
    c.height = 30;
    c.getContext("2d")!.fillRect(0, 0, 30, 30);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "image.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => (await stored(page, "Sketch.excalidraw.md")) ?? "", { timeout: 15_000 }).toMatch(/\nf2: \[\[Gone\.png\]\]\n[\w-]+: \[\[Pasted image \d{14}\.png\]\]/);
  const saved = (await stored(page, "Sketch.excalidraw.md"))!;
  const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(saved)![1]);
  expect(json.files).toEqual({});

  // The picture is linked from the drawing.
  await tree(page).getByRole("treeitem", { name: /^Attachments More/ }).click();
  await tree(page).getByRole("treeitem", { name: /^Pasted Image 20230101\.png/ }).click();
  await expect(page.getByRole("region", { name: "Backlinks" }).getByRole("button", { name: /Sketch/ })).toBeVisible();

  // Embedded in a note, the drawing shows it.
  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.type("![[Sketch.excalidraw]]\n");
  await page.getByRole("radio", { name: "Reading" }).click();
  const img = page.getByTestId("reading-view").locator("img.embed-drawing");
  await expect(img).toHaveAttribute("src", /^blob:/, { timeout: 30_000 });
  const svg = await img.evaluate(async (i: HTMLImageElement) => (await fetch(i.src)).text());
  expect(svg).toContain("<image");
});
