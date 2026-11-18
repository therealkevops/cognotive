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

test("live preview shows properties as a panel, with Add property and a hub checkbox", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await editor.click();
  await page.keyboard.type("Body text");

  // No properties yet: the command adds a block and offers names.
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("add a property");
  await page.keyboard.press("Enter");
  const list = page.locator(".cm-tooltip-autocomplete");
  await expect(list.getByRole("option", { name: /^tags/ })).toBeVisible();
  await page.keyboard.type("ta");
  await expect(list.getByRole("option").first()).toHaveText(/^tags/);
  await accept(page);
  await page.keyboard.type("gu");
  await expect(list.getByRole("option").first()).toHaveText(/^guide/);
  await accept(page);

  // Leave the block: it shows as a panel.
  await editor.getByText("Body text").click();
  const panel = page.getByRole("group", { name: "Properties" });
  await expect(panel).toContainText("tags");
  await expect(panel).toContainText("#guide");

  // Add property from the panel.
  await panel.getByRole("button", { name: "+ Add property" }).click();
  await expect(panel).toBeHidden(); // editing the YAML now
  await page.keyboard.type("hu");
  await expect(list.getByRole("option").first()).toHaveText(/^hub/);
  await accept(page);
  await expect(list.getByRole("option").first()).toHaveText(/^true/);
  await accept(page);
  await editor.getByText("Body text").click();

  // hub is a checkbox: unticking it writes false.
  const hub = panel.getByRole("checkbox", { name: "hub" });
  await expect(hub).toBeChecked();
  await hub.uncheck();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(editor).toHaveText("---tags: [guide]hub: false---Body text");
});

