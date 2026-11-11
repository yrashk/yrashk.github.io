// A small browser host for the Semblance WAT RDF engine (wat.wasm, ABI 3).
//
//   import { openStore } from "./engine.js";
//   const db = await openStore(new URL("./wat.wasm", import.meta.url));
//   db.loadTurtle(text);                 // → statements parsed
//   db.query("SELECT …")                 // → { type:"select", vars, rows }   rows: Term|null per var
//   db.query("CONSTRUCT …")              // → { type:"construct", quads }     quads: {subject, predicate, object}
//   db.query("ASK …")                    // → { type:"ask", value: boolean }
//   db.query(q, { budgetMs: 150 })       // stops a long run: throws EngineError with .interrupted
//   db.check(q)                          // parse only → null | EngineError
//   db.describe(iri)                     // → every triple with the IRI as subject or object
//   db.tripleCount(); db.dispose();
//
// Terms come out RDF/JS-shaped: { termType: "NamedNode"|"BlankNode"|"Literal", value,
// datatype?, language? } (plus "Quad" for RDF 1.2 triple terms). Everything else — the
// ABI, the input/result buffers, id interning — is in rdf-engine/ABI.md upstream. The
// engine imports four host functions (`now`, `random`, `math`, `intl`); the last two
// serve its optional sx: extensions and are given minimal implementations here.
//
// ES module, no dependencies. Works in browsers and in Node 18+ (pass bytes or a Module
// when `fetch` of the wasm URL is not available).

const ABI_VERSION = 3;
const DEFAULT_GRAPH = 1;
export const Format = { NTriples: 1, NQuads: 2, Turtle: 3, TriG: 4 };
const FORM = { 1: "select", 2: "construct", 3: "ask", 4: "describe" };
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const RDF_LANG = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";

const enc = new TextEncoder();
const dec = new TextDecoder();

export class EngineError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    /** The run was stopped by the query budget (`budgetMs`). */
    this.interrupted = code === -2;
    // The engine says "… at line L, column C" / "at offset N" in some messages; keep them handy.
    const m = /line (\d+)(?:,? col(?:umn)? (\d+))?/i.exec(message);
    if (m) {
      this.line = Number(m[1]);
      if (m[2]) this.column = Number(m[2]);
    }
  }
}

const MATH_OPS = [Math.log, Math.log10, Math.log2, Math.exp, Math.pow, Math.sin, Math.cos, Math.tan, Math.asin, Math.acos, Math.atan, Math.atan2, Math.sqrt];

/** Compile the engine once; `source` is a URL/string, bytes, a Response or a Module. */
export async function compileEngine(source) {
  if (source instanceof WebAssembly.Module) return source;
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return WebAssembly.compile(source);
  const res = source instanceof Response ? source : await fetch(source);
  if (!res.ok) throw new Error(`engine: ${res.status} fetching ${res.url || source}`);
  if (typeof WebAssembly.compileStreaming === "function" && res.headers.get("content-type")?.includes("application/wasm")) {
    return WebAssembly.compileStreaming(res);
  }
  return WebAssembly.compile(await res.arrayBuffer());
}

/** Instantiate a fresh, empty store. */
export async function openStore(source, options = {}) {
  const module = await compileEngine(source);
  return new Store(module, options);
}

export class Store {
  constructor(module, { now, random } = {}) {
    let x; // exports, assigned below; the imports need the memory lazily
    const env = {
      now: now ?? (() => Date.now()),
      random: random ?? (() => Math.random()),
      math: (op, a, b) => (MATH_OPS[op] ? MATH_OPS[op](a, b) : NaN),
      // sx:Locale: out of scope here; tell the engine nothing was written.
      intl: () => -1,
    };
    x = new WebAssembly.Instance(module, { env }).exports;
    const v = x.abi_version();
    if (v !== ABI_VERSION) throw new Error(`engine ABI ${v}, host expects ${ABI_VERSION}`);
    this.x = x;
    this.terms = new Map(); // id → Term (ids are stable: we never call collect)
    this.prefixes = {};
  }

