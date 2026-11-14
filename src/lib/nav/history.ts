/**
 * Browser-style Back/Forward through the notes you've visited. Pure: each
 * function returns a new history. Only paths are kept; a missing file is
 * skipped when stepping, so deleted notes don't leave dead ends.
 */
export interface NavHistory {
  back: string[];
  forward: string[];
}

export const EMPTY_HISTORY: NavHistory = { back: [], forward: [] };

const LIMIT = 100;

/** Records leaving `from` for a new note: it goes on the Back list and Forward is cleared. */
export function visit(h: NavHistory, from: string | null): NavHistory {
  if (!from) return h.forward.length ? { back: h.back, forward: [] } : h;
  const back = h.back[h.back.length - 1] === from ? h.back : [...h.back, from].slice(-LIMIT);
  return { back, forward: [] };
}

function step(
  from: string[],
  to: string[],
  current: string | null,
  exists: (path: string) => boolean,
): { from: string[]; to: string[]; path: string } | null {
  const rest = [...from];
  while (rest.length) {
    const path = rest.pop()!;
    if (path !== current && exists(path)) {
      return { from: rest, to: current ? [...to, current].slice(-LIMIT) : to, path };
    }
  }
  return null;
}

/** Steps back from `current`: where to go and the history afterwards, or null if there's nowhere. */
export function goBack(h: NavHistory, current: string | null, exists: (path: string) => boolean) {
  const s = step(h.back, h.forward, current, exists);
  return s && { path: s.path, history: { back: s.from, forward: s.to } };
}

/** Steps forward from `current`, the reverse of goBack. */
export function goForward(h: NavHistory, current: string | null, exists: (path: string) => boolean) {
  const s = step(h.forward, h.back, current, exists);
  return s && { path: s.path, history: { back: s.to, forward: s.from } };
}

/** Keeps history pointing at a renamed or moved file. */
export function renameInHistory(h: NavHistory, from: string, to: string): NavHistory {
  const map = (list: string[]) => list.map((p) => (p === from ? to : p));
  return { back: map(h.back), forward: map(h.forward) };
}
