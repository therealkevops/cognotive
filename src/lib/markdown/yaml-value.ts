import { parse as parseYaml } from "yaml";

/** A value written the way it goes after "name: " in YAML (lists as [a, b]); "" for an empty value. */
export function yamlValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return `[${v.map(flowItem).join(", ")}]`;
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v);
  // Plain if YAML would read it back as the same string; quoted otherwise.
  try {
    if (!/^\s|\s$/.test(s) && parseYaml(`k: ${s}`)?.k === s) return s;
  } catch {}
  return JSON.stringify(s);
}

function flowItem(v: unknown): string {
  const s = String(v);
  return /^[\p{L}\p{N}_/. -]+$/u.test(s) && !/^\s|\s$/.test(s) && !/^(true|false|null|~|\d[\d.]*)$/i.test(s) ? s : JSON.stringify(s);
}
