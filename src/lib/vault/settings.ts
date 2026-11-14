/**
 * Per-vault settings, kept in the vault itself at .noted/settings.json so they
 * sync with GitHub vaults and follow the vault to other devices.
 */
export interface VaultSettings {
  /** Where pasted, dropped and uploaded files go. */
  attachmentFolder: string;
  /** Daily notes: folder, file name format, and an optional template note. */
  dailyFolder: string;
  dailyFormat: string;
  dailyTemplate: string;
  /** Folder whose notes are offered by "Insert template". */
  templateFolder: string;
  /** Also save "Name.excalidraw.svg" next to each drawing, so it shows on github.com. */
  drawingSvgCopy: boolean;
  /** Where a note created from a link goes: the linking note's folder, the vault root, or `newNoteFolder`. */
  newNoteLocation: "current" | "root" | "folder";
  newNoteFolder: string;
}

export const SETTINGS_PATH = ".noted/settings.json";

export const DEFAULT_SETTINGS: VaultSettings = {
  attachmentFolder: "attachments",
  dailyFolder: "Daily",
  dailyFormat: "YYYY-MM-DD",
  dailyTemplate: "",
  templateFolder: "Templates",
  drawingSvgCopy: false,
  newNoteLocation: "current",
  newNoteFolder: "",
};

export function parseSettings(text: string | undefined): VaultSettings {
  if (!text) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(text) as Partial<Record<keyof VaultSettings, unknown>>;
    const out = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof VaultSettings>) {
      const v = raw[key];
      if (typeof v === typeof DEFAULT_SETTINGS[key]) (out as Record<string, unknown>)[key] = v;
    }
    if (!["current", "root", "folder"].includes(out.newNoteLocation)) out.newNoteLocation = "current";
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function serializeSettings(s: VaultSettings): string {
  return JSON.stringify(s, null, 2) + "\n";
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Formats a date with Moment-style tokens, as Obsidian's daily notes do:
 * YYYY YY MMMM MMM MM M DD D dddd ddd HH H mm ss. Text in [brackets] is literal.
 */
export function formatDate(date: Date, format: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const tokens: Record<string, () => string> = {
    YYYY: () => String(date.getFullYear()),
    YY: () => String(date.getFullYear()).slice(-2),
    MMMM: () => MONTHS[date.getMonth()],
    MMM: () => MONTHS[date.getMonth()].slice(0, 3),
    MM: () => pad(date.getMonth() + 1),
    M: () => String(date.getMonth() + 1),
    DD: () => pad(date.getDate()),
    D: () => String(date.getDate()),
    dddd: () => DAYS[date.getDay()],
    ddd: () => DAYS[date.getDay()].slice(0, 3),
    HH: () => pad(date.getHours()),
    H: () => String(date.getHours()),
    mm: () => pad(date.getMinutes()),
    ss: () => pad(date.getSeconds()),
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|ss/g, (m, literal) =>
    literal !== undefined ? literal : tokens[m](),
  );
}

/**
 * Fills a template: {{title}}, {{date}}, {{time}}, and {{date:FORMAT}} /
 * {{time:FORMAT}} with custom formats.
 */
export function fillTemplate(template: string, vars: { title: string; now: Date }): string {
  return template.replace(/\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/g, (_, name: string, fmt?: string) => {
    if (name === "title") return vars.title;
    if (name === "date") return formatDate(vars.now, fmt?.trim() || "YYYY-MM-DD");
    return formatDate(vars.now, fmt?.trim() || "HH:mm");
  });
}

/**
 * Where to create the note a link points to: a folder written in the link
 * ("Projects/Idea") wins; otherwise the vault's setting decides, relative to
 * the note the link is in.
 */
export function newNoteFromLink(
  target: string,
  from: string | null | undefined,
  s: Pick<VaultSettings, "newNoteLocation" | "newNoteFolder">,
): { folder: string; name: string } {
  const clean = target.trim().replace(/\.md$/i, "").replace(/^\/+/, "");
  const slash = clean.lastIndexOf("/");
  if (slash !== -1) return { folder: clean.slice(0, slash), name: clean.slice(slash + 1) };
  const folder =
    s.newNoteLocation === "root"
      ? ""
      : s.newNoteLocation === "folder"
        ? s.newNoteFolder.trim().replace(/^\/+|\/+$/g, "")
        : from && from.includes("/")
          ? from.slice(0, from.lastIndexOf("/"))
          : "";
  return { folder, name: clean };
}
