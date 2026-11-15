// Renders public/icons/icon.svg to the PNG sizes the web app manifest and iOS need.
// Run with: node scripts/make-icons.mjs  (uses the Playwright browser)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const svg = readFileSync(new URL("../public/icons/icon.svg", import.meta.url), "utf8");
const bg = /<rect[^>]*fill="([^"]+)"/.exec(svg)[1];

/** Square PNG of the icon; `maskable` fills the square and keeps the art in the 80% safe zone. */
const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180, full: true },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of targets) {
  const art = t.maskable || t.full ? svg.replace(/<rect[^>]*\/>/, "") : svg;
  const scale = t.maskable ? 0.8 : 1;
  const inner = Math.round(t.size * scale);
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<html><body style="margin:0;width:${t.size}px;height:${t.size}px;display:flex;align-items:center;justify-content:center;background:${
      t.maskable || t.full ? bg : "transparent"
    }">${art.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</body></html>`,
  );
  await page.screenshot({ path: new URL(`../public/icons/${t.file}`, import.meta.url).pathname, omitBackground: !(t.maskable || t.full) });
}
await browser.close();
console.log("icons written");