test("the reading view edits properties in place, with suggestions", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("tree", { name: "Repository files" }).getByRole("treeitem", { name: "Linking notes" }).click();
  await page.getByRole("radio", { name: "Reading" }).click();
  const props = page.getByRole("region", { name: "Properties" });
  await expect(props).toContainText("#guide");

  // A tag from the repository's tags.
  await props.getByRole("combobox", { name: "Add to tags" }).fill("ar");
  await expect(props.getByRole("option", { name: "area", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(props).toContainText("#area");
  // Remove an alias.
  await props.getByRole("button", { name: "Remove Links" }).click();

  // A new property, by name, then its value.
  await props.getByRole("button", { name: "Add property" }).click();
  await props.getByRole("combobox", { name: "New property name" }).fill("hu");
  await expect(props.getByRole("option", { name: /^hub/ })).toContainText("pins the note");
  await page.keyboard.press("Enter");
  const hub = props.getByRole("checkbox", { name: "hub" });
  await expect(hub).toBeChecked();
  // The sidebar now lists it as a pinned hub.
  await expect(page.getByRole("region", { name: "Hubs", exact: true })).toContainText("Linking notes");

  // One of your own, with a free-text value.
  await props.getByRole("button", { name: "Add property" }).click();
  await props.getByRole("combobox", { name: "New property name" }).fill("status");
  await page.keyboard.press("Enter");
  await props.getByRole("combobox", { name: "status" }).fill("draft");
  await page.keyboard.press("Enter");

  await page.getByRole("radio", { name: "Source" }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("tags: [guide, area]");
  await expect(editor).toContainText("aliases: []");
  await expect(editor).toContainText("hub: true");
  await expect(editor).toContainText("status: draft");
});

test("the side pane edits the properties of the note it shows", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  const tree = page.getByRole("tree", { name: "Repository files" });
  await tree.getByRole("treeitem", { name: "Linking notes" }).hover();
  await page.getByRole("button", { name: "Open Linking notes in the side pane" }).click();
  const side = page.getByRole("region", { name: "Side pane" });
  const props = side.getByRole("region", { name: "Properties" });
  await expect(props).toContainText("#guide");

  await props.getByRole("combobox", { name: "Add to tags" }).fill("are");
  await expect(props.getByRole("option", { name: "area", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(props).toContainText("#area");
  await props.getByRole("button", { name: "Add property" }).click();
  await props.getByRole("combobox", { name: "New property name" }).fill("hu");
  await page.keyboard.press("Enter");
  await expect(props.getByRole("checkbox", { name: "hub" })).toBeChecked();

  // Welcome stays open in the main pane; the change is in Linking notes.
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Welcome");
  await tree.getByRole("treeitem", { name: "Linking notes" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(page.locator(".cm-content")).toContainText("tags: [guide, area]");
  await expect(page.locator(".cm-content")).toContainText("hub: true");
});

test("an attachment's properties are edited above it, and follow a rename", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByLabel("Choose files to add").setInputFiles({
    name: "pic.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"),
  });
  const title = page.getByRole("textbox", { name: "Note title" });
  await expect(title).toHaveValue("pic");
  const props = page.getByTestId("file-view").getByRole("region", { name: "Properties" });
  await props.getByRole("button", { name: "Add property" }).click();
  await props.getByRole("combobox", { name: "New property name" }).fill("tags");
  await page.keyboard.press("Enter");
  await props.getByRole("combobox", { name: "Add to tags" }).fill("photos");
  await page.keyboard.press("Enter");
  await expect(props).toContainText("#photos");

  // The tag counts, and stays with the file when it's renamed.
  await page.getByRole("tab", { name: "Tags" }).click();
  await expect(page.getByRole("button", { name: "#photos 1", exact: true })).toBeVisible();
  await title.fill("beach");
  await title.press("Enter");
  await page.getByRole("tab", { name: "Files" }).click();
  // (The attachments folder is open: the upload opened it.)
  await expect(page.getByRole("tree", { name: "Repository files" }).getByRole("treeitem", { name: /^beach/ })).toBeVisible();
  await page.reload();
  await expect(title).toHaveValue("beach");
  await expect(page.getByTestId("file-view").getByRole("region", { name: "Properties" })).toContainText("#photos");
});

test("search finds files by property", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("tab", { name: "Search" }).click();
  const search = page.getByRole("searchbox", { name: "Search all notes" });
  await search.fill("[tags:guide]");
  const results = page.getByRole("region", { name: "Search" });
  await expect(results).toContainText("1 note");
  await expect(results).toContainText("Linking notes");
  await expect(results).toContainText("tags: guide");
  await search.fill("[aliases] link");
  await expect(results).toContainText("Linking notes");
  await search.fill("[status]");
  await expect(results).toContainText("No matches");
});

test("the Properties tab renames, types and deletes properties everywhere", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  const { strToU8, zipSync } = await import("fflate");
  const zip = zipSync({
    "V/A.md": strToU8("---\nstate: draft\npriority: 2\n---\nA"),
    "V/B.md": strToU8("---\nstate: done\n---\nB"),
    "V/C.md": strToU8("---\nstate: old\nstatus: kept\n---\nC"),
  });
  await page.getByLabel("Choose a zip to import").setInputFiles({ name: "v.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await expect(page.getByRole("status").filter({ hasText: "Imported 3 files" })).toBeVisible();

  await page.getByRole("tab", { name: "Properties" }).click();
  const panel = page.getByRole("region", { name: "Properties" }).first();
  await panel.getByRole("button", { name: /^state/ }).click();
  const details = panel.getByRole("group", { name: "state details" });
  await expect(details).toContainText("draft");
  await details.getByRole("button", { name: "Rename…" }).click();
  await details.getByRole("textbox", { name: "New name for state" }).fill("status");
  await details.getByRole("button", { name: "Rename everywhere" }).click();
  await expect(panel.getByRole("status")).toContainText("Renamed in 2 files. 1 already had status");

  // A type for one of your own properties: numbers get a number box.
  await panel.getByRole("button", { name: /^priority/ }).click();
  await panel.getByRole("group", { name: "priority details" }).getByRole("combobox").selectOption("number");
  // Clicking a value searches for it.
  await panel.getByRole("button", { name: /^status/ }).click();
  await panel.getByRole("group", { name: "status details" }).getByRole("button", { name: "draft" }).click();
  const results = page.getByRole("region", { name: "Search" });
  await expect(results).toContainText("1 note");
  await results.getByRole("button", { name: /^A/ }).click();
  await page.getByRole("radio", { name: "Reading" }).click();
  await expect(page.getByRole("region", { name: "Properties" }).getByRole("spinbutton", { name: "priority" })).toHaveValue("2");

  // Delete everywhere.
  await page.getByRole("tab", { name: "Properties" }).click();
  await panel.getByRole("button", { name: /^status/ }).click();
  await panel.getByRole("group", { name: "status details" }).getByRole("button", { name: "Delete…" }).click();
  await panel.getByRole("alertdialog", { name: "Delete status" }).getByRole("button", { name: "Delete everywhere" }).click();
  await expect(panel.getByRole("status")).toContainText("Removed status from 3 files.");
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(page.locator(".cm-content")).toHaveText("---priority: 2---A");
});

test("a canvas has properties of its own", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "New canvas" }).click();
  await page.getByRole("button", { name: "Canvas properties" }).click();
  const panel = page.getByRole("dialog", { name: "Properties of this canvas" });
  await panel.getByRole("button", { name: "Add property" }).click();
  await panel.getByRole("combobox", { name: "New property name" }).fill("tags");
  await page.keyboard.press("Enter");
  await panel.getByRole("combobox", { name: "Add to tags" }).fill("boards");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.getByRole("tab", { name: "Tags" }).click();
  await expect(page.getByRole("button", { name: "#boards 1", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Canvas properties" }).click();
  await expect(page.getByRole("dialog", { name: "Properties of this canvas" })).toContainText("#boards");
});

test("search results' properties can be edited together as a table", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  const { strToU8, zipSync } = await import("fflate");
  const zip = zipSync({
    "V/A.md": strToU8("---\nstate: draft\n---\nA"),
    "V/B.md": strToU8("---\nstate: done\ntags: [x]\n---\nB"),
  });
  await page.getByLabel("Choose a zip to import").setInputFiles({ name: "v.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await expect(page.getByRole("status").filter({ hasText: "Imported 2 files" })).toBeVisible();
  await page.getByRole("tab", { name: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search all notes" }).fill("[state]");
  await page.getByRole("button", { name: "Edit properties" }).click();

  const table = page.getByRole("dialog", { name: "Edit properties" });
  await expect(table).toContainText("2 files");
  // One cell.
  const cell = table.getByLabel("state of A", { exact: true });
  await cell.fill("review");
  await cell.press("Enter");
  // A new column, set for every file.
  await table.getByRole("combobox", { name: "Add a property column" }).fill("priority");
  await table.getByRole("button", { name: "Add" }).click();
  const all = table.getByLabel("priority for all files", { exact: true });
  await all.fill("high");
  await all.press("Enter");
  await expect(table.getByLabel("priority of B", { exact: true })).toHaveValue("high");
  // And remove one from every file.
  await table.getByRole("button", { name: "Remove state from all files" }).click();
  await expect(table.getByLabel("state of B", { exact: true })).toHaveCount(0);
  // Lists are typed with commas.
  const tags = table.getByLabel("tags of A", { exact: true });
  await tags.fill("one, two");
  await tags.press("Enter");

  await table.getByRole("button", { name: "A", exact: true }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(page.locator(".cm-content")).toHaveText("---priority: hightags: [one, two]---A");
});

test("the side pane edits a drawing's properties", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "New drawing" }).click();
  await expect(page.getByTestId("drawing").locator("canvas.interactive")).toBeVisible({ timeout: 30_000 });
  const tree = page.getByRole("tree", { name: "Repository files" });
  await tree.getByRole("treeitem", { name: "Welcome" }).click();
  await tree.getByRole("treeitem", { name: "Drawing" }).hover();
  await page.getByRole("button", { name: "Open Drawing in the side pane" }).click();
  const props = page.getByRole("region", { name: "Side pane" }).getByRole("region", { name: "Properties" });
  await props.getByRole("button", { name: "Add property" }).click();
  await props.getByRole("combobox", { name: "New property name" }).fill("tags");
  await page.keyboard.press("Enter");
  await props.getByRole("combobox", { name: "Add to tags" }).fill("diagrams");
  await page.keyboard.press("Enter");
  await expect(props).toContainText("#diagrams");
  await page.getByRole("tab", { name: "Tags" }).click();
  await expect(page.getByRole("button", { name: "#diagrams 1", exact: true })).toBeVisible();
});
