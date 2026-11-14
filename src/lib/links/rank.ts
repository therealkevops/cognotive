/**
 * Extra weight for a link suggestion, on top of how well it matches what was
 * typed (the editor's matcher already puts title-prefix matches first). Notes
 * you opened recently come next, then notes many others link to. Stays small
 * enough that a better text match still wins.
 */
export function linkBoost(opts: { recentRank?: number; inbound?: number }): number {
  const recent = opts.recentRank === undefined ? 0 : Math.max(0, 30 - opts.recentRank * 3);
  const popular = Math.min(15, Math.round(Math.log2(1 + (opts.inbound ?? 0)) * 5));
  return recent + popular;
}
