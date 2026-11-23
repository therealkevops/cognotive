import { expect, test, type Page } from "@playwright/test";
import { title, tree } from "./helpers";

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
  await expect(card(page, "Welcome to Cognotive.ai")).toBeVisible();
  // Move the first card aside so the second doesn't land on top of it.
  const first = card(page, "Welcome to Cognotive.ai");
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
  await expect(card(page, "Welcome to Cognotive.ai")).toBeVisible();
  await expect(board(page).locator(".canvas-edge-label")).toHaveText("supports");
});

test("grouping cards, and moving the group moves them", async ({ page }) => {
  await newCanvas(page);
  await addNote(page, "Welcome");
  const note = card(page, "Welcome to Cognotive.ai");
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

test("the open canvas is opened again after a reload", async ({ page }) => {
  await newCanvas(page);
  await addNote(page, "Welcome");
  await expect(card(page, "Welcome")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(title(page)).toHaveValue("Canvas");
  await expect(card(page, "Welcome")).toBeVisible();
});

test("a canvas whose code was replaced by a new deployment reloads the page and opens", async ({ page }) => {
  await newCanvas(page);
  await addNote(page, "Welcome");
  await tree(page).getByRole("treeitem", { name: "Welcome" }).click();
  await expect(title(page)).toHaveValue("Welcome");
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();

  // As if a new version were deployed: this page's build files are gone, until it reloads.
  let gone = true;
  await page.route("**/_next/static/**", (route) => (gone ? route.abort() : route.continue()));
  page.on("request", (r) => {
    if (r.isNavigationRequest()) gone = false;
  });
  const reloaded = page.waitForEvent("load");
  await tree(page).getByRole("treeitem", { name: "Canvas" }).click();
  await reloaded;
  await expect(title(page)).toHaveValue("Canvas");
  await expect(card(page, "Welcome")).toBeVisible();
});

test("a canvas that isn't valid JSON can be repaired as text", async ({ page }) => {
  await newCanvas(page);
  // Break the file through the import path, as a hand edit or a cut-short download might.
  const { strToU8, zipSync } = await import("fflate");
  const zip = zipSync({ "V/Bad.canvas": strToU8('{"nodes":[{"id":"a","type":"text","text":"Saved","x":0,"y":0,"width":200,"height":60}]') });
  await page.getByLabel("Choose a zip to import").setInputFiles({ name: "v.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
  await tree(page).getByRole("treeitem", { name: "Bad" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "isn't valid JSON" })).toBeVisible();
  await page.getByRole("button", { name: "Edit as text" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("}");
  await page.getByRole("button", { name: "Show as canvas" }).click();
  await expect(card(page, "Saved")).toBeVisible();
});

test("a note card's properties can be edited from the canvas", async ({ page }) => {
  await newCanvas(page);
  await addNote(page, "Linking notes");
  const noteCard = card(page, "Linking notes");
  await expect(noteCard).toBeVisible();
  // The button shows how many properties the note has.
  const toggle = noteCard.getByRole("button", { name: "Properties of Linking notes" });
  await expect(toggle).toHaveText("2");
  await toggle.click();
  const panel = page.getByRole("dialog", { name: "Properties of Linking notes" });
  await expect(panel).toContainText("#guide");

  const add = panel.getByRole("combobox", { name: "Add to tags" });
  await add.fill("arex");
  // Backspace edits the text box; it doesn't delete the card.
  await page.keyboard.press("Backspace");
  await expect(add).toHaveValue("are");
  await expect(panel.getByRole("option", { name: "area", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(panel).toContainText("#area");
  await expect(noteCard).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Saved");

  await tree(page).getByRole("treeitem", { name: "Linking notes" }).click();
  await page.getByRole("radio", { name: "Source" }).click();
  await expect(page.locator(".cm-content")).toContainText("tags: [guide, area]");
});

test("the add bar's shortcuts, the selection bar and the zoom pill", async ({ page }) => {
  await newCanvas(page);
  const pane = board(page).locator(".react-flow__pane");
  const box = (await pane.boundingBox())!;
  // T adds a text card while the board has the keyboard (not while typing in it).
  await page.mouse.click(box.x + 40, box.y + 40);
  await page.keyboard.press("t");
  const text = page.getByRole("textbox", { name: "Card text" });
  await expect(text).toBeFocused();
  await page.keyboard.type("Plan t");
  await expect(text).toHaveValue("Plan t");
  await expect(board(page).locator(".react-flow__node")).toHaveCount(1);

  // Writing more than fits makes the card taller instead of scrolling inside it.
  const node = board(page).locator(".react-flow__node").first();
  const before = (await node.boundingBox())!.height;
  for (let i = 0; i < 8; i++) await page.keyboard.press("Enter");
  await expect.poll(async () => (await node.boundingBox())!.height).toBeGreaterThan(before);

  // Finish editing; the card stays selected, with its bar above it.
  await page.keyboard.press("Escape");
  await node.click();
  const bar = page.getByRole("toolbar", { name: "Selection" });
  await expect(bar).toBeVisible();
  expect((await bar.boundingBox())!.y).toBeLessThan((await node.boundingBox())!.y);
  await bar.getByRole("button", { name: "Colour" }).click();
  await bar.getByRole("button", { name: "Green" }).click();
  await expect(node.locator(".canvas-card")).toHaveAttribute("style", /--card-color: #3fa05a/);
  await expect(bar.getByRole("button", { name: "Green" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status")).toHaveText("Saved");

  // Zoom: the pill shows the level and changes it.
  const zoom = page.getByRole("group", { name: "Zoom" });
  const level = zoom.getByRole("button", { name: "Zoom options" });
  await expect(level).toHaveText("100%");
  await zoom.getByRole("button", { name: "Zoom out" }).click();
  await expect(level).not.toHaveText("100%");
  await level.click();
  await page.getByRole("menuitem", { name: "200%" }).click();
  await expect(level).toHaveText("200%");
  await level.click();
  await page.getByRole("menuitem", { name: "Zoom to fit" }).click();
  await expect(level).toHaveText("100%");

  // Delete from the bar.
  await node.click();
  await bar.getByRole("button", { name: "Delete" }).click();
  await expect(board(page).locator(".react-flow__node")).toHaveCount(0);
  await expect(bar).toBeHidden();
});

test("a note card opens from the selection bar, without repeating its title", async ({ page }) => {
  await newCanvas(page);
  await addNote(page, "Linking notes");
  const noteCard = card(page, "Type [[");
  await expect(noteCard).toBeVisible();
  await expect(noteCard.locator("h1", { hasText: "Linking notes" })).toHaveCount(0);
  await page.getByRole("toolbar", { name: "Selection" }).getByRole("button", { name: "Open", exact: true }).click();
  await expect(title(page)).toHaveValue("Linking notes");
});

test("the view menu: titles only, grid, snapping and the mini-map, kept on this device", async ({ page }) => {
  await newCanvas(page);
  await addNote(page, "Linking notes");
  const noteCard = card(page, "Linking notes");
  await expect(noteCard.locator(".canvas-card-body")).toBeVisible();
  const full = (await noteCard.boundingBox())!.height;

  const menu = async () => {
    await page.getByRole("button", { name: "View options" }).click();
    return page.getByRole("menu", { name: "View options" });
  };
  let view = await menu();
  await expect(view.getByRole("menuitemradio", { name: "Dots" })).toHaveAttribute("aria-checked", "true");
  await view.getByRole("menuitemradio", { name: "Titles only" }).click();
  // The menu stays open for more changes.
  await view.getByRole("menuitemradio", { name: "No grid" }).click();
  await view.getByRole("menuitemcheckbox", { name: "Mini-map" }).click();
  await view.getByRole("menuitemcheckbox", { name: "Snap to grid" }).click();
  await expect(view.getByRole("menuitemcheckbox", { name: "Snap to grid" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await expect(noteCard.locator(".canvas-card-body")).toHaveCount(0);
  expect((await noteCard.boundingBox())!.height).toBeLessThan(full / 3);
  await expect(board(page).locator(".react-flow__background")).toHaveCount(0);
  await expect(board(page).locator(".react-flow__minimap")).toBeVisible();

  // Snapping: a dragged card lands on the grid.
  const b = (await noteCard.boundingBox())!;
  await page.mouse.move(b.x + 60, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 60 + 37, b.y + b.height / 2 + 51, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("status")).toHaveText("Saved");

  const at = await noteCard.evaluate((el) => /translate\(([-\d.]+)px, ?([-\d.]+)px\)/.exec(el.style.transform)!.slice(1).map(Number));
  expect(at.map((v) => ((v % 22) + 22) % 22)).toEqual([0, 0]);

  // Kept after a reload.
  await page.reload();
  await tree(page).getByRole("treeitem", { name: "Canvas" }).click();
  await expect(card(page, "Linking notes")).toBeVisible();
  await expect(card(page, "Linking notes").locator(".canvas-card-body")).toHaveCount(0);
  await expect(board(page).locator(".react-flow__minimap")).toBeVisible();
  view = await menu();
  await view.getByRole("menuitemradio", { name: "Show previews" }).click();
  await page.keyboard.press("Escape");
  await expect(card(page, "Linking notes").locator(".canvas-card-body")).toBeVisible();
  expect(Math.abs((await card(page, "Linking notes").boundingBox())!.height - full)).toBeLessThan(4);
});
