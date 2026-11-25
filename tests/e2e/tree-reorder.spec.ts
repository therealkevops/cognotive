import { expect, test, type Page } from "@playwright/test";
import { openApp, tree } from "./helpers";

const item = (page: Page, name: string) => tree(page).getByRole("treeitem", { name: new RegExp(`^${name} More actions`) });
/** The top-level rows' names, in order. */
const topRows = (page: Page) =>
  tree(page)
    .locator('[role="treeitem"][aria-level="1"]')
    .evaluateAll((els) => els.map((el) => el.querySelector("span.truncate")?.textContent ?? ""));

test("drag a file above or below another to reorder; it's kept, and Alt+arrows move it too", async ({ page }) => {
  await openApp(page);
  await expect.poll(() => topRows(page)).toEqual(["Linking notes", "Welcome"]);

  // Onto the top edge of "Linking notes": above it.
  const target = (await item(page, "Linking notes").boundingBox())!;
  await item(page, "Welcome").dragTo(item(page, "Linking notes"), { targetPosition: { x: 20, y: 2 } });
  await expect.poll(() => topRows(page)).toEqual(["Welcome", "Linking notes"]);
  expect(target.height).toBeGreaterThan(10);

  // Kept after a reload (in the repository's settings).
  await page.reload();
  await expect.poll(() => topRows(page)).toEqual(["Welcome", "Linking notes"]);

  // Alt+Down moves it back down.
  await item(page, "Welcome").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => topRows(page)).toEqual(["Linking notes", "Welcome"]);
  await expect(item(page, "Welcome")).toBeFocused();
});

test("onto a folder's middle moves into it; Sort A–Z goes back to the usual order", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const input = page.getByRole("textbox", { name: "New name" });
  await input.fill("Box");
  await input.press("Enter");
  await expect.poll(() => topRows(page)).toEqual(["Box", "Linking notes", "Welcome"]);

  // Box below Welcome.
  await item(page, "Box").dragTo(item(page, "Welcome"), { targetPosition: { x: 20, y: 28 } });
  await expect.poll(() => topRows(page)).toEqual(["Linking notes", "Welcome", "Box"]);

  // Linking notes into the middle of Box.
  const box = (await item(page, "Box").boundingBox())!;
  await item(page, "Linking notes").dragTo(item(page, "Box"), { targetPosition: { x: 20, y: box.height / 2 } });
  await expect(tree(page).getByRole("group").getByRole("treeitem", { name: /^Linking notes More/ })).toBeVisible();
  await expect.poll(() => topRows(page)).toEqual(["Welcome", "Box"]);

  // Back to folders first, by name.
  await item(page, "Welcome").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Sort the top level A–Z" }).click();
  await expect.poll(() => topRows(page)).toEqual(["Box", "Welcome"]);
  await item(page, "Welcome").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Sort the top level A–Z" })).toHaveCount(0);
});
