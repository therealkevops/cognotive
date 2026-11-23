// Draws the Cognotive.ai icons and renders them to the PNG sizes the web app manifest and iOS
// need. The logo is a cog (cognition), drawn from geometry so it looks the same everywhere;
// the browser-tab version is bolder, to stay readable at 16px. Run with: node scripts/make-icons.mjs  (uses the Playwright browser)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const INK = "#18181b";
const PAPER = "#ffffff";

const f = (n) => Number(n.toFixed(2));
const at = (cx, cy, radius, angle) => `${f(cx + radius * Math.cos(angle))} ${f(cy + radius * Math.sin(angle))}`;

/**
 * A cog as one path: `teeth` teeth reaching from radius `root` to `tip`, with a round hole of
 * radius `hole` (drawn with fill-rule evenodd). Tooth sides taper slightly, as on a real gear.
 */
function cog(cx, cy, { teeth, tip, root, hole }) {
  const pitch = (2 * Math.PI) / teeth;
  const tipHalf = pitch * 0.2;
  const baseHalf = pitch * 0.27;
  let d = "";
  for (let i = 0; i < teeth; i++) {
    const a = i * pitch - Math.PI / 2;
    d += `${i === 0 ? "M" : "L"}${at(cx, cy, root, a - baseHalf)} `;
    d += `L${at(cx, cy, tip, a - tipHalf)} `;
    d += `A${tip} ${tip} 0 0 1 ${at(cx, cy, tip, a + tipHalf)} `;
    d += `L${at(cx, cy, root, a + baseHalf)} `;
    d += `A${root} ${root} 0 0 1 ${at(cx, cy, root, a + pitch - baseHalf)} `;
  }
  d += `Z M${f(cx + hole)} ${cy} A${hole} ${hole} 0 1 0 ${f(cx - hole)} ${cy} A${hole} ${hole} 0 1 0 ${f(cx + hole)} ${cy} Z`;
  return d;
}

// The app icon, 512 × 512: a paper cog on ink.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${INK}"/>
  <!-- Cognotive.ai: a cog. Drawn by scripts/make-icons.mjs. -->
  <path d="${cog(256, 256, { teeth: 8, tip: 176, root: 138, hole: 82 })}" fill="${PAPER}" fill-rule="evenodd" stroke="${PAPER}" stroke-width="10" stroke-linejoin="round"/>
</svg>
`;
writeFileSync(new URL("../public/icons/icon.svg", import.meta.url), icon);

// The browser-tab icon, 64 × 64: the cog alone, bold enough for 16px. It flips to paper in
// dark browser themes so it doesn't vanish on a dark tab bar.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <!-- The Cognotive.ai cog, readable at 16px. Drawn by scripts/make-icons.mjs. -->
  <style>
    .bg { fill: ${INK}; }
    .cog { fill: ${PAPER}; stroke: ${PAPER}; }
    @media (prefers-color-scheme: dark) {
      .bg { fill: ${PAPER}; }
      .cog { fill: ${INK}; stroke: ${INK}; }
    }
  </style>
  <rect class="bg" width="64" height="64" rx="14"/>
  <path class="cog" d="${cog(32, 32, { teeth: 8, tip: 24, root: 18.5, hole: 8.5 })}" fill-rule="evenodd" stroke-width="1.5" stroke-linejoin="round"/>
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
