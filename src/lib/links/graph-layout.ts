/**
 * A small force-directed layout (Fruchterman–Reingold with a pull toward the
 * centre), for drawing a repository's link graph. Deterministic: the same
 * graph always gets the same picture, so the map doesn't jump between opens.
 */

export interface LayoutNode {
  id: string;
  /** 0–1 across the drawing area. */
  x: number;
  y: number;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Lays out `ids` connected by `edges`, scaled to fit 0–1 in both directions
 * (with `pad` left at the edges). Nodes without links settle around the rim.
 */
export function forceLayout(
  ids: string[],
  edges: Array<{ source: string; target: string }>,
  opts: { iterations?: number; pad?: number } = {},
): LayoutNode[] {
  const n = ids.length;
  if (n === 0) return [];
  const pad = opts.pad ?? 0.06;
  if (n === 1) return [{ id: ids[0], x: 0.5, y: 0.5 }];
  const index = new Map(ids.map((id, i) => [id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  ids.forEach((id, i) => {
    const a = hash(id) * Math.PI * 2;
    const r = 0.2 + 0.3 * hash(id + "#r");
    x[i] = 0.5 + r * Math.cos(a);
    y[i] = 0.5 + r * Math.sin(a);
  });
  const links = edges
    .map((e) => [index.get(e.source), index.get(e.target)] as const)
    .filter((e): e is readonly [number, number] => e[0] !== undefined && e[1] !== undefined && e[0] !== e[1]);

  const k = Math.sqrt(1 / n);
  const iterations = opts.iterations ?? Math.min(300, 60 + Math.round(6000 / n));
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let it = 0; it < iterations; it++) {
    const t = 0.1 * (1 - it / iterations) + 0.002;
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j];
        let ey = y[i] - y[j];
        let d2 = ex * ex + ey * ey;
        if (d2 < 1e-9) {
          ex = (hash(ids[i] + ids[j]) - 0.5) * 1e-3;
          ey = (hash(ids[j] + ids[i]) - 0.5) * 1e-3;
          d2 = ex * ex + ey * ey;
        }
        const f = (k * k) / d2; // repulsion k²/d, along the unit vector (e/d)
        dx[i] += ex * f;
        dy[i] += ey * f;
        dx[j] -= ex * f;
        dy[j] -= ey * f;
      }
    }
    for (const [a, b] of links) {
      const ex = x[a] - x[b];
      const ey = y[a] - y[b];
      const d = Math.sqrt(ex * ex + ey * ey) || 1e-6;
      const f = d / k; // attraction d²/k
      dx[a] -= ex * f;
      dy[a] -= ey * f;
      dx[b] += ex * f;
      dy[b] += ey * f;
    }
    for (let i = 0; i < n; i++) {
      // Gravity keeps loose notes (and separate clusters) in view.
      dx[i] -= (x[i] - 0.5) * 0.6;
      dy[i] -= (y[i] - 0.5) * 0.6;
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1e-9;
      const step = Math.min(d, t);
      x[i] += (dx[i] / d) * step;
      y[i] += (dy[i] / d) * step;
    }
  }

  const fit = (v: Float64Array) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of v) {
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
    }
    const span = hi - lo || 1;
    return (c: number) => (hi === lo ? 0.5 : pad + ((c - lo) / span) * (1 - 2 * pad));
  };
  const fx = fit(x);
  const fy = fit(y);
  return ids.map((id, i) => ({ id, x: fx(x[i]), y: fy(y[i]) }));
}