  // ── memory ───────────────────────────────────────────────────────────────
  _mem() {
    return new Uint8Array(this.x.memory.buffer);
  }
  /** Strings into the input buffer, back to back; returns byte lengths. */
  _put(...strings) {
    let max = 0;
    for (const s of strings) max += s.length * 3;
    let at = this.x.input(max);
    const mem = this._mem();
    return strings.map((s) => {
      const n = enc.encodeInto(s, mem.subarray(at)).written;
      at += n;
      return n;
    });
  }
  _putIds(ids) {
    const at = this.x.input(ids.length * 4);
    if (ids.length) new Uint32Array(this.x.memory.buffer, at, ids.length).set(ids);
  }
  _str(ptr, len) {
    return len ? dec.decode(new Uint8Array(this.x.memory.buffer, ptr, len)) : "";
  }
  _results(n) {
    return new Uint32Array(this.x.memory.buffer, this.x.result_ptr(), n).slice();
  }
  _check(r) {
    if (r < 0) throw new EngineError(this._str(this.x.error_ptr(), this.x.error_len()) || `engine error ${r}`, r);
    return r;
  }

  // ── terms ────────────────────────────────────────────────────────────────
  /** The term behind an id (cached). 0 → null (unbound). */
  term(id) {
    if (!id) return null;
    let t = this.terms.get(id);
    if (t) return t;
    const x = this.x;
    switch (x.term_kind(id)) {
      case 1:
        t = { termType: "NamedNode", value: this._str(x.term_value_ptr(id), x.term_value_len(id)) };
        break;
      case 2:
        t = { termType: "BlankNode", value: this._str(x.term_value_ptr(id), x.term_value_len(id)) };
        break;
      case 3: {
        const value = this._str(x.term_value_ptr(id), x.term_value_len(id));
        const lang = this._str(x.term_lang_ptr(id), x.term_lang_len(id));
        const dt = x.term_datatype(id);
        const datatype = dt ? this.term(dt).value : XSD_STRING;
        t = lang ? { termType: "Literal", value, language: lang, datatype: RDF_LANG } : { termType: "Literal", value, datatype };
        break;
      }
      case 4:
        t = { termType: "Quad", subject: this.term(x.triple_subject(id)), predicate: this.term(x.triple_predicate(id)), object: this.term(x.triple_object(id)) };
        break;
      case 5:
        t = { termType: "DefaultGraph", value: "" };
        break;
      default:
        return null;
    }
    t.id = id;
    this.terms.set(id, t);
    return t;
  }
  iri(value) {
    return this._check(this.x.intern_iri(this._put(value)[0]));
  }
  /** The id of an IRI already in the store, else 0. */
  lookupIri(value) {
    return this.x.lookup_iri(this._put(value)[0]);
  }

