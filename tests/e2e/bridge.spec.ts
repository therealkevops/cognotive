import { expect, test, type Page } from "@playwright/test";
import { FakeLLM } from "./fake-llm";

async function openAi(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "AI" }).click();
  return page.getByRole("region", { name: "AI" });
}

test("the Claude plan provider explains how to start the bridge", async ({ page }) => {
  const llm = new FakeLLM();
  await llm.install(page);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toBeVisible();
  const ai = await openAi(page);
  await ai.getByRole("radio", { name: /Claude plan/ }).click();
  const status = ai.getByRole("status", { name: "Bridge connection" });
  await expect(status).toContainText("The bridge isn't running.");
  await expect(status).toContainText("npm run bridge");
  await expect(status).toContainText("claude /login");

  // Started, but not paired yet; then a wrong code; then the right one.
  llm.bridgeRunning = true;
  await ai.getByRole("button", { name: "Check again" }).click();
  await expect(status).toContainText("Paste the pairing code it printed");
  await ai.getByLabel("Pairing code").fill("f".repeat(48));
  await ai.getByRole("button", { name: "Save code" }).click();
  await expect(status).toContainText("didn't accept that pairing code");
  await ai.getByRole("button", { name: "Remove code" }).click();
  await ai.getByLabel("Pairing code").fill(llm.bridgeCode);
  await ai.getByRole("button", { name: "Save code" }).click();
  await expect(status).toContainText("Connected to Claude Code.");
  await expect(ai.getByLabel("Model", { exact: true })).toHaveValue("claude/sonnet");
});

test("the bridge's pairing link pairs in one step, and chat goes through it", async ({ page }) => {
  const llm = new FakeLLM();
  llm.bridgeRunning = true;
  await llm.install(page);
  await page.goto(`/#bridge=${llm.bridgeCode}`);
  // Settings opens on AI with the Claude plan chosen and connected; the code leaves the address bar.
  const ai = page.getByRole("region", { name: "AI" });
  await expect(ai.getByRole("radio", { name: /Claude plan/ })).toHaveAttribute("aria-checked", "true");
  await expect(ai.getByRole("status", { name: "Bridge connection" })).toContainText("Connected to Claude Code.");
  expect(new URL(page.url()).hash).toBe("");
  await ai.getByLabel("Model", { exact: true }).selectOption("claude/opus");
  await page.getByRole("button", { name: "Close settings" }).click();

  await page.getByRole("tab", { name: "Chat" }).click();
  const chat = page.getByRole("region", { name: "Chat" });
  await expect(chat).toContainText("Claude plan · claude/opus");
  await chat.getByLabel("Message").fill("Hello");
  await chat.getByLabel("Message").press("Enter");
  await expect(chat.locator('[data-role="assistant"]').last()).toContainText("I read Welcome");
  expect(llm.calls).toHaveLength(1);
  expect(llm.calls[0]).toMatchObject({ host: "bridge", model: "claude/opus", auth: `Bearer ${llm.bridgeCode}` });
  // The agent's tools go along; the bridge turns them into text for Claude Code.
  expect(llm.calls[0].tools).toContain("search_notes");
});
