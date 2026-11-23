import { basename } from "../vault/paths";

/*
 * Attachments nothing uses any more: no note, drawing or canvas links to them, and their
 * file name appears in no file's text either (a safety margin: a name in any form, even in
 * a link the index doesn't understand, counts as used). Offered for deleting in Settings.
 */

export interface SizedFile {
  path: string;
  size: number;
}

export function unusedAttachments(attachments: SizedFile[], isLinked: (path: string) => boolean, texts: Iterable<string>): SizedFile[] {
  const candidates = attachments.filter((a) => !isLinked(a.path));
  if (!candidates.length) return [];
  const all = [...texts].join("\n").toLowerCase();
  return candidates
    .filter((a) => {
      const name = basename(a.path).toLowerCase();
      return !all.includes(name) && !all.includes(encodeURI(name)) && !all.includes(name.replace(/ /g, "%20"));
    })
    .sort((a, b) => b.size - a.size || a.path.localeCompare(b.path));
}
