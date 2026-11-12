#!/usr/bin/env node
// Turns a Strava bulk export into the site's activity data and its RDF.
//
//   node scripts/strava-rdf.mjs [export.zip | export-dir] [dataDir]   (default dataDir: site/data)
//   npm run strava           (no path: the newest ~/Downloads/export_*.zip)
//   npm run strava:update    (that, then build and check; commit and push the three data files after)
//   node scripts/strava-rdf.mjs --empty [dataDir]                     (no-data placeholders)
//
// The export comes from Strava → Settings → My Account → Download or Delete Your Account →
// Request Your Archive. Only activities.csv and activities/* are read; photos, posts and the rest
// of the archive are never opened. The zip itself is never committed.
//
// Writes:
//   dataDir/strava.js           `window.STRAVA = {…}` (summaries for the charts; null with no data)
//   dataDir/strava-tracks.json  simplified, privacy-trimmed routes for the map (loaded on demand)
//   dataDir/strava.ttl          every activity as RDF (loaded third by the query console)
//
// Privacy (see site/DATA.md, "Strava"):
//   - no activity names, descriptions, notes, gear, photos, heart rate, calories or Strava ids
//     (ids would lead to the activity on strava.com); activities are numbered by date instead
//   - times are kept to the local hour; places only as the nearest Atlas place within 60 km
//   - every route loses its first and last kilometre (where home usually is), GPS jumps split it,
//     and points inside private zones are dropped
//   - private zones and excluded activities live in .strava-private.json at the repo root, which is
//     gitignored (it would itself say where home is):
//       { "trim": 1000, "zones": [{ "lat": 49.7, "lon": -124.9, "radius": 600 }], "exclude": ["123"] }
//     `exclude` takes Strava activity ids, read here and never written out.
//   - if the export marks visibility, only activities visible to everyone are kept
//
// Dependency-free (uses the system `unzip` for .zip); Node 20+.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const empty = args[0] === "--empty";
// No path given: the newest Strava export in ~/Downloads (Strava names them export_<athlete id>.zip).
function newestExport() {
  const dl = join(homedir(), "Downloads");
  if (!existsSync(dl)) return null;
  const zips = readdirSync(dl).filter((f) => /^export_\d+.*\.zip$/.test(f)).map((f) => join(dl, f));
  return zips.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}
const source = empty ? null : args[0] || newestExport();
if (!empty && !args[0] && source) console.log(`strava-rdf: using ${source}`);
const dataDir = (empty ? args[1] : args[1]) || "site/data";
if (!empty && !source) {
  console.error("strava-rdf: no export given and none in ~/Downloads\nusage: node scripts/strava-rdf.mjs [export.zip | export-dir] [dataDir]\n       node scripts/strava-rdf.mjs --empty [dataDir]");
  process.exit(2);
}

const PREFIXES = {
  "": "https://yrashk.com/atlas/",
  yr: "https://yrashk.com/ns#",
  schema: "https://schema.org/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
};
const ttlHead = (note) =>
  Object.entries(PREFIXES).map(([p, iri]) => `@prefix ${p}: <${iri}> .`).join("\n") + `\n\n# Strava activities of yrashk.com (scripts/strava-rdf.mjs). ${note}\n`;

function writeEmpty() {
  writeFileSync(join(dataDir, "strava.js"), "// Strava activities (scripts/strava-rdf.mjs): no export imported yet.\nwindow.STRAVA = null;\n");
  writeFileSync(join(dataDir, "strava-tracks.json"), '{"tracks":[]}\n');
  writeFileSync(join(dataDir, "strava.ttl"), ttlHead("No export imported yet."));
  console.log(`strava-rdf: wrote empty placeholders to ${dataDir}`);
}
if (empty) {
  writeEmpty();
  process.exit(0);
}

