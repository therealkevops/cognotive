import { strToU8, zipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";

const editor = (page: Page) => page.locator(".cm-content");
const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
const tree = (page: Page) => page.getByRole("tree", { name: "Repository files" });

async function openApp(page: Page) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
}

test("a note created from a link goes in the linking note's folder", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const name = page.getByRole("textbox", { name: "New name" });
  await name.fill("Work");
  await name.press("Enter");
  const folder = tree(page).getByRole("treeitem", { name: "Work" });
  await folder.hover();
  await page.getByRole("button", { name: "New note in Work" }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await editor(page).click();
  await page.keyboard.type("Next: [[Roadmap]]");
  await page.keyboard.press("Alt+Enter");

  const dialog = page.getByRole("dialog", { name: "Create note" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Roadmap");
  await expect(dialog.getByLabel("Folder")).toHaveValue("Work");
  await page.keyboard.press("Enter");
  await expect(title(page)).toHaveValue("Roadmap");
  await expect(tree(page).getByRole("treeitem", { name: "Roadmap" })).toHaveAttribute("aria-level", "2");
});

test("cancelling the prompt creates nothing", async ({ page }) => {
  await openApp(page);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n[[Scratch]]");
  await page.keyboard.press("Alt+Enter");
  await page.getByRole("dialog", { name: "Create note" }).getByRole("button", { name: "Cancel" }).click();
  await expect(title(page)).toHaveValue("Welcome");
  await expect(tree(page).getByRole("treeitem", { name: "Scratch" })).toHaveCount(0);
});

test("Repository health lists broken links, orphans and hubs, and creates missing notes", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Repository health" }).click();
  const dialog = page.getByRole("dialog", { name: "Repository health" });
  const list = dialog.getByRole("tabpanel");
  // The summary: a score with a verdict, totals and recent activity.
  await expect(dialog.getByRole("img", { name: /^Health score \d+ out of 100$/ })).toBeVisible();
  await expect(dialog.getByTestId("health-verdict")).not.toBeEmpty();
  await expect(dialog.getByRole("region", { name: "Summary" })).toContainText("Connected");
  await expect(dialog.getByRole("img", { name: /last changed in the past 26 weeks/ })).toBeVisible();
  await expect(dialog.getByRole("img", { name: /^Link map: 2 notes, \d+ links?, 1 missing note$/ })).toBeVisible();
  await expect(list).toContainText("Ideas");
  await expect(list).toContainText("Linked from Linking notes");

  await dialog.getByRole("tab", { name: /Hubs/ }).click();
  await expect(dialog.getByRole("tabpanel", { name: "Hubs" })).toContainText("Nothing here");
  await dialog.getByRole("tab", { name: /Broken links/ }).click();
  await dialog.getByRole("tabpanel").getByRole("button", { name: "Create Ideas" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("dialog", { name: "Create note" }).getByRole("button", { name: "Create" }).click();
  await expect(title(page)).toHaveValue("Ideas");

  // The link map shows notes and the missing note; clicking a note opens it.
  await page.getByRole("button", { name: "Repository health" }).click();
  const map = dialog.getByRole("region", { name: "Link map" });
  await expect(map.getByRole("img", { name: /^Link map: 3 notes, \d+ links, 0 missing notes$/ })).toBeVisible();
  await map.getByRole("button", { name: "Open Welcome" }).click();
  await expect(dialog).toBeHidden();
  await expect(title(page)).toHaveValue("Welcome");

  // The new note is linked from Linking notes, but doesn't link anywhere itself: a dead end.
  await page.getByRole("button", { name: "Repository health" }).click();
  await dialog.getByRole("tab", { name: /Dead ends/ }).click();
  await expect(dialog.getByRole("tabpanel", { name: "Dead ends" }).getByRole("button", { name: "Ideas", exact: true })).toBeVisible();
  await dialog.getByRole("tabpanel", { name: "Dead ends" }).getByRole("button", { name: "Ideas", exact: true }).click();
  await expect(dialog).toBeHidden();
});

test("Repository health quick fixes link mentions, ignore notes and count what's fixed", async ({ page }) => {
  await openApp(page);
  const zip = zipSync({
    "V/Alpha.md": strToU8("nothing to see"),
    "V/Beta.md": strToU8("I like Alpha a lot."),
    "V/Gamma.md": strToU8("See [[Beta]]."),
  });
  await page.getByLabel("Choose a zip to import").setInputFiles({ name: "v.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await expect(page.getByRole("status").filter({ hasText: "Imported 3 files" })).toBeVisible();

  await page.getByRole("button", { name: "Repository health" }).click();
  const dialog = page.getByRole("dialog", { name: "Repository health" });
  await dialog.getByRole("tab", { name: /Orphans/ }).click();
  const orphans = dialog.getByRole("tabpanel", { name: "Orphans" });
  await expect(orphans).toContainText("Mentioned in Beta: “I like Alpha a lot.”");
  await orphans.getByRole("button", { name: "Link Alpha from Beta" }).click();
  await expect(orphans.getByRole("button", { name: "Alpha", exact: true })).toHaveCount(0);
  // Alpha is no longer an orphan, and Beta no longer a dead end.
  await expect(dialog.getByRole("status")).toHaveText(/2 issues fixed today/);

  // Gamma links nowhere but Beta, so it isn't a dead end; Alpha still is. Ignore it.
  await dialog.getByRole("tab", { name: /Dead ends/ }).click();
  const deadEnds = dialog.getByRole("tabpanel", { name: "Dead ends" });
  await deadEnds.getByRole("button", { name: "Ignore Alpha" }).click();
  await expect(deadEnds.getByRole("button", { name: "Alpha", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Check them again" }).click();
  await expect(deadEnds.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Close repository health" }).click();
  await tree(page).getByRole("treeitem", { name: "Beta" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(page.locator(".cm-content")).toHaveText("I like [[Alpha]] a lot.");
});

test("a note can be marked as a hub, and missing notes many link to are hubs waiting to be written", async ({ page }) => {
  await openApp(page);
  const zip = zipSync({
    "V/A.md": strToU8("[[Recipes]]"),
    "V/B.md": strToU8("[[Recipes]]"),
    "V/C.md": strToU8("[[Recipes]]"),
  });
  await page.getByLabel("Choose a zip to import").setInputFiles({ name: "v.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await expect(page.getByRole("status").filter({ hasText: "Imported 3 files" })).toBeVisible();

  // Welcome is open: pin it from the command palette.
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("pin this note");
  await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page).locator(".cm-line").first()).toHaveText("---");
  await expect(editor(page)).toContainText("hub: true");

  await page.getByRole("button", { name: "Repository health" }).click();
  const dialog = page.getByRole("dialog", { name: "Repository health" });
  await dialog.getByRole("tab", { name: /Hubs/ }).click();
  const hubs = dialog.getByRole("tabpanel", { name: "Hubs" });
  await expect(hubs).toContainText("Recipeswaiting to be written");
  // The link map shows it as a hub to write.
  const map = dialog.getByRole("region", { name: "Link map" });
  await expect(map.getByRole("img", { name: /1 hub waiting to be written$/ })).toBeVisible();
  await expect(map).toContainText("Hubs to write (1)");
  await expect(map.getByRole("button", { name: "Create Recipes" })).toBeVisible();
  await expect(hubs).toContainText("Welcomepinned");
  await hubs.getByRole("button", { name: "Unpin Welcome" }).click();
  await expect(hubs).not.toContainText("Welcomepinned");
  await hubs.getByRole("button", { name: "Create hub Recipes" }).click();
  await page.getByRole("dialog", { name: "Create note" }).getByRole("button", { name: "Create" }).click();
  await expect(title(page)).toHaveValue("Recipes");
});

test("pinned hubs are listed in the sidebar", async ({ page }) => {
  await openApp(page);
  const pinned = page.getByRole("region", { name: "Hubs" });
  await expect(pinned).toHaveCount(0); // nothing pinned yet
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("pin this note");
  await page.keyboard.press("Enter");
  await expect(pinned.getByRole("button", { name: "Welcome", exact: true })).toBeVisible();

  await tree(page).getByRole("treeitem", { name: "Linking notes" }).click();
  await pinned.getByRole("button", { name: "Welcome", exact: true }).click();
  await expect(title(page)).toHaveValue("Welcome");
  // It stays pinned after a reload, and can be unpinned from the sidebar.
  await page.reload();
  await pinned.getByRole("button", { name: "Welcome", exact: true }).hover();
  await pinned.getByRole("button", { name: "Unpin Welcome" }).click();
  await expect(pinned).toHaveCount(0);
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).not.toContainText("hub:");
});

test("Mark reviewed takes a stale hub off the list", async ({ page }) => {
  // Write the notes "a year ago", then come back to the present.
  const now = new Date();
  await page.clock.setSystemTime(new Date(now.getTime() - 365 * 86_400_000));
  await openApp(page);
  const zip = zipSync({
    "V/Old hub.md": strToU8("The centre."),
    "V/A.md": strToU8("[[Old hub]]"),
    "V/B.md": strToU8("[[Old hub]]"),
    "V/C.md": strToU8("[[Old hub]]"),
  });
  await page.getByLabel("Choose a zip to import").setInputFiles({ name: "v.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await expect(page.getByRole("status").filter({ hasText: "Imported 4 files" })).toBeVisible();
  await page.clock.setSystemTime(now);

  await page.getByRole("button", { name: "Repository health" }).click();
  const dialog = page.getByRole("dialog", { name: "Repository health" });
  await dialog.getByRole("tab", { name: /Stale hubs/ }).click();
  const stale = dialog.getByRole("tabpanel", { name: "Stale hubs" });
  await stale.getByRole("button", { name: "Mark Old hub reviewed" }).click();
  await expect(stale).toContainText("Nothing here");

  await dialog.getByRole("button", { name: "Close repository health" }).click();
  await tree(page).getByRole("treeitem", { name: "Old hub" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  const y = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  await expect(editor(page)).toContainText(`reviewed: ${y}-${mm}-${dd}`);
});

test("deleting a linked note warns, and can turn the links into text", async ({ page }) => {
  await openApp(page);
  const item = tree(page).getByRole("treeitem", { name: "Linking notes" });
  await item.hover();
  await page.getByRole("button", { name: "Delete Linking notes" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete file" });
  await expect(dialog).toContainText("1 note links here");
  await expect(dialog).toContainText("Welcome");
  await dialog.getByLabel("Turn the links into plain text").check();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(item).toBeHidden();

  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor(page)).toContainText("Next, read Linking notes.");
  await expect(editor(page)).not.toContainText("[[Linking notes]]");
});
