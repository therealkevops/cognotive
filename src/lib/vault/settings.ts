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
  /** How new links are written: [[wikilinks]], or [markdown](links.md) that also work on github.com. */
  linkFormat: "wikilink" | "markdown";
  /** Notes Repository health leaves out of its checks (the user chose "Ignore"). */
  healthIgnore: string[];
  /** Properties every new note starts with (e.g. ["created", "tags"]), in this order. */
  newNoteProperties: string[];
  /** Types chosen for the repository's own properties (built-in ones have theirs). */
  propertyTypes: Record<string, "text" | "list" | "number" | "date" | "boolean">;
  /**
   * Whether the AI chat may send this repository's notes to a remote provider.
   * "auto": yes, unless the repository is encrypted. "never": local models only.
   */
  aiRemote: "auto" | "allow" | "never";
  /** Where chats saved as notes, and answers from "Ask", go. */
  aiFolder: string;
  /** Where quick captures go: today's daily note, or one inbox note. */
  captureTo: "daily" | "inbox";
  captureInbox: string;
  /** The file tree's custom order, set by dragging: for each folder, its contents' names in order. */
  fileOrder: Record<string, string[]>;
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
  linkFormat: "wikilink",
  healthIgnore: [],
  newNoteProperties: [],
  propertyTypes: {},
  aiRemote: "auto",
  aiFolder: "AI",
  captureTo: "daily",
  captureInbox: "Inbox.md",
  fileOrder: {},
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
    if (!["auto", "allow", "never"].includes(out.aiRemote)) out.aiRemote = "auto";
    if (out.captureTo !== "daily" && out.captureTo !== "inbox") out.captureTo = "daily";
    if (!out.captureInbox.trim()) out.captureInbox = "Inbox.md";
    if (out.linkFormat !== "wikilink" && out.linkFormat !== "markdown") out.linkFormat = "wikilink";
    out.healthIgnore = Array.isArray(raw.healthIgnore) ? raw.healthIgnore.filter((p): p is string => typeof p === "string") : [];
    const types: VaultSettings["propertyTypes"] = {};
    if (raw.propertyTypes && typeof raw.propertyTypes === "object" && !Array.isArray(raw.propertyTypes)) {
      for (const [k, v] of Object.entries(raw.propertyTypes as Record<string, unknown>)) {
        if (typeof v === "string" && ["text", "list", "number", "date", "boolean"].includes(v)) types[k] = v as VaultSettings["propertyTypes"][string];
      }
    }
    out.propertyTypes = types;
    const order: VaultSettings["fileOrder"] = {};
    if (raw.fileOrder && typeof raw.fileOrder === "object" && !Array.isArray(raw.fileOrder)) {
      for (const [folder, names] of Object.entries(raw.fileOrder as Record<string, unknown>)) {
        if (Array.isArray(names)) order[folder] = names.filter((n): n is string => typeof n === "string");
      }
    }
    out.fileOrder = order;
    out.newNoteProperties = Array.isArray(raw.newNoteProperties)
      ? [...new Set(raw.newNoteProperties.filter((p): p is string => typeof p === "string" && /^[A-Za-z][\w-]*$/.test(p)))]
      : [];
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
