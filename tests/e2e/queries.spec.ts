import { expect, test, type Page } from "@playwright/test";
import { editor, title, tree } from "./helpers";

async function addNote(page: Page, name: string, text: string) {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(title(page)).toHaveValue(/Untitled/);
  await title(page).fill(name);
  await title(page).press("Enter");
  await expect(title(page)).toHaveValue(name);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText(text);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

async function setUp(page: Page) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("radio", { name: "Source" }).click();
  await addNote(page, "Garden", "---\ntags: [project]\nstatus: active\ndue: 2026-12-01\n---\n# Garden\n\n- [ ] Order seeds\n");
  await addNote(page, "Website", "---\ntags: [project]\nstatus: active\ndue: 2026-11-25\n---\n# Website\n");
  await addNote(page, "Old plan", "---\ntags: [project]\nstatus: done\n---\n# Old plan\n");
}

test("a query block lists matching notes, live, in reading view and live preview", async ({ page }) => {
  await setUp(page);
  await addNote(page, "Projects", "# Projects\n\n```query\n#project [status:active]\nshow: table status, due\nsort: due\n```\n\nAfter.\n");

  // Reading view: a table, linked, sorted by due date.
  await page.getByRole("radio", { name: "Reading" }).click();
  const reading = page.getByTestId("reading-view");
  const rows = reading.locator("table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Website");
  await expect(rows.nth(0)).toContainText("2026-11-25");
  await expect(rows.nth(1)).toContainText("Garden");
  await expect(reading).not.toContainText("Old plan");

  // Live preview: the same results in place of the block, until the cursor goes in.
  await page.getByRole("radio", { name: "Live preview" }).click();
  const block = page.locator(".cm-rendered-query");
  await expect(block).toContainText("Query");
  await expect(block.locator("table tbody tr")).toHaveCount(2);

  // A change elsewhere shows up straight away.
  await tree(page).getByRole("treeitem", { name: "Old plan" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await editor(page).getByText("status: done").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.insertText("status: active");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await tree(page).getByRole("treeitem", { name: "Projects" }).click();
  await page.getByRole("radio", { name: "Live preview" }).click();
  await expect(page.locator(".cm-rendered-query table tbody tr")).toHaveCount(3);

  // Links in the results open notes.
  await page.locator(".cm-rendered-query").getByRole("link", { name: "Website" }).click();
  await expect(title(page)).toHaveValue("Website");
});

test("dataview blocks, task lists, and mistakes", async ({ page }) => {
  await setUp(page);
  await addNote(
    page,
    "Dashboard",
    '# Dashboard\n\n```dataview\nLIST FROM #project WHERE status = "active" SORT due DESC\n```\n\n```dataview\nTASK FROM #project WHERE !completed\n```\n\n```query\nshow: chart\n```\n',
  );
  await page.getByRole("radio", { name: "Reading" }).click();
  const reading = page.getByTestId("reading-view");
  const lists = reading.locator("ul");
  await expect(lists.nth(0).locator("li")).toHaveText(["Garden", "Website"]);
  await expect(lists.nth(1)).toContainText("Order seeds");
  await expect(lists.nth(1).getByRole("checkbox")).not.toBeChecked();
  await expect(reading).toContainText("Query error: show: should be list, table (with columns) or tasks");
});

test("the palette inserts a starter query", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("radio", { name: "Source" }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ControlOrMeta+p");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("Insert a live query");
  await page.keyboard.press("Enter");
  // "#tag" is selected, ready to be typed over.
  await page.keyboard.type("#guide");
  await expect(editor(page)).toContainText("```query#guide [status:active]show: table status, duesort: due```");
});
