import { expect, test, type Page } from "@playwright/test";

const title = (page: Page) => page.getByRole("textbox", { name: "Note title" });
const tree = (page: Page) => page.getByRole("tree", { name: "Vault files" });
const board = (page: Page) => page.getByTestId("canvas");
const card = (page: Page, text: string) => board(page).locator(".react-flow__node", { hasText: text });

async function newCanvas(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "New canvas" }).click();
  await expect(title(page)).toHaveValue("Canvas");
  await expect(board(page).locator(".react-flow__pane")).toBeVisible();
}

async function addNote(page: Page, name: string) {
  await page.getByRole("button", { name: "Add note" }).click();
  const picker = page.getByRole("dialog", { name: "Add note" });
  await picker.getByRole("combobox").fill(name);
  await page.keyboard.press("Enter");
  await expect(picker).toBeHidden();
}

test("double-click adds a text card whose [[links]] count as backlinks", async ({ page }) => {
  await newCanvas(page);
  const pane = board(page).locator(".react-flow__pane");
  const box = (await pane.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const text = page.getByRole("textbox", { name: "Card text" });
  await expect(text).toBeFocused();
  await page.keyboard.type("Start with [[Welcome]]");
  await page.mouse.click(box.x + 30, box.y + box.height - 30); // click away to finish
  await expect(card(page, "Start with").locator("a.internal-link")).toHaveText("Welcome");
  await expect(page.getByRole("status")).toHaveText("Saved");

  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await expect(page.getByRole("region", { name: "Backlinks" }).getByRole("button", { name: "Canvas", exact: true })).toBeVisible();
});

test("note cards, a labelled arrow between them, and it all survives a reload", async ({ page }) => {
  await newCanvas(page);
  await addNote(page, "Welcome");
  await expect(card(page, "Welcome to noted-ai")).toBeVisible();
  // Move the first card aside so the second doesn't land on top of it.
  const first = card(page, "Welcome to noted-ai");
  const fb = (await first.boundingBox())!;
  // Grab the card body (the title bar is a button that opens the note).
  await page.mouse.move(fb.x + fb.width / 2, fb.y + 80);
  await page.mouse.down();
  await page.mouse.move(fb.x + fb.width / 2 - 260, fb.y + 80, { steps: 8 });
  await page.mouse.up();
  await addNote(page, "Linking notes");
  const second = card(page, "Type [[");
  await expect(second).toBeVisible();
  const sb = (await second.boundingBox())!;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 80);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2 + 260, sb.y + 80, { steps: 8 });
  await page.mouse.up();

  // Connect: drag from the first card's right-side dot to the second card's left-side dot.
  await first.hover();
  const from = (await first.locator('.react-flow__handle[data-handleid="right"]').boundingBox())!;
  await second.hover();
  const to = (await second.locator('.react-flow__handle[data-handleid="left"]').boundingBox())!;
  await first.hover();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  const arrow = board(page).locator(".react-flow__edge");
  await expect(arrow).toHaveCount(1);

  // Label it.
  // Select the arrow (click its middle), then label it from the toolbar.
  const ab = (await arrow.boundingBox())!;
  await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await page.getByRole("button", { name: "Label arrow" }).click();
  const ask = page.getByRole("dialog", { name: "Arrow label" });
  await ask.getByRole("textbox").fill("supports");
  await ask.getByRole("button", { name: "Done" }).click();
  await expect(board(page).locator(".canvas-edge-label")).toHaveText("supports");
  await expect(page.getByRole("status")).toHaveText("Saved");

  // The relation shows on the note's Links panel.
  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  const connections = page.getByRole("region", { name: "Canvas connections" });
  await expect(connections).toContainText("supports →");
  await expect(connections.getByRole("button", { name: "Linking notes" })).toBeVisible();

  // Reload: the canvas comes back as it was.
  await page.reload();
  await tree(page).getByRole("treeitem", { name: "Canvas" }).click();
  await expect(card(page, "Welcome to noted-ai")).toBeVisible();
  await expect(board(page).locator(".canvas-edge-label")).toHaveText("supports");
});

test("grouping cards, and moving the group moves them", async ({ page }) => {
  await newCanvas(page);
  await addNote(page, "Welcome");
  const note = card(page, "Welcome to noted-ai");
  await expect(note).toBeVisible();
  // It's selected after adding; group it.
  await page.getByRole("button", { name: "Group the selected cards" }).click();
  const group = board(page).locator(".react-flow__node-group");
  await expect(group).toContainText("Group");

  // Deselect, then drag the group by its inside edge.
  const pane = (await board(page).locator(".react-flow__pane").boundingBox())!;
  await page.mouse.click(pane.x + 20, pane.y + pane.height - 20);
  const before = (await note.boundingBox())!;
  const g = (await group.boundingBox())!;
  await page.mouse.move(g.x + 20, g.y + 20);
  await page.mouse.down();
  await page.mouse.move(g.x + 20, g.y + 120, { steps: 10 });
  await page.mouse.up();
  const after = (await note.boundingBox())!;
  expect(Math.round(after.y - before.y)).toBeGreaterThan(60);
  await expect(page.getByRole("status")).toHaveText("Saved");
});
