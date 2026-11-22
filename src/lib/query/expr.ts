/**
 * Conditions for queries, as Dataview writes them:
 *   status = "active" and due < date(today)
 *   contains(tags, "garden") or !reviewed
 * Values: "strings", numbers, true/false/null, date(today|tomorrow|yesterday|"2026-12-01"),
 * field names (file.name, file.folder, file.mtime, tags, or any property), and the
 * functions contains(), length(), lower().
 */
export type Expr =
  | { k: "lit"; v: unknown }
  | { k: "field"; name: string }
  | { k: "not"; e: Expr }
  | { k: "bin"; op: "and" | "or" | "=" | "!=" | "<" | "<=" | ">" | ">="; a: Expr; b: Expr }
  | { k: "call"; fn: string; args: Expr[] };

export class QueryError extends Error {}

type Tok = { t: "str" | "num" | "id" | "op" | "(" | ")" | ","; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        s += src[j++];
      }
      if (j >= src.length) throw new QueryError("A quote isn't closed.");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["!=", "<=", ">=", "==", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two === "==" ? "=" : two === "&&" ? "and" : two === "||" ? "or" : two });
      i += 2;
      continue;
    }
    if ("=<>!".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ t: c, v: c });
      i++;
      continue;
    }
    const num = /^-?\d+(\.\d+)?(?![\w-])/.exec(src.slice(i));
    if (num) {
      out.push({ t: "num", v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = /^[\p{L}_][\p{L}\p{N}_.-]*/u.exec(src.slice(i));
    if (id) {
      const v = id[0];
      out.push(/^(and|or)$/i.test(v) ? { t: "op", v: v.toLowerCase() } : { t: "id", v });
      i += v.length;
      continue;
    }
    throw new QueryError(`Unexpected "${c}".`);
  }
  return out;
}

export function parseExpr(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];
  const expect = (t: Tok["t"]) => {
    const tok = take();
    if (!tok || tok.t !== t) throw new QueryError(`Expected "${t}".`);
    return tok;
  };
  const or = (): Expr => {
    let a = and();
    while (peek()?.t === "op" && peek().v === "or") {
      take();
      a = { k: "bin", op: "or", a, b: and() };
    }
    return a;
  };
  const and = (): Expr => {
    let a = not();
    while (peek()?.t === "op" && peek().v === "and") {
      take();
      a = { k: "bin", op: "and", a, b: not() };
    }
    return a;
  };
  const not = (): Expr => {
    if (peek()?.t === "op" && peek().v === "!") {
      take();
      return { k: "not", e: not() };
    }
    return cmp();
  };
  const cmp = (): Expr => {
    const a = primary();
    const t = peek();
    if (t?.t === "op" && ["=", "!=", "<", "<=", ">", ">="].includes(t.v)) {
      take();
      return { k: "bin", op: t.v as "=", a, b: primary() };
    }
    return a;
  };
  const primary = (): Expr => {
    const t = take();
    if (!t) throw new QueryError("The condition ends too soon.");
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "num") return { k: "lit", v: Number(t.v) };
    if (t.t === "(") {
      const e = or();
      expect(")");
      return e;
    }
    if (t.t === "id") {
      const lower = t.v.toLowerCase();
      if (lower === "true" || lower === "false") return { k: "lit", v: lower === "true" };
      if (lower === "null") return { k: "lit", v: null };
      if (peek()?.t === "(") {
        take();
        const args: Expr[] = [];
        if (peek()?.t !== ")") {
          // date(today): a bare word inside date() is a keyword, not a field.
          do {
            const a = peek();
            if (lower === "date" && a?.t === "id") {
              take();
              args.push({ k: "lit", v: a.v });
            } else args.push(or());
          } while (peek()?.t === "," && take());
        }
        expect(")");
        if (!["contains", "length", "lower", "date"].includes(lower)) throw new QueryError(`Unknown function ${t.v}().`);
        return { k: "call", fn: lower, args };
      }
      return { k: "field", name: t.v };
    }
    throw new QueryError(`Unexpected "${t.v}".`);
  };
  const e = or();
  if (p < toks.length) throw new QueryError(`Unexpected "${toks[p].v}".`);
  return e;
}

const ISO = /^\d{4}-\d{2}-\d{2}/;

function shiftDay(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== undefined && v !== false && v !== "" && v !== 0;
}

const scalar = (v: unknown): unknown => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

function compare(a: unknown, b: unknown): number {
  a = scalar(a);
  b = scalar(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number" && typeof b === "string" && b.trim() !== "" && !isNaN(Number(b))) return a - Number(b);
  if (typeof b === "number" && typeof a === "string" && a.trim() !== "" && !isNaN(Number(a))) return Number(a) - b;
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  // Dates compare by day, whatever time a property carries.
  if (ISO.test(sa) && ISO.test(sb)) return sa.slice(0, 10).localeCompare(sb.slice(0, 10));
  return sa.toLowerCase().localeCompare(sb.toLowerCase());
}

function equal(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return a.some((x) => equal(x, b));
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === "boolean" || typeof b === "boolean") return String(a).toLowerCase() === String(b).toLowerCase();
  return compare(a, b) === 0;
}

/** Evaluates an expression; `get` reads a field (undefined when missing). */
export function evaluate(e: Expr, get: (name: string) => unknown, today: string): unknown {
  switch (e.k) {
    case "lit":
      return e.v;
    case "field":
      return get(e.name);
    case "not":
      return !truthy(evaluate(e.e, get, today));
    case "call": {
      const args = e.args.map((a) => evaluate(a, get, today));
      if (e.fn === "date") {
        const v = String(args[0] ?? "").toLowerCase();
        if (v === "today" || v === "now") return today;
        if (v === "tomorrow") return shiftDay(today, 1);
        if (v === "yesterday") return shiftDay(today, -1);
        return ISO.test(v) ? v.slice(0, 10) : null;
      }
      if (e.fn === "length") return Array.isArray(args[0]) ? args[0].length : String(args[0] ?? "").length;
      if (e.fn === "lower") return String(args[0] ?? "").toLowerCase();
      // contains(list or text, value)
      const [hay, needle] = args;
      if (Array.isArray(hay)) return hay.some((x) => equal(String(x).replace(/^#/, ""), String(needle ?? "").replace(/^#/, "")));
      return String(hay ?? "").toLowerCase().includes(String(needle ?? "").toLowerCase());
    }
    case "bin": {
      if (e.op === "and") return truthy(evaluate(e.a, get, today)) && truthy(evaluate(e.b, get, today));
      if (e.op === "or") return truthy(evaluate(e.a, get, today)) || truthy(evaluate(e.b, get, today));
      const a = evaluate(e.a, get, today);
      const b = evaluate(e.b, get, today);
      if (e.op === "=") return equal(a, b);
      if (e.op === "!=") return !equal(a, b);
      // Missing values never pass an ordering test.
      if (a === null || a === undefined || b === null || b === undefined || a === "" || b === "") return false;
      const c = compare(a, b);
      return e.op === "<" ? c < 0 : e.op === "<=" ? c <= 0 : e.op === ">" ? c > 0 : c >= 0;
    }
  }
}
