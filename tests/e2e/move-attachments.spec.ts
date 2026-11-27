import { expect, test, type Page } from "@playwright/test";
import { editor, openApp, tree } from "./helpers";

/** What's inside the Archive folder (opened by the move). */
const inArchive = (page: Page, name: RegExp) =>
  tree(page).locator('[role="none"]').filter({ has: page.getByRole("treeitem", { name: /^Archive More/ }) }).getByRole("group").getByRole("treeitem", { name });
const item = (page: Page, name: string) => tree(page).getByRole("treeitem", { name: new RegExp(`^${name.replace(".", "\\.")} More actions`) });
/** A 1×1 PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

async function setUp(page: Page) {
  await openApp(page);
  // Two pictures: one only Welcome uses, one Linking notes uses too.
  await page.getByLabel("Choose files to add").setInputFiles([
    { name: "own.png", mimeType: "image/png", buffer: PNG },
    { name: "shared.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(tree(page).getByRole("treeitem", { name: /^attachments More/ })).toBeVisible();
  for (const [note, text] of [
    ["Welcome", "\n\n![[own.png]] ![[shared.png]]"],
    ["Linking notes", "\n\n![[shared.png]]"],
  ] as const) {
    await item(page, note).click();
    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(text);
    await expect(editor(page)).toContainText(text.trim().split(" ")[0]);
  }
  await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("textbox", { name: "New name" }).fill("Archive");
  await page.keyboard.press("Enter");
  await expect(item(page, "Archive")).toBeVisible();
}

test("moving a note brings the attachments only it uses", async ({ page }) => {
  await setUp(page);
  await item(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const picker = page.getByRole("dialog", { name: "Move Welcome.md to…" });
  const bring = picker.getByRole("checkbox", { name: /Bring its attachment along/ });
  await expect(bring).toBeChecked();
  await expect(picker).toContainText("own.png: only this note uses it");
  await expect(picker).not.toContainText("shared.png");
  await picker.getByRole("combobox").fill("Archive");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Moved with 1 attachment." })).toBeVisible();

  await expect(inArchive(page, /^Welcome More/)).toBeVisible();
  await expect(inArchive(page, /^own\.png More/)).toBeVisible();
  // The shared one stays.
  await expect(tree(page).getByRole("treeitem", { name: /^shared\.png More/ })).toHaveCount(1);
  await expect(inArchive(page, /^shared\.png More/)).toHaveCount(0);
  // And Welcome still embeds it: it's in the picture's backlinks.
  await inArchive(page, /^own\.png More/).click();
  await expect(page.getByRole("region", { name: "Backlinks" }).getByRole("button", { name: "Welcome" })).toBeVisible();
});

test("the attachments can be left where they are", async ({ page }) => {
  await setUp(page);
  await item(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to…" }).click();
  const picker = page.getByRole("dialog", { name: "Move Welcome.md to…" });
  await picker.getByRole("checkbox", { name: /Bring its attachment along/ }).uncheck();
  await picker.getByRole("combobox").fill("Archive");
  await page.keyboard.press("Enter");
  await expect(inArchive(page, /^Welcome More/)).toBeVisible();
  await expect(inArchive(page, /^own\.png More/)).toHaveCount(0);
  await expect(tree(page).getByRole("treeitem", { name: /^own\.png More/ })).toHaveCount(1);
});
