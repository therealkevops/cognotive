// Draws the k-note icons and renders them to the PNG sizes the web app manifest and iOS need.
// The logo is a periodic-table tile: "Kn" with an atomic number (11: k is the 11th letter)
// and the name below it. Letters are drawn from the Geist font (bundled with Next.js) as
// paths, so the icon looks the same everywhere, whatever fonts a device has.
// Run with: node scripts/make-icons.mjs  (uses opentype.js and the Playwright browser)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const opentype = require("opentype.js");
const font = opentype.loadSync(require.resolve("next/dist/compiled/@vercel/og/Geist-Regular.ttf"));

const INK = "#1f1e1d";
const PAPER = "#faf9f5";
const CLAY = "#c96442";
const NUMBER = "11";

/** Text as a path, placed by its centre (or its left edge), on a baseline. */
function text(str, size, { x, y, anchor = "middle" }) {
  const probe = font.getPath(str, 0, 0, size).getBoundingBox();
  const left = anchor === "middle" ? x - (probe.x1 + probe.x2) / 2 : x - probe.x1;
  return font.getPath(str, left, y, size).toPathData(2);
}

// The app icon, 512 × 512: a clay-edged tile on ink.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${INK}"/>
  <!-- k-note as an element: atomic number, symbol and name. Drawn by scripts/make-icons.mjs. -->
  <rect x="80" y="80" width="352" height="352" rx="30" fill="none" stroke="${CLAY}" stroke-width="12"/>
  <path d="${text(NUMBER, 50, { x: 116, y: 146, anchor: "start" })}" fill="${PAPER}" fill-opacity="0.8"/>
  <path d="${text("Kn", 186, { x: 256, y: 326 })}" fill="${PAPER}" stroke="${PAPER}" stroke-width="7" stroke-linejoin="round"/>
  <path d="${text("k-note", 44, { x: 256, y: 392 })}" fill="${PAPER}" fill-opacity="0.75"/>
</svg>
`;
writeFileSync(new URL("../public/icons/icon.svg", import.meta.url), icon);

// The browser-tab icon, 64 × 64: just the symbol, bold enough for 16px. It flips to paper
// in dark browser themes so it doesn't vanish on a dark tab bar.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- "Kn", the k-note symbol, readable at 16px. Drawn by scripts/make-icons.mjs. -->
  <style>
    .bg { fill: ${INK}; }
    .kn { fill: ${PAPER}; stroke: ${PAPER}; }
    @media (prefers-color-scheme: dark) {
      .bg { fill: ${PAPER}; }
      .kn { fill: ${INK}; stroke: ${INK}; }
    }
  </style>
  <rect class="bg" width="64" height="64" rx="14"/>
  <path class="kn" d="${text("Kn", 36, { x: 32, y: 45 })}" stroke-width="2.6" stroke-linejoin="round"/>
</svg>
`;
writeFileSync(new URL("../public/icons/favicon.svg", import.meta.url), favicon);

const svg = icon;
const bg = INK;

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
  const art = t.maskable || t.full ? svg.replace(/<rect width="512"[^>]*\/>/, "") : svg;
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
// The browser-tab icon's PNG fallback (light version), from favicon.svg.
const fav = readFileSync(new URL("../public/icons/favicon.svg", import.meta.url), "utf8").replace(/@media[\s\S]*?\}\s*\}/, "");
await page.emulateMedia({ colorScheme: "light" });
await page.setViewportSize({ width: 32, height: 32 });
await page.setContent(`<html><body style="margin:0">${fav.replace("<svg ", '<svg width="32" height="32" ')}</body></html>`);
await page.screenshot({ path: new URL("../public/icons/favicon-32.png", import.meta.url).pathname, omitBackground: true });
await browser.close();
console.log("icons written");