// ── private settings (gitignored) ────────────────────────────────────────────
const privFile = ".strava-private.json";
const priv = existsSync(privFile) ? JSON.parse(readFileSync(privFile, "utf8")) : {};
// The zones' random offsets come from a secret seed kept in the private file, so a re-import places
// them exactly as before: fresh randomness each time would let old and new versions (all public in
// git history) be overlaid to narrow down what they hide.
if (!priv.seed) {
  priv.seed = randomBytes(16).toString("hex");
  writeFileSync(privFile, JSON.stringify(priv, null, 2) + "\n");
  console.log(`strava-rdf: created ${privFile} with a private seed (gitignored; keep it)`);
}
const seeded = (key) => { const h = createHash("sha256").update(priv.seed + key).digest(); return [0, 4, 8].map((i) => h.readUInt32LE(i) / 2 ** 32); };
const TRIM = priv.trim ?? 1000;
const ZONES = [...(priv.zones ?? [])];
// Places where activities often start or end (home, work, family) become private zones on their own:
// any ~250 m cell holding the start or end of AUTO_MIN activities hides AUTO_RADIUS around it.
const AUTO_MIN = priv.autoZones?.min ?? 3;
const AUTO_RADIUS = priv.autoZones?.radius ?? 600;
const EXCLUDE = new Set((priv.exclude ?? []).map(String));

// ── the export: a directory, or a zip unpacked to a temporary one ────────────
let dir = source;
let tmp = null;
if (statSync(source).isFile()) {
  tmp = mkdtempSync(join(tmpdir(), "strava-"));
  execFileSync("unzip", ["-qq", "-o", source, "activities.csv", "activities/*", "-d", tmp], { stdio: ["ignore", "ignore", "inherit"] });
  dir = tmp;
}
const csvFile = join(dir, "activities.csv");
if (!existsSync(csvFile)) {
  console.error(`strava-rdf: no activities.csv in ${source}`);
  process.exit(1);
}

// ── CSV (quoted fields, embedded commas and newlines, repeated header names) ─
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const [header, ...records] = parseCsv(readFileSync(csvFile, "utf8").replace(/^﻿/, ""));
// Column lookup; Strava repeats some names (the second "Distance" is in metres, the first in km or mi).
const cols = (name) => header.map((h, i) => (h.trim().toLowerCase() === name.toLowerCase() ? i : -1)).filter((i) => i >= 0);
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const C = {
  id: cols("Activity ID")[0],
  date: cols("Activity Date")[0],
  type: cols("Activity Type")[0],
  file: cols("Filename")[0],
  dist: cols("Distance"),
  moving: cols("Moving Time")[0],
  elapsed: cols("Elapsed Time"),
  elev: cols("Elevation Gain")[0],
  vis: header.findIndex((h) => /^(activity )?visibility$/i.test(h.trim())), // not "Weather Visibility" (metres)
};
for (const k of ["id", "date", "type"]) if (C[k] === undefined) { console.error(`strava-rdf: activities.csv has no "${k}" column`); process.exit(1); }

// "Mar 14, 2015, 1:23:45 AM" (UTC) → Date
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseDate(s) {
  const m = String(s).match(/([A-Za-z]{3})\w*\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}):(\d{2}) ?([AP]M)?/i);
  if (!m) { const d = new Date(s); return isNaN(d) ? null : d; }
  let h = +m[4];
  if (m[7]) h = (h % 12) + (m[7].toUpperCase() === "PM" ? 12 : 0);
  return new Date(Date.UTC(+m[3], MON[m[1].toLowerCase()], +m[2], h, +m[5], +m[6]));
}

// ── tracks: GPX, TCX, FIT (each possibly .gz) → [[lat, lon], …] ──────────────
function readTrack(rel) {
  if (!rel) return null;
  const file = join(dir, rel);
  if (!existsSync(file)) return null;
  let buf = readFileSync(file);
  let name = rel.toLowerCase();
  if (name.endsWith(".gz")) { try { buf = gunzipSync(buf); } catch { return null; } name = name.slice(0, -3); }
  try {
    if (name.endsWith(".gpx")) {
      const s = buf.toString("utf8"), out = [];
      for (const m of s.matchAll(/<trkpt\b([^>]*)>/g)) {
        const lat = m[1].match(/lat="([-\d.]+)"/), lon = m[1].match(/lon="([-\d.]+)"/);
        if (lat && lon) out.push([+lat[1], +lon[1]]);
      }
      return out;
    }
    if (name.endsWith(".tcx")) {
      const s = buf.toString("utf8"), out = [];
      for (const m of s.matchAll(/<LatitudeDegrees>([-\d.]+)<\/LatitudeDegrees>\s*<LongitudeDegrees>([-\d.]+)<\/LongitudeDegrees>/g)) out.push([+m[1], +m[2]]);
      return out;
    }
    if (name.endsWith(".fit")) return readFit(buf);
  } catch (e) {
    console.warn(`strava-rdf: could not read ${rel}: ${e.message}`);
  }
  return null;
}

