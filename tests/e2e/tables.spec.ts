import { expect, test, type Page } from "@playwright/test";
import { editor, title } from "./helpers";

const grid = (page: Page) => page.locator(".cm-table-grid");
const cell = (page: Page, name: string) => grid(page).getByRole("textbox", { name, exact: true });

async function newNote(page: Page) {
  await page.goto("/");
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await expect(title(page)).toHaveValue("Untitled");
  await editor(page).click();
}

/** The note's markdown, read from source mode (then back to live preview). */
async function source(page: Page) {
  await page.getByRole("radio", { name: "Source" }).click();
  const text = await editor(page).evaluate((el) => [...el.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n"));
  await page.getByRole("radio", { name: "Live preview" }).click();
  return text;
}

async function paste(page: Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

test("a table picked from the toolbar is edited as a grid", async ({ page }) => {
  await newNote(page);
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.getByRole("dialog", { name: "Insert table" }).getByRole("button", { name: "3 × 2 table" }).click();
  await expect(grid(page)).toBeVisible();
  // The cursor lands in the first heading cell.
  await expect(cell(page, "Heading 1")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Fruit");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Qty");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Note");
  await page.keyboard.press("Tab");
  await page.keyboard.type("pear");
  await page.keyboard.press("Tab");
  await page.keyboard.type("10");
  await page.keyboard.press("Tab");
  await page.keyboard.type("**ripe** | soft");
  await page.keyboard.press("Enter"); // down a row, same column
  await page.keyboard.type("crisp");
  await expect(cell(page, "Row 2, Note")).toBeFocused();
  // Cells show rendered markdown once you leave them.
  await expect(cell(page, "Row 1, Note").locator("strong")).toHaveText("ripe");

  expect(await source(page)).toBe(
    [
      "| Fruit | Qty | Note             |",
      "| ----- | --- | ---------------- |",
      "| pear  | 10  | **ripe** \\| soft |",
      "|       |     | crisp            |",
    ].join("\n"),
  );
});

test("Tab past the last cell adds a row, arrow keys leave the table, undo works in a cell", async ({ page }) => {
  await newNote(page);
  await page.keyboard.type("Above");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await page.keyboard.press("Enter"); // the picker's default: 2 × 2
  await expect(cell(page, "Heading 1")).toBeFocused();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
  await expect(grid(page).locator("tbody tr")).toHaveCount(3);
  await page.keyboard.type("x");
  await expect(cell(page, "Row 3, Column 1")).toHaveText("x");
  await page.waitForTimeout(600); // longer than the editor groups typing into one undo step (500 ms)
  await page.keyboard.type("yz");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cell(page, "Row 3, Column 1")).toHaveText("x");

  // Up from the heading row goes to the line above; down from it comes back.
  await cell(page, "Heading 2").click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type("!");
  await expect(editor(page).locator(".cm-line").first()).toHaveText("Above!");
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, "Heading 1")).toBeFocused();
  // Escape leaves below the table.
  await page.keyboard.press("Escape");
  await page.keyboard.type("Below");
  expect((await source(page)).split("\n").at(-1)).toBe("Below");
});

test("a table typed by hand turns into a grid once Enter moves on", async ({ page }) => {
  await newNote(page);
  await page.keyboard.type("|a|b|");
  await page.keyboard.press("Enter");
  await page.keyboard.type("|-|-|");
  await page.keyboard.press("Enter");
  await expect(cell(page, "Row 1, a")).toBeFocused(); // the new row's first cell
  await page.keyboard.type("1");
  await page.keyboard.press("Tab");
  await page.keyboard.type("2");
  expect(await source(page)).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |");
});

test("the table menu adds, moves, sorts and deletes", async ({ page }) => {
  await newNote(page);
  await paste(page, "| n | w |\n|---|---|\n| 10 | ten |\n| 9 | nine |\n| 100 | hundred |\n\nend");
  await expect(grid(page)).toBeVisible();
  const menu = page.getByRole("menu", { name: "Table" });

  await cell(page, "Row 1, n").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Sort A → Z" }).click();
  await expect(grid(page).locator("tbody td:first-child")).toHaveText(["9", "10", "100"]);

  await cell(page, "Row 1, w").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Align right" }).click();
  await cell(page, "Row 1, w").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Insert column left" }).click();
  await expect(grid(page).locator("thead th")).toHaveCount(3);
  await page.keyboard.type("new");
  await cell(page, "Row 3, w").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Delete row" }).click();
  await cell(page, "Row 1, n").click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Move column right" }).click();
  // The menu's heading row can't be deleted.
  await cell(page, "Heading 1").click({ button: "right" });
  await expect(menu.getByRole("menuitem", { name: "Delete row" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // The add-row and add-column buttons.
  await grid(page).hover();
  await page.getByRole("button", { name: "Add row" }).click();
  await expect(grid(page).locator("tbody tr")).toHaveCount(3);

  expect(await source(page)).toBe(
    [
      "|     | n   |    w |",
      "| --- | --- | ---: |",
      "| new | 9   | nine |",
      "|     | 10  |  ten |",
      "|     |     |      |",
      "",
      "end",
    ].join("\n"),
  );
});

test("cells pasted from a spreadsheet become a table", async ({ page }) => {
  await newNote(page);
  await paste(page, "Name\tScore\nAda\t3\nBo\t5\n");
  await expect(grid(page)).toBeVisible();
  await expect(grid(page).locator("thead th")).toHaveText(["Name", "Score"]);
  // Pasting a block into a cell spreads it across the cells from there.
  await cell(page, "Row 2, Score").click();
  await paste(page, "7\n8");
  await expect(grid(page).locator("tbody td:nth-child(2)")).toHaveText(["3", "7", "8"]);
  expect(await source(page)).toContain("|      | 8     |");
});

test("tables can be edited as markdown instead, with Tab between cells", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Editor" }).click();
  await page.getByLabel("Tables in live preview").selectOption("markdown");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await editor(page).click();
  await paste(page, "Intro\n\n|a|b|\n|-|-|\n|1|2|");
  await expect(grid(page)).toHaveCount(0);
  await page.keyboard.press("Tab");
  await page.keyboard.type("3");
  await expect(editor(page)).toContainText("| 1   | 2   |");
  // The new row lines up again on the next Tab.
  expect(await source(page)).toBe("Intro\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n| 3    |     |");
  // Away from the table it is shown rendered.
  await editor(page).locator(".cm-line").first().click();
  await expect(page.locator(".cm-rendered-table")).toBeVisible();
});
