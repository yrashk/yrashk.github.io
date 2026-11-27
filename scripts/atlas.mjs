// The Atlas, read from its one source: site/data/atlas.ttl (hand-edited Turtle), queried with the WAT
// engine (site/data/rdf/). Everything that needs the curated data goes through here: the build (reader
// pages, posts.js, /data/atlas.js for the desktop), github-rdf.mjs and strava-rdf.mjs.
//
//   import { loadAtlas } from "./atlas.mjs";
//   const { atlas, store } = await loadAtlas("site/data");   // atlas: the plain-object shape below
//
// atlas = { person: {id, name, born, birthplace, homes: [placeId], here: placeId, stays: [{place, from, to?}]},
//           places: [{id, name, lat, lon, tz}], sectors: [{id, label}], bodies: [{id, kind, name, …}] }
// The body fields are listed in site/DATA.md ("atlas.ttl"); the desktop reads them as window.ATLAS.
// Vocabulary: site/DATA.md. Dependency-free; Node 18+.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "../site/data/rdf");
export const BASE = "https://yrashk.com/atlas/";
export const NS = "https://yrashk.com/ns#";
export const SITE = "https://yrashk.com";
const S = "https://schema.org/";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
// Ontosome's ordering module (https://ontosome.com/modules/ordering/): bodies and sectors carry an ord:rank in
// a named ordering, <ordering/chart> and <ordering/sectors>.
export const ORD = "https://ontology.inferal.com/modules/ordering/";
const PREFIXES = `PREFIX : <${BASE}> PREFIX yr: <${NS}> PREFIX schema: <${S}> PREFIX rdf: <${RDF}> PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX xsd: <http://www.w3.org/2001/XMLSchema#> PREFIX ord: <${ORD}>\n`;

// Kinds by class; after the ranked bodies, unranked ones come in this kind order.
export const KINDS = [
  ["life", "LifeEvent"],
  ["company", "Company"],
  ["project", "Project"],
  ["oss", "Repository"],
  ["writing", "Essay"],
  ["talk", "Talk"],
  ["idea", "Idea"],
];