// Minimal FIT decoder: walks definition and data messages and keeps the positions of `record`
// messages (global 20, fields 0/1 in semicircles). Developer fields and compressed timestamps are
// stepped over; nothing else is interpreted.
function readFit(buf) {
  const hsize = buf[0];
  if (buf.toString("ascii", 8, 12) !== ".FIT") throw new Error("not a FIT file");
  const end = hsize + buf.readUInt32LE(4);
  const defs = new Map();
  const out = [];
  const SEMI = 180 / 2 ** 31;
  let p = hsize;
  while (p < end && p < buf.length) {
    const h = buf[p++];
    if (h & 0x80) { // compressed timestamp header: a data message of local type (h >> 5) & 3
      const d = defs.get((h >> 5) & 3);
      if (!d) throw new Error("data before definition");
      p = readData(d, p);
      continue;
    }
    const local = h & 0x0f;
    if (h & 0x40) { // definition
      const le = buf[p + 1] === 0;
      const global = le ? buf.readUInt16LE(p + 2) : buf.readUInt16BE(p + 2);
      const n = buf[p + 4];
      p += 5;
      const fields = [];
      for (let i = 0; i < n; i++, p += 3) fields.push({ num: buf[p], size: buf[p + 1] });
      let dev = 0;
      if (h & 0x20) { const nd = buf[p++]; for (let i = 0; i < nd; i++, p += 3) dev += buf[p + 1]; }
      defs.set(local, { le, global, fields, dev });
    } else {
      const d = defs.get(local);
      if (!d) throw new Error("data before definition");
      p = readData(d, p);
    }
  }
  return out;
  function readData(d, at) {
    let lat = null, lon = null;
    for (const f of d.fields) {
      if (d.global === 20 && (f.num === 0 || f.num === 1) && f.size === 4) {
        const v = d.le ? buf.readInt32LE(at) : buf.readInt32BE(at);
        if (v !== 0x7fffffff) { if (f.num === 0) lat = v * SEMI; else lon = v * SEMI; }
      }
      at += f.size;
    }
    if (lat !== null && lon !== null) out.push([lat, lon]);
    return at + d.dev;
  }
}

