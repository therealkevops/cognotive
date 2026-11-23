import { expect, test } from "@playwright/test";
import { editor, openApp, title } from "./helpers";

for (const mode of ["Source", "Live preview"] as const) {
  test(`${mode}: Enter on an empty list item ends the list, or moves a nested one out`, async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "New note", exact: true }).click();
    await expect(title(page)).toHaveValue("Untitled");
    await page.getByRole("radio", { name: mode }).click();
    await editor(page).click();

    // Enter continues a task list; Enter on the empty item ends it.
    await page.keyboard.type("- [ ] Buy milk");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Buy eggs");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Back to writing.");

    // A nested bullet steps out to its parent's level first.
    await page.keyboard.press("Enter");
    await page.keyboard.type("- Fruit");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Apples");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Veg");

    await page.getByRole("radio", { name: "Source" }).click();
    await expect(editor(page).locator(".cm-line")).toHaveText(["- [ ] Buy milk", "- [ ] Buy eggs", "Back to writing.", "- Fruit", /^\s+- Apples$/, "- Veg"]);
  });
}