  // ── store ────────────────────────────────────────────────────────────────
  tripleCount() {
    return this.x.quad_count();
  }
  termCount() {
    return this.x.term_count();
  }
  /** Parse `text` in `format` (Format.*) into the default graph; returns statements parsed. */
  load(format, text, base = "", graph = DEFAULT_GRAPH) {
    if (format === Format.Turtle || format === Format.TriG) this._notePrefixes(text);
    const [t, b] = this._put(text, base);
    return this._check(this.x.load(format, t, b, graph));
  }
  loadTurtle(text, base = "") {
    return this.load(Format.Turtle, text, base);
  }
  /** Remember @prefix declarations, so callers can shorten IRIs the way the document did. */
  _notePrefixes(text) {
    const re = /^\s*(?:@prefix|PREFIX)\s+([A-Za-z][\w.-]*)?:\s*<([^>]*)>/gim;
    let m;
    while ((m = re.exec(text))) this.prefixes[m[1] || ""] = m[2];
  }
  /** Quads matching a pattern of ids (0 = any), as [s,p,o,g] term tuples. */
  match(s = 0, p = 0, o = 0, g = 0) {
    const ids = this._results(this._check(this.x.match(s, p, o, g)) * 4);
    const out = [];
    for (let i = 0; i < ids.length; i += 4) out.push([this.term(ids[i]), this.term(ids[i + 1]), this.term(ids[i + 2]), this.term(ids[i + 3])]);
    return out;
  }
  /** Every triple with `iri` as subject or object (a cheap DESCRIBE). */
  describe(iri) {
    const id = this.lookupIri(iri);
    if (!id) return [];
    const seen = new Set();
    const quads = [];
    for (const [s, p, o] of [...this.match(id, 0, 0, 0), ...this.match(0, 0, id, 0)]) {
      const key = `${s.id} ${p.id} ${o.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      quads.push({ subject: s, predicate: p, object: o });
    }
    return quads;
  }
  /** Apply a SPARQL Update (all or nothing). */
  update(text, base = "") {
    const [t, b] = this._put(text, base);
    this._check(this.x.update(t, b));
  }

  // ── queries ──────────────────────────────────────────────────────────────
  /**
   * Prepare and run a SPARQL 1.2 query. Returns
   *   { type:"select", vars, rows, count }     rows: arrays of Term|null
   *   { type:"construct"|"describe", quads }   quads: {subject, predicate, object}
   *   { type:"ask", value }
   */
  query(text, { base = "", bind, budgetMs = 0 } = {}) {
    const [t, b] = this._put(text, base);
    const h = this._check(this.x.prepare(t, b));
    // Budget: the engine stops a run past the deadline with an "interrupted" error (code -2).
    if (budgetMs && this.x.set_deadline) this.x.set_deadline(Date.now() + budgetMs);
    try {
      if (bind) for (const [name, id] of Object.entries(bind)) this._check(this.x.bind(h, this._put(name)[0], id));
      const form = FORM[this.x.query_form(h)];
      const vars = [];
      for (let i = 0, n = this.x.query_var_count(h); i < n; i++) vars.push(this._str(this.x.query_var_ptr(h, i), this.x.query_var_len(h, i)));
      this._putIds([]);
      const n = this._check(this.x.run(h, 0));
      if (form === "ask") return { type: "ask", value: n === 1 };
      if (form === "select") {
        const ids = this._results(n * vars.length);
        const rows = [];
        for (let r = 0; r < n; r++) {
          const row = new Array(vars.length);
          for (let c = 0; c < vars.length; c++) row[c] = this.term(ids[r * vars.length + c]);
          rows.push(row);
        }
        return { type: "select", vars, rows, count: n };
      }
      const ids = this._results(n * 3);
      const quads = [];
      for (let i = 0; i < ids.length; i += 3) quads.push({ subject: this.term(ids[i]), predicate: this.term(ids[i + 1]), object: this.term(ids[i + 2]) });
      return { type: form, quads };
    } finally {
      if (budgetMs && this.x.set_deadline) this.x.set_deadline(0);
      this.x.release(h);
    }
  }
  /** Parse only: returns null, or the EngineError a query would raise. */
  check(text, base = "") {
    try {
      const [t, b] = this._put(text, base);
      const h = this._check(this.x.prepare(t, b));
      this.x.release(h);
      return null;
    } catch (e) {
      return e;
    }
  }

  /** Shorten an IRI with the prefixes seen in loaded documents (or those given). */
  shorten(iri, prefixes = this.prefixes) {
    let best = null;
    for (const [pfx, ns] of Object.entries(prefixes)) {
      if (iri.startsWith(ns) && (!best || ns.length > best[1].length)) best = [pfx, ns];
    }
    if (!best) return null;
    const local = iri.slice(best[1].length);
    // Only when the remainder is a plausible local name (no spaces or angle brackets).
    return /^[^\s<>"{}|^`\\]*$/.test(local) ? `${best[0]}:${local}` : null;
  }

  dispose() {
    this.x = null;
    this.terms.clear();
  }
}

/** Render a term the Turtle/SPARQL way, prefixed when `shorten` can. */
export function termToString(t, shorten) {
  if (!t) return "";
  switch (t.termType) {
    case "NamedNode":
      return (shorten && shorten(t.value)) || `<${t.value}>`;
    case "BlankNode":
      return `_:${t.value}`;
    case "Literal": {
      const s = `"${t.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
      if (t.language) return `${s}@${t.language}`;
      if (t.datatype && t.datatype !== XSD_STRING) return `${s}^^${(shorten && shorten(t.datatype)) || `<${t.datatype}>`}`;
      return s;
    }
    case "Quad":
      return `<< ${termToString(t.subject, shorten)} ${termToString(t.predicate, shorten)} ${termToString(t.object, shorten)} >>`;
    default:
      return String(t.value ?? "");
  }
}
