import { expect, test, type Page } from "@playwright/test";

const editor = (page: Page) => page.locator(".cm-content");
const tree = (page: Page) => page.getByRole("tree", { name: "Repository files" });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = ymd(new Date());
const yesterday = ymd(new Date(Date.now() - 86_400_000));

test("the Tasks panel gathers tasks by date, and ticks them off in their notes", async ({ page }) => {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("radio", { name: "Source" }).click();
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(`\n\n## Errands\n\n- [ ] Pay rent 📅 ${yesterday}\n- [ ] Buy seeds 📅 ${today} ⏫ #garden\n- [ ] Plan the [[Linking notes|trip]]\n`);

  await page.getByRole("tab", { name: "Tasks" }).click();
  const panel = page.getByRole("region", { name: "Tasks" });
  await expect(panel.getByRole("group", { name: "Overdue" })).toContainText("Pay rent");
  await expect(panel.getByRole("group", { name: "Today" })).toContainText("Buy seeds #garden");
  await expect(panel.getByRole("group", { name: "Today" })).toContainText("High priority");
  // Links show as their text; the welcome note's own open task is there too.
  await expect(panel.getByRole("group", { name: "No date" })).toContainText("Plan the trip");
  await expect(panel.getByRole("group", { name: "No date" })).toContainText("Try the reading view");
  await expect(panel.getByRole("radio", { name: "Open 4" })).toBeVisible();

  // Ticking one off ticks it in the note, and nothing else.
  await panel.getByRole("checkbox", { name: "Done: Buy seeds #garden" }).click();
  await expect(editor(page).locator(".cm-line", { hasText: "Buy seeds" })).toHaveText(`- [x] Buy seeds 📅 ${today} ⏫ #garden`);
  await expect(panel.getByRole("radio", { name: "Open 3" })).toBeVisible();
  await panel.getByRole("radio", { name: /^Done/ }).click();
  await expect(panel).toContainText("Buy seeds");
  await panel.getByRole("radio", { name: /^Open/ }).click();

  // Filter, and group by note.
  await panel.getByLabel("Filter tasks").fill("rent");
  await expect(panel.getByRole("listitem")).toHaveCount(1);
  await panel.getByLabel("Filter tasks").fill("");
  await panel.getByLabel("Group by").selectOption("note");
  await expect(panel.getByRole("group", { name: "Welcome" }).getByRole("listitem")).toHaveCount(3);

  // From another note: ticking writes the saved note; clicking opens it at the task.
  await page.getByRole("tab", { name: "Files" }).click();
  await tree(page).getByRole("treeitem", { name: "Linking notes" }).click();
  await page.getByRole("tab", { name: "Tasks" }).click();
  await panel.getByRole("checkbox", { name: "Done: Plan the trip" }).click();
  await expect(panel.getByRole("checkbox", { name: "Done: Plan the trip" })).toHaveCount(0);
  await panel.getByRole("button", { name: /Pay rent/ }).click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue("Welcome");
  await expect(editor(page)).toContainText("- [x] Plan the [[Linking notes|trip]]");
  await expect(page.locator(".cm-activeLine")).toContainText("Pay rent");
});
