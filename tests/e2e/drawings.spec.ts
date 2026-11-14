import { expect, test, type Page } from "@playwright/test";
import { FakeGitHub } from "./fake-github";

const editor = (page: Page) => page.locator(".cm-content");
const tree = (page: Page) => page.getByRole("tree", { name: "Vault files" });
const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });

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
  await dialog.getByRole("button", { name: "Connect a GitHub repository" }).click();
  await dialog.getByRole("combobox").first().selectOption("me/notes");
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
