import { expect, test, type Page } from "@playwright/test";

/** Accepts the highlighted suggestion (the editor ignores Enter for a moment after the list changes). */
async function accept(page: Page) {
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
}

test("properties are suggested, explained and checked as you type", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await editor.click();
  await page.keyboard.type("---");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("---");
  await page.keyboard.press("ArrowUp");

  // Names, with what each one does.
  await page.keyboard.type("ta");
  const list = page.locator(".cm-tooltip-autocomplete");
  await expect(list.getByRole("option", { name: /^tags/ })).toBeVisible();
  await expect(page.locator(".cm-completionInfo")).toContainText("Tags for the note");
  await accept(page);
  // tags: [] with the cursor inside, and the repository's tags offered.
  await expect(list.getByRole("option", { name: /^guide/ })).toBeVisible();
  await page.keyboard.type("gu");
  await expect(list.getByRole("option").first()).toHaveText(/^guide/);
  await accept(page);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");

  await page.keyboard.type("hu");
  await expect(list.getByRole("option").first()).toHaveText(/^hub/);
  await accept(page);
  await expect(list.getByRole("option", { name: /^true/ })).toBeVisible();
  await page.keyboard.type("maybe");
  await page.keyboard.press("Escape");
  await expect(editor).toContainText("tags: [guide]hub: maybe");

  // A wrong value is underlined, with a message on hover.
  const warning = editor.locator(".cm-lintRange-warning");
  await expect(warning).toHaveCount(1);
  await warning.hover();
  await expect(page.locator(".cm-tooltip-lint")).toContainText("hub should be true or false");

  // Hovering a name explains it.
  await editor.getByText("tags: [guide]").hover({ position: { x: 8, y: 8 } });
  await expect(page.locator(".cm-property-doc")).toContainText("Tags for the note");
});