// ── geometry ─────────────────────────────────────────────────────────────────
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function meters(a, b) {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
// Trim both ends, split at GPS jumps and private zones; returns segments of ≥ 2 points.
function sanitize(pts) {
  pts = pts.filter((p) => Math.abs(p[0]) > 1e-6 || Math.abs(p[1]) > 1e-6);
  if (pts.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + meters(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const segs = [];
  let seg = [];
  for (let i = 0; i < pts.length; i++) {
    const keep = cum[i] >= TRIM && cum[i] <= total - TRIM && !ZONES.some((z) => meters(pts[i], [z.lat, z.lon]) < (z.radius ?? 500));
    const jump = seg.length && meters(seg[seg.length - 1], pts[i]) > 1000;
    if (!keep || jump) { if (seg.length > 1) segs.push(seg); seg = []; }
    if (keep) seg.push(pts[i]);
  }
  if (seg.length > 1) segs.push(seg);
  return segs;
}
// Douglas–Peucker in local metres.
function simplify(pts, tol = 15) {
  if (pts.length < 3) return pts;
  const k = Math.cos(rad(pts[0][0]));
  const xy = pts.map(([la, lo]) => [lo * 111320 * k, la * 110540]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * xy[i][0] - dx * xy[i][1] + bx * ay - by * ax) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// Google encoded polyline, precision 5.
function encode(pts) {
  let out = "", pla = 0, plo = 0;
  const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) {
    const a = Math.round(la * 1e5), b = Math.round(lo * 1e5);
    out += enc(a - pla) + enc(b - plo);
    pla = a; plo = b;
  }
  return out;
}

// ── places and local time, from the Atlas ────────────────────────────────────
const atlas = existsSync(join(dataDir, "atlas.json")) ? JSON.parse(readFileSync(join(dataDir, "atlas.json"), "utf8")) : { places: [], bodies: [] };
const PLACES = (atlas.places ?? []).filter((p) => p.lat != null);
const bodyIds = new Set((atlas.bodies ?? []).map((b) => b.id));
const placeIri = (id) => (bodyIds.has(id) ? `<${PREFIXES[""]}place/${id}>` : `:${id}`); // same rule as atlas-rdf.mjs
function nearest(pt, within) {
  let best = null, bd = Infinity;
  for (const p of PLACES) { const d = meters(pt, [p.lat, p.lon]); if (d < bd) { bd = d; best = p; } }
  return bd <= within ? best : null;
}
function localParts(date, tz, lon) {
  if (tz) {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const g = (t) => f.find((x) => x.type === t).value;
    return { day: `${g("year")}-${g("month")}-${g("day")}`, hour: +g("hour") };
  }
  const d = new Date(date.getTime() + Math.round((lon ?? 0) / 15) * 3600e3);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

// ── activities ───────────────────────────────────────────────────────────────
const acts = [];
let skipped = 0, noTrack = 0;
for (const r of records) {
  const sid = r[C.id];
  if (!sid || EXCLUDE.has(String(sid))) { skipped++; continue; }
  if (C.vis >= 0 && r[C.vis] && !/^(everyone|public)$/i.test(r[C.vis].trim())) { skipped++; continue; }
  const when = parseDate(r[C.date]);
  if (!when) { skipped++; continue; }
  const distCols = C.dist.map((i) => num(r[i]));
  const dist = distCols.length > 1 ? (distCols[1] ?? (distCols[0] ?? 0) * 1000) : (distCols[0] ?? 0) * 1000;
  const pts = readTrack(C.file !== undefined ? r[C.file] : null);
  if (!pts || pts.length < 2) noTrack++;
  const start = pts && pts.length ? pts[0] : null;
  acts.push({
    sid, when, start,
    type: (r[C.type] || "Workout").trim(),
    dist: Math.round(dist),
    moving: Math.round(num(r[C.moving]) ?? num(r[C.elapsed[0]]) ?? 0),
    elapsed: Math.round(num(r[C.elapsed[0]]) ?? 0),
    elev: Math.round(num(r[C.elev]) ?? 0),
    pts: pts && pts.length > 1 ? pts : null,
  });
}
if (tmp) rmSync(tmp, { recursive: true, force: true });

// Automatic private zones from start/end hotspots (never written anywhere).
const hotspots = [];
{
  const cells = new Map();
  const cell = ([la, lo]) => `${Math.round(la / 0.00225)}:${Math.round(lo / (0.00225 / Math.max(0.2, Math.cos(rad(la)))))}`;
  for (const a of acts) {
    if (!a.pts) continue;
    const ends = [a.pts[0], a.pts[a.pts.length - 1]];
    if (cell(ends[0]) === cell(ends[1])) ends.pop(); // a loop counts once
    for (const pt of ends) {
      const k = cell(pt), c = cells.get(k) ?? { n: 0, la: 0, lo: 0 };
      c.n++; c.la += pt[0]; c.lo += pt[1];
      cells.set(k, c);
    }
  }
  let auto = 0;
  // Each zone is moved up to 300 m and sized 1–1.5× (seeded, so stable across re-imports), so the hole a
  // zone leaves in the routes is not centred on the place it hides.
  for (const [key, c] of cells) {
    if (c.n < AUTO_MIN) continue;
    const [u1, u2, u3] = seeded(key);
    const la = c.la / c.n, lo = c.lo / c.n, d = u1 * 300;
    hotspots.push([la, lo]);
    const t = u2 * 2 * Math.PI;
    ZONES.push({ lat: la + (d * Math.sin(t)) / 110540, lon: lo + (d * Math.cos(t)) / (111320 * Math.cos(rad(la))), radius: AUTO_RADIUS * (1 + u3 / 2) + d });
    auto++;
  }
  if (auto) console.log(`strava-rdf: ${auto} automatic private zone(s) around frequent start/end points (radius ${AUTO_RADIUS}–${AUTO_RADIUS * 1.5 + 300} m, off-centre)`);
}
for (const a of acts) { a.segs = a.pts ? sanitize(a.pts).map((s) => simplify(s)) : []; delete a.pts; }
// Self-check: how close does any published point come to a hotspot it was meant to hide?
if (hotspots.length) {
  let min = Infinity;
  for (const a of acts) for (const sg of a.segs) for (const pt of sg) for (const h of hotspots) { const d = meters(pt, h); if (d < min) min = d; }
  console.log(`strava-rdf: closest published point to a hidden start/end hotspot: ${isFinite(min) ? Math.round(min) + " m" : "none"}`);
  if (min < AUTO_RADIUS) { console.error("strava-rdf: a route comes inside a private zone; refusing to write"); process.exit(1); }
}
acts.sort((a, b) => a.when - b.when);

// Time zone: the nearest Atlas place within 300 km of the start, else the last one seen.
let lastTz = null;
const perDay = new Map();
for (const a of acts) {
  const near = a.start ? nearest(a.start, 300e3) : null;
  const tz = near?.tz ?? (a.start ? null : lastTz);
  if (near?.tz) lastTz = near.tz;
  Object.assign(a, localParts(a.when, tz, a.start?.[1]));
  a.place = a.start ? nearest(a.start, 60e3)?.id ?? null : null;
  const n = (perDay.get(a.day) ?? 0) + 1;
  perDay.set(a.day, n);
  a.id = `${a.day}-${n}`;
}

// ── outputs ──────────────────────────────────────────────────────────────────
const types = [...new Set(acts.map((a) => a.type))].sort();
const places = [...new Set(acts.map((a) => a.place).filter(Boolean))].sort();
const data = {
  generated: new Date().toISOString().slice(0, 10),
  fields: ["day", "hour", "type", "distance_m", "moving_s", "elevation_m", "place", "track"],
  types,
  places: places.map((id) => ({ id, name: PLACES.find((p) => p.id === id)?.name ?? id })),
  acts: acts.map((a) => [a.day, a.hour, types.indexOf(a.type), a.dist, a.moving, a.elev, a.place ? places.indexOf(a.place) : -1, a.segs.length ? 1 : 0]),
};
writeFileSync(join(dataDir, "strava.js"), `// Strava activities (scripts/strava-rdf.mjs). Fields per activity: ${data.fields.join(", ")}.\nwindow.STRAVA = ${JSON.stringify(data)};\n`);

const tracks = [];
for (const a of acts) if (a.segs.length) tracks.push([a.id, ...a.segs.map(encode)]); // [activity id, …encoded segments]
writeFileSync(join(dataDir, "strava-tracks.json"), JSON.stringify({ tracks }) + "\n");

const str = (s) => JSON.stringify(s);
const actIri = (a) => `<${PREFIXES[""]}strava/${a.id}>`; // full IRIs: "/" is not allowed in a prefixed name
const lines = [ttlHead(`${acts.length} activities, ${data.generated}. Names, ids, routes and heart rate are left out.`)];
lines.push(`:yrashk yr:did\n    ${acts.map(actIri).join(",\n    ")} .\n`);
for (const a of acts) {
  const p = [
    "a yr:Activity, schema:ExerciseAction",
    `schema:exerciseType ${str(a.type)}`,
    `schema:startDate "${a.day}"^^xsd:date`,
    `yr:hour ${a.hour}`,
    `yr:distance ${a.dist}.0`,
    `yr:movingTime ${a.moving}`,
    `yr:elapsedTime ${a.elapsed}`,
    `yr:elevationGain ${a.elev}.0`,
  ];
  if (a.place) p.push(`schema:location ${placeIri(a.place)}`);
  lines.push(`${actIri(a)} ${p.join(" ;\n    ")} .`);
}
writeFileSync(join(dataDir, "strava.ttl"), lines.join("\n") + "\n");

const kb = (f) => Math.round(statSync(join(dataDir, f)).size / 1024);
console.log(`strava-rdf: ${acts.length} activities (${skipped} skipped, ${noTrack} without a route), ${types.length} types, ${tracks.length} routes`);
console.log(`  → strava.js ${kb("strava.js")} KiB · strava-tracks.json ${kb("strava-tracks.json")} KiB · strava.ttl ${kb("strava.ttl")} KiB`);
