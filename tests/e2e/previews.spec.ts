import { expect, test, type Page } from "@playwright/test";

const editor = (page: Page) => page.locator(".cm-content");
const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
const tree = (page: Page) => page.getByRole("tree", { name: "Vault files" });
const card = (page: Page) => page.getByRole("dialog", { name: "Link preview" });

async function openApp(page: Page) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
}

test("hovering a link shows the note rendered, and its title opens it", async ({ page }) => {
  await openApp(page);
  await editor(page).locator(".cm-wikilink", { hasText: "Linking notes" }).hover();
  await expect(card(page).getByRole("heading", { name: "Linking notes", level: 1 })).toBeVisible();
  await expect(card(page).locator("a.internal-link").first()).toBeVisible();
  await card(page).getByRole("button", { name: "Linking notes" }).click();
  await expect(title(page)).toHaveValue("Linking notes");
});

test("a heading link previews just that section", async ({ page }) => {
  await openApp(page);
  await tree(page).getByRole("treeitem", { name: "Linking notes" }).click();
  await editor(page).locator(".cm-wikilink", { hasText: "Link to a heading" }).hover();
  await expect(card(page).getByRole("button", { name: "Welcome › Formatting" })).toBeVisible();
  await expect(card(page).getByRole("heading", { name: "Formatting" })).toBeVisible();
  await expect(card(page).getByRole("heading", { name: "Welcome", level: 1 })).toHaveCount(0);
});

test("an image link previews the image", async ({ page }) => {
  await openApp(page);
  await page.getByLabel("Choose files to add").setInputFiles({
    name: "pic.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
  });
  await expect(title(page)).toHaveValue("pic");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await editor(page).click();
  await page.keyboard.type("See [[pic.png]] here.");
  await page.keyboard.press("Home");
  await editor(page).locator(".cm-wikilink").hover();
  await expect(card(page).locator("img")).toHaveAttribute("src", /^(blob|data):/);
});

test("previews can be limited to Ctrl/Cmd hovers", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("region", { name: "Appearance" }).getByLabel("Link previews on hover").selectOption("mod");
  await page.keyboard.press("Escape");

  const link = editor(page).locator(".cm-wikilink", { hasText: "Linking notes" });
  await link.hover();
  await page.waitForTimeout(800);
  await expect(card(page)).toHaveCount(0);

  const box = (await link.boundingBox())!;
  await page.keyboard.down("Control");
  await page.keyboard.down("Meta");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await expect(card(page)).toBeVisible();
  await page.keyboard.up("Meta");
  await page.keyboard.up("Control");
});
