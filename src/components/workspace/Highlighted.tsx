/** Renders `text` with the given [start, end) ranges wrapped in <mark>. */
export function Highlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s < pos) continue;
    if (s > pos) parts.push(text.slice(pos, s));
    parts.push(<mark key={s}>{text.slice(s, e)}</mark>);
    pos = e;
  }
  parts.push(text.slice(pos));
  return <>{parts}</>;
}
