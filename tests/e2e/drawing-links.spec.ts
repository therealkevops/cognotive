import { expect, test, type Page } from "@playwright/test";

const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
const tree = (page: Page) => page.getByRole("tree", { name: "Vault files" });

async function newDrawing(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "New drawing" }).click();
  await expect(title(page)).toHaveValue("Drawing");
  const canvas = page.getByTestId("drawing").locator("canvas.interactive");
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  return (await canvas.boundingBox())!;
}

test("typing [[ in a drawing's text box suggests notes and links the box", async ({ page }) => {
  const box = await newDrawing(page);
  // Text tool, then click to place a text box.
  await page.mouse.click(box.x + box.width / 2 - 80, box.y + box.height / 2 - 80);
  await page.keyboard.press("t");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const editor = page.locator("textarea.excalidraw-wysiwyg");
  await expect(editor).toBeVisible();
  await page.keyboard.type("See [[Welc");

  const suggestions = page.getByRole("listbox", { name: "Link suggestions" });
  await expect(suggestions.getByRole("option", { name: /Welcome/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor).toHaveValue("See [[Welcome]]");
  await page.keyboard.press("Escape"); // finish editing the text
  await expect(page.getByTestId("drawing-notice")).toHaveText("Linked to Welcome");
  await expect(page.locator('[data-link-marker="note"]')).toHaveCount(1);
  await expect(page.getByRole("status")).toHaveText("Saved");

  // The drawing now links to Welcome: it shows up in Welcome's backlinks.
  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await expect(page.getByRole("region", { name: "Backlinks" }).getByRole("button", { name: "Drawing" })).toBeVisible();
});

test("linking a drawing to a note that doesn't exist yet says so", async ({ page }) => {
  const box = await newDrawing(page);
  await page.mouse.click(box.x + box.width / 2 - 80, box.y + box.height / 2 - 80);
  await page.keyboard.press("t");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const editor = page.locator("textarea.excalidraw-wysiwyg");
  await expect(editor).toBeVisible();
  await page.keyboard.type("[[Ideas");

  const create = page.getByRole("listbox", { name: "Link suggestions" }).getByRole("option", { name: /New note “Ideas”/ });
  await expect(create).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(editor).toHaveValue("[[Ideas]]");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("drawing-notice")).toContainText("a new note");
  await expect(page.locator('[data-link-marker="new"]')).toHaveCount(1);
});

test("the drawing toolbar links to notes and inserts vault images", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByLabel("Choose files to add").setInputFiles({
    name: "pic.png",
    mimeType: "image/png",
    // 1×1 transparent PNG
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
  });
  await expect(title(page)).toHaveValue("pic");

  await newDrawing(page);
  await page.getByRole("button", { name: "Link to note" }).click();
  await page.getByRole("dialog", { name: "Link to note" }).getByRole("option", { name: /Linking notes/ }).click();
  await page.getByRole("button", { name: "Insert image or drawing" }).click();
  await page.getByRole("dialog", { name: "Insert image or drawing" }).getByRole("option", { name: /pic\.png/ }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");

  const outgoing = page.getByRole("region", { name: "Outgoing links" });
  await expect(outgoing.getByRole("button", { name: "Linking notes" })).toBeVisible();
  await expect(outgoing.getByRole("button", { name: "pic.png" })).toBeVisible();
});
