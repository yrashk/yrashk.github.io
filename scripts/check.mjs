#!/usr/bin/env node
// Checks dist/ after a build. Fails (exit 1) when:
//   - an internal href/src/import in any HTML or JS file does not resolve to a file in dist/
//   - a URL the site must keep (old post permalinks, retired pages, feeds) is missing
//   - dist/strata exists (that path is served by another repository)
//   - a banned phrase from site/copy-guard.txt appears in visible page text or in generated data
//
//   node scripts/check.mjs [dir]        (default: dist)
//
// Dependency-free; Node 20+.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, posix, relative } from "node:path";

const DIST = process.argv[2] || "dist";
const problems = [];
const fail = (msg) => problems.push(msg);

// ── every URL that must exist ────────────────────────────────────────────────
const POSTS = [
  "/blog/2023/02/16/what-happens-if-you-put-http-server-inside-postgres/",
  "/blog/2023/07/20/omnigres-developer-experience/",
  "/blog/2023/04/04/make-postgres-an-application-server-gamified/",
  "/blog/2023/04/10/avoiding-postgres-extensions-limitations/",
  "/blog/2023/04/23/structured-postgres-regression-tests/",
  "/blog/2025/02/26/postgres-extensions-day-2025-montreal-registration-and-call-for-speakers/",
  "/blog/2023/04/05/plrust-just-shipped-easy-way-to-try-it-out/",
  "/blog/2023/04/09/sum-types-in-postgres/",
  "/blog/2017/09/04/solving-problems-one-commit-at-a-time/",
  "/blog/2014/04/21/team-uncommunication/",
  "/blog/2023/01/07/why-not-rust-for-omnigres/",
];
const RETIRED = [
  "/opensource/", "/opensource/ideas/", "/opensource/ideas_/", "/postgres/", "/postgres/patches/",
  "/startups/", "/startups/current/", "/startups/past/", "/startups/ideas/", "/call/", "/call/consulting/", "/call/postgres/",
  "/awesome/", "/blog/", "/blog/motd/", "/blog/page/2/",
  ...["postgres", "omnigres", "d3x", "tips", "types", "rust", "docker", "containers", "contest", "performance", "c", "git", "c4", "practices", "teamwork"].map((c) => `/blog/category/${c}/`),
];
const FILES = ["/index.html", "/404.html", "/CNAME", "/robots.txt", "/sitemap.xml", "/feed.xml", "/feed_rss_created.xml", "/feed_rss_updated.xml",
  "/data/posts.js", "/data/notes.js", "/data/shelf.js", "/data/atlas.json", "/data/atlas.js", "/data/atlas.ttl", "/data/github.js", "/data/github-detail.json", "/data/contrib.js",
  "/data/strava.js", "/data/strava.ttl", "/data/strava-tracks.json",
  "/blog/posts/canoe.png", "/blog/posts/problem_solution.png"];

// resolve a site path to a file in dist (directory → index.html; extensionless → .html)
function resolveUrl(path) {
  let f = join(DIST, decodeURIComponent(path));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!existsSync(f) && !extname(f) && existsSync(f + ".html")) f += ".html";
  return existsSync(f) && statSync(f).isFile() ? f : null;
}
for (const u of [...POSTS, ...RETIRED, ...FILES]) if (!resolveUrl(u)) fail(`required URL missing: ${u}`);
for (const u of POSTS) { const f = resolveUrl(u); if (f && !/class="prose"/.test(readFileSync(f, "utf8"))) fail(`${u} is not rendered with the reader`); }
for (const u of RETIRED) { const f = resolveUrl(u); if (f && !/http-equiv="refresh"/.test(readFileSync(f, "utf8"))) fail(`${u} is not a redirect stub`); }
if (existsSync(join(DIST, "strata"))) fail("dist/strata exists; /strata is served by another repository");
if (existsSync(join(DIST, "CNAME")) && readFileSync(join(DIST, "CNAME"), "utf8").trim() !== "yrashk.com") fail("CNAME is not yrashk.com");