/** An Atlas IRI back to its id: :inferal → "inferal", <place/x> → "x", <sector/x> → "x", <repo/o/n> → "o/n". */
export const idOf = (iri) => (iri.startsWith(BASE) ? iri.slice(BASE.length).replace(/^(place|sector|repo|stay)\//, "") : iri);

export async function openEngine() {
  const { openStore } = await import(join(ENGINE, "engine.js"));
  return openStore(readFileSync(join(ENGINE, "wat.wasm")));
}

export async function loadAtlas(dataDir = "site/data", { file = "atlas.ttl" } = {}) {
  const path = join(dataDir, file);
  if (!existsSync(path)) throw new Error(`atlas: ${path} is missing`);
  const store = await openEngine();
  try {
    store.loadTurtle(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`atlas: ${path}: ${e.message}`);
  }
  return { store, atlas: readAtlas(store) };
}

/** Query a store holding atlas.ttl into the plain-object Atlas. */
export function readAtlas(store) {
  const select = (q) => store.query(PREFIXES + q).rows;
  const v = (t) => (t ? t.value : undefined);
  const num = (t) => (t ? Number(t.value) : undefined);
  const bool = (t) => (t ? t.value === "true" || t.value === "1" : undefined);
  const site = (u) => (u && u.startsWith(SITE + "/") ? u.slice(SITE.length) : u);

  // rdf:List cells, so ordered values (homes, notes, repos, alsoAt) come back in order
  const cells = new Map();
  for (const [l, first, rest] of select(`SELECT ?l ?f ?r WHERE { ?l rdf:first ?f ; rdf:rest ?r }`)) cells.set(l.value, [first, rest]);
  const list = (t) => {
    const out = [];
    for (let c = t, n = 0; c && c.value !== RDF + "nil" && cells.has(c.value) && n < 1e4; n++) {
      const [f, r] = cells.get(c.value);
      out.push(f);
      c = r;
    }
    return out;
  };

  // ── person ──
  const [pr] = select(`SELECT ?p ?name ?born ?bp ?bpName ?def ?homes WHERE {
    ?p a schema:Person ; yr:homes ?homes ; schema:name ?name .
    OPTIONAL { ?p schema:birthDate ?born } OPTIONAL { ?p schema:birthPlace ?bp OPTIONAL { ?bp schema:name ?bpName } }
    OPTIONAL { ?p yr:defaultLocation ?def } } LIMIT 1`);
  if (!pr) throw new Error("atlas: no schema:Person with yr:homes");
  const [P, name, born, bp, bpName, def, homes] = pr;
  const me = P.value;
  const person = {
    id: idOf(me),
    name: v(name),
    ...(born ? { born: num(born) } : {}),
    ...(bp ? { birthplace: bp.termType === "Literal" ? bp.value : v(bpName) ?? idOf(bp.value) } : {}),
    homes: list(homes).map((t) => idOf(t.value)),
    ...(def ? { here: idOf(def.value) } : {}),
    stays: select(`SELECT ?place ?from ?to WHERE { <${me}> yr:stay ?s . ?s yr:place ?place ; schema:startDate ?from OPTIONAL { ?s schema:endDate ?to } } ORDER BY ?from ?place`).map(
      ([place, from, to]) => ({ place: idOf(place.value), from: from.value, ...(to ? { to: to.value } : {}) }),
    ),
  };

  // ── places, sectors ──
  const places = select(`SELECT ?pl ?name ?lat ?lon ?tz WHERE { ?pl a schema:Place ; schema:name ?name .
    OPTIONAL { ?pl schema:geo ?g . ?g schema:latitude ?lat ; schema:longitude ?lon } OPTIONAL { ?pl yr:timeZone ?tz } } ORDER BY ?pl`).map(
    ([pl, name, lat, lon, tz]) => ({ id: idOf(pl.value), name: name.value, ...(lat ? { lat: num(lat), lon: num(lon) } : {}), ...(tz ? { tz: tz.value } : {}) }),
  );
  // An ordering's ranks, as a sort key: ascending by default, negated for ord:DescendingRank; unranked → null.
  const ranks = (ordering) => {
    const [dir] = select(`SELECT ?d WHERE { <${BASE}${ordering}> ord:rankDirection ?d }`).map(([d]) => d.value);
    const sign = dir === ORD + "DescendingRank" ? -1 : 1;
    return new Map(select(`SELECT ?x ?r WHERE { ?x ord:inOrdering <${BASE}${ordering}> ; ord:rank ?r }`).map(([x, r]) => [x.value, sign * Number(r.value)]));
  };
  const byRank = (rank, rest) => (a, b) => {
    const ra = rank.get(a), rb = rank.get(b);
    if (ra != null && rb != null && ra !== rb) return ra - rb;
    if ((ra == null) !== (rb == null)) return ra == null ? 1 : -1;
    return rest(a, b);
  };
  const sectorRank = ranks("ordering/sectors");
  const byIri = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const sectors = select(`SELECT ?s ?label WHERE { ?s a yr:Sector ; rdfs:label ?label }`)
    .map(([s, label]) => ({ iri: s.value, id: idOf(s.value), label: label.value }))
    .sort((a, b) => byRank(sectorRank, byIri)(a.iri, b.iri))
    .map(({ iri, ...s }) => s);

  // ── bodies: anything placed in a sector ──
  const bodies = new Map();
  for (const [kind, cls] of KINDS)
    for (const [b] of select(`SELECT DISTINCT ?b WHERE { ?b a yr:${cls} ; yr:sector ?sec }`))
      if (!bodies.has(b.value)) bodies.set(b.value, { id: idOf(b.value), kind });
  const one = {
    [S + "name"]: ["name", v],
    [S + "url"]: ["url", (t) => site(t.value)],
    [S + "description"]: ["line", v],
    [S + "abstract"]: ["desc", v],
    [NS + "quote"]: ["quote", v],
    [NS + "voice"]: ["voice", v],
    [NS + "role"]: ["role", v],
    [NS + "status"]: ["status", v],
    [NS + "group"]: ["group", v],
    [NS + "sector"]: ["sector", (t) => idOf(t.value)],
    [NS + "start"]: ["start", num],
    [NS + "end"]: ["end", num],
    [NS + "approximate"]: ["approx", bool],
    [NS + "weight"]: ["weight", num],
    [NS + "position"]: ["f", num],
    [NS + "chartYear"]: ["year", num],
    [NS + "color"]: ["color", v],
    [NS + "mono"]: ["mono", bool],
    [S + "datePublished"]: ["date", v],
    [S + "startDate"]: ["date", v],
    [NS + "format"]: ["format", v],
    [NS + "slides"]: ["slides", v],
    [NS + "listed"]: ["listed", bool],
    [NS + "featured"]: ["featured", bool],
    [NS + "sample"]: ["sample", bool],
    [S + "location"]: ["place", (t) => idOf(t.value)],
    [NS + "continuedAs"]: ["continuedAs", (t) => idOf(t.value)],
    [NS + "repos"]: ["github", (t) => list(t).map((x) => idOf(x.value))],
    [NS + "notes"]: ["notes", (t) => list(t).map(v)],
    [NS + "alsoAt"]: ["also", (t) => list(t).map(v)],
  };
  const many = { [S + "keywords"]: ["tags", v], [NS + "related"]: ["related", (t) => idOf(t.value)], [NS + "githubOrganization"]: ["githubOrgs", v] };
  for (const [b, p, o] of select(`SELECT ?b ?p ?o WHERE { ?b yr:sector ?sec ; ?p ?o }`)) {
    const body = bodies.get(b.value);
    if (!body) continue;
    if (one[p.value]) { const [k, f] = one[p.value]; body[k] = f(o); }
    else if (many[p.value]) { const [k, f] = many[p.value]; (body[k] ??= []).push(f(o)); }
  }
  for (const [b, name, loc] of select(`SELECT ?b ?name ?loc WHERE { ?b yr:sector ?sec ; schema:superEvent ?e . ?e schema:name ?name OPTIONAL { ?e schema:location ?loc } }`)) {
    const body = bodies.get(b.value);
    if (body) { body.event = name.value; if (loc) body.venue = loc.value; }
  }
  // recordings: a YouTube URL becomes {yt}, anything else {href}
  const VID = { [NS + "host"]: ["host", v], [S + "name"]: ["title", v], [S + "startDate"]: ["date", v], [S + "location"]: ["venue", v], [NS + "seconds"]: ["dur", num], [NS + "startOffset"]: ["start", num], [NS + "endOffset"]: ["end", num], [NS + "streamFrom"]: ["from", num], [NS + "cut"]: ["cut", bool], [NS + "stream"]: ["stream", (t) => idOf(t.value)] };
  for (const [b, p, o] of select(`SELECT ?b ?p ?o WHERE { ?b yr:sector ?sec ; schema:recordedIn ?v . ?v ?p ?o }`)) {
    const body = bodies.get(b.value);
    if (!body) continue;
    const vid = (body.video ??= {});
    if (p.value === S + "url") {
      const yt = /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]+)/.exec(o.value) || /^https:\/\/youtu\.be\/([\w-]+)/.exec(o.value);
      if (yt) vid.yt = yt[1];
      else vid.href = o.value;
    } else if (VID[p.value]) { const [k, f] = VID[p.value]; vid[k] = f(o); }
  }
  for (const [b, t, speaker, title, talk] of select(`SELECT ?b ?t ?speaker ?title ?talk WHERE { ?b yr:sector ?sec ; schema:recordedIn ?v . ?v schema:hasPart ?c .
      ?c schema:startOffset ?t ; schema:name ?title OPTIONAL { ?c yr:speaker ?speaker } OPTIONAL { ?c yr:talk ?talk } } ORDER BY ?b ?t`)) {
    const body = bodies.get(b.value);
    if (body?.video) (body.video.chapters ??= []).push({ t: num(t), ...(speaker ? { speaker: speaker.value } : {}), title: title.value, ...(talk ? { talk: idOf(talk.value) } : {}) });
  }

  // <ordering/chart> first; unranked bodies after, by kind, start year, id
  const kindRank = Object.fromEntries(KINDS.map(([k], i) => [k, i]));
  const chartRank = ranks("ordering/chart");
  const iriOf = new Map([...bodies].map(([iri, b]) => [b, iri]));
  const fallback = (a, b) => kindRank[a.kind] - kindRank[b.kind] || (a.start ?? 0) - (b.start ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const out = [...bodies.values()]
    .sort((a, b) => byRank(chartRank, () => 0)(iriOf.get(a), iriOf.get(b)) || fallback(a, b))
    .map((b) => {
      for (const k of ["tags", "related", "githubOrgs"]) if (b[k]) b[k].sort();
      return { end: null, approx: false, ...b };
    });
  return { person, places, sectors, bodies: out };
}

// ── where he is: the same rule as site/app/clock.js ───────────────────────────
const dayIn = (tz, n) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(n);
const nextDay = (d) => new Date(Date.parse(d + "T00:00:00Z") + 864e5).toISOString().slice(0, 10);
/** The place id he is at on date `n`: the current stay, else person.here. */
export function whereOn(atlas, n = new Date()) {
  const tz = (id) => atlas.places.find((p) => p.id === id)?.tz;
  const stays = (atlas.person.stays ?? []).filter((s) => tz(s.place));
  let i = -1;
  stays.forEach((s, k) => { if (dayIn(tz(s.place), n) >= s.from) i = k; });
  const s = stays[i], next = stays[i + 1];
  if (s && !(s.to && dayIn(tz(s.place), n) > s.to && !(next && next.from <= nextDay(s.to)))) return s.place;
  return atlas.person.here ?? null;
}