// ── internal links ───────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) { const p = join(dir, e); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
}
const files = walk(DIST);
const SKIP = /^(https?:|mailto:|tel:|data:|javascript:|#|blob:)/i;
let links = 0;
for (const file of files) {
  const ext = extname(file);
  if (![".html", ".js", ".mjs", ".xml"].includes(ext)) continue;
  const text = readFileSync(file, "utf8");
  const refs = new Set();
  if (ext === ".html" || ext === ".xml") {
    for (const m of text.matchAll(/\b(?:href|src|poster|url)=["']([^"'#?]+)[^"']*["']/g)) refs.add(m[1]);
    for (const m of text.matchAll(/content="\d+;\s*url=([^"#?]+)/g)) refs.add(m[1]);
    for (const m of text.matchAll(/<loc>([^<]+)<\/loc>/g)) refs.add(m[1]);
  }
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{0,2}\/[^"']+)["']/g)) refs.add(m[1]);
  for (const m of text.matchAll(/(?:fetch|URL)\(\s*["'](\.{0,2}\/[^"']+)["']/g)) refs.add(m[1]);
  const base = "/" + posix.join(relative(DIST, dirname(file)).split("\\").join("/"), "/");
  for (let ref of refs) {
    if (SKIP.test(ref) || ref.includes("${")) continue; // template literals in the shell's scripts
    ref = ref.replace(/[?#].*$/, ""); // cache-busting ?v=… and fragments name the same file
    if (ref.startsWith("https://yrashk.com/")) ref = ref.slice("https://yrashk.com".length);
    if (/^[a-z]+:/i.test(ref)) continue;
    links++;
    const path = ref.startsWith("/") ? ref : posix.normalize(posix.join(base, ref));
    if (path.startsWith("/strata/")) continue; // another repository serves it
    if (!resolveUrl(path)) fail(`${relative(DIST, file)} → ${ref} does not resolve`);
  }
}

// ── copy guard ───────────────────────────────────────────────────────────────
// site/copy-guard.txt: one phrase (case-insensitive) or /regex/ per line; # starts a comment.
const guardFile = "site/copy-guard.txt";
const rules = existsSync(guardFile)
  ? readFileSync(guardFile, "utf8").split("\n").map((l) => l.replace(/(^|\s)#.*$/, "").trim()).filter(Boolean)
    .map((l) => { const m = l.match(/^\/(.+)\/([a-z]*)$/); return m ? { src: l, re: new RegExp(m[1], m[2].includes("i") ? m[2] : m[2] + "i") } : { src: l, re: new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }; })
  : [];
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " }[e]));
// What a reader can see: text nodes plus title/alt/aria-label/meta content/placeholder, minus comments,
// code blocks, and script/style bodies, from which only string literals (UI copy built in JS) are kept.
function visibleText(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ");
  const strings = [];
  s = s.replace(/<(script|style)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, body) => {
    if (tag.toLowerCase() === "script") for (const m of body.matchAll(/`((?:[^`\\]|\\.)*)`|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) strings.push(m[1] ?? m[2] ?? m[3]);
    return " ";
  });
  s = s.replace(/<pre\b[\s\S]*?<\/pre>/gi, " ").replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, " ");
  const attrs = [...s.matchAll(/\b(?:title|alt|aria-label|content|placeholder|aria-description)=["']([^"']*)["']/g)].map((m) => m[1]);
  const text = s.replace(/<[^>]+>/g, " ");
  return decode([text, ...attrs, ...strings].join("\n"));
}
const GUARDED_DATA = ["data/atlas.json", "data/atlas.ttl", "data/posts.js", "data/notes.js", "data/shelf.js"];
if (rules.length) {
  for (const file of files) {
    const rel = relative(DIST, file);
    const ext = extname(file);
    let text;
    if (ext === ".html") text = visibleText(readFileSync(file, "utf8"));
    else if (GUARDED_DATA.includes(rel)) text = readFileSync(file, "utf8");
    else continue;
    for (const r of rules) {
      const m = text.match(r.re);
      if (m) { const i = m.index, ctx = text.slice(Math.max(0, i - 40), i + m[0].length + 40).replace(/\s+/g, " "); fail(`copy guard: "${r.src}" in ${rel}: …${ctx}…`); }
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`check: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`check: ok — ${files.length} files, ${links} internal links, ${POSTS.length} posts, ${RETIRED.length} redirects, ${rules.length} copy rules`);
