#!/usr/bin/env node
// Builds yrashk.com into dist/.
//
//   node scripts/build.mjs
//
// Reads:
//   APP_DIR/index.html        the OS app shell (copied with path rewrites); other files copied as-is
//   DATA_DIR/                 github/atlas/contrib data, RDF engine, portraits → /data/
//   site/content/posts/*.md   posts (Markdown + frontmatter); *.html = frontmatter + raw HTML body
//   site/content/notes/*.md   notes
//   site/content/shelf/*.md   ideas on the shelf (not built yet)
//   site/templates/           article.html, 404.html
//   site/static/              copied verbatim to the site root
// Writes dist/: the shell at /, every post at its permalink, /data/posts.js, /data/notes.js,
// feeds, sitemap, robots, CNAME, 404, and redirect stubs for retired pages.
//
// Node 20+. Markdown via markdown-it; highlighting at build time via shiki (CSS-variables theme,
// so the reader's own colors apply; no client-side highlighter).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import container from "markdown-it-container";
import mark from "markdown-it-mark";
import attrs from "markdown-it-attrs";
import anchor from "markdown-it-anchor";
import { bundledLanguages, createCssVariablesTheme, createHighlighter } from "shiki";

// ── locations ────────────────────────────────────────────────────────────────
const APP_DIR = "site/app"; // the OS shell (index.html, sparql.js, …)
const DATA_DIR = "site/data"; // github/atlas/contrib data, RDF engine, portraits
// Development-only files that must not ship.
const DEV_ONLY = new Set(["article.html", "sparql-harness.html", "yrashk.jpeg", "README.md"]);

const SITE = "site";
const POSTS_DIR = join(SITE, "content/posts");
const NOTES_DIR = join(SITE, "content/notes");
const SHELF_DIR = join(SITE, "content/shelf");
const TEMPLATES = join(SITE, "templates");
const STATIC = join(SITE, "static");
const DIST = "dist";

const ORIGIN = "https://yrashk.com";
const AUTHOR = "Yurii Rashkovskii";
const SITE_TITLE = `${AUTHOR}`;
const SITE_DESC = "Founder of Inferal. Essays and notes on how people and systems work.";
// The prototype shell links the sample article as article.html; it is this post.
const SAMPLE_ARTICLE = "/blog/2023/02/16/what-happens-if-you-put-http-server-inside-postgres/";
// Old pages that no longer exist. Blog listings go to the writing workspace, the rest to the desktop.
const RETIRED = {
  "/": ["/opensource/", "/opensource/ideas/", "/opensource/ideas_/", "/postgres/", "/postgres/patches/",
    "/startups/", "/startups/current/", "/startups/past/", "/startups/ideas/",
    "/call/", "/call/consulting/", "/call/postgres/", "/awesome/"],
  "/#ws=3": ["/blog/", "/blog/motd/", "/blog/page/2/",
    ...["postgres", "omnigres", "d3x", "tips", "types", "rust", "docker", "containers", "contest", "performance",
      "c", "git", "c4", "practices", "teamwork"].map((c) => `/blog/category/${c}/`)],
};

const t0 = performance.now();
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const write = (rel, body) => { const f = join(DIST, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); };
const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);

// ── frontmatter (a small YAML subset: scalars, quoted strings, "- item" lists) ─
function parseFrontmatter(src, file) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const data = {};
  let key = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    let mm;
    if ((mm = raw.match(/^\s+-\s+(.*)$/)) && key) { (data[key] ||= []).push(scalar(mm[1])); continue; }
    if ((mm = raw.match(/^([\w-]+):\s*(.*)$/))) { key = mm[1]; data[key] = mm[2] === "" ? [] : scalar(mm[2]); continue; }
    throw new Error(`${file}: cannot parse frontmatter line: ${raw}`);
  }
  return { data, body: src.slice(m[0].length) };
  function scalar(v) {
    v = v.trim();
    if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
    if (v === "true") return true;
    if (v === "false") return false;
    if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(",").map((x) => scalar(x)).filter((x) => x !== "");
    return v;
  }
}

// ── markdown ─────────────────────────────────────────────────────────────────
// Slugs follow Python-Markdown's toc slugify, so old #anchors keep working.
const slugify = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[-\s]+/g, "-");

const ADMONITIONS = {
  note: "i", info: "i", abstract: "≡", tip: "+", hint: "+", success: "✓", question: "?", help: "?",
  warning: "!", caution: "!", danger: "!", failure: "×", bug: "×", example: "#", quote: "“",
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const highlights = new Map(); // fence token → highlighted html (filled before render)
const md = new MarkdownIt({ html: true, linkify: false, typographer: false })
  .use(footnote)
  .use(mark)
  .use(attrs)
  .use(anchor, {
    level: [2, 3, 4],
    slugify,
    permalink: anchor.permalink.linkInsideHeader({
      symbol: "#", class: "anchor", placement: "after", space: false,
      renderAttrs: () => ({ "aria-label": "Link to this section" }),
    }),
  });

// ::: <type> [Title]            admonition
// ::: details <type> [Title]    collapsible admonition (<details>)
// :::: tabs / ::: tab Title     tabs (stacked sections without JS)
// ::: figure Caption            figure with caption
md.use(container, "adm", {
  marker: ":",
  validate: (p) => new RegExp(`^(details\\s+)?(${Object.keys(ADMONITIONS).join("|")})(\\s|$)`).test(p.trim()),
  render(tokens, i) {
    const tok = tokens[i];
    if (tok.nesting === -1) return tok.info.trim().startsWith("details") || tokens[tok.__open].__details ? "</div></details>\n" : "</div></div>\n";
    const m = tok.info.trim().match(/^(details\s+)?(\w+)\s*(.*)$/);
    const [, details, type, title] = m;
    const ttl = md.renderInline(title || cap(type));
    const head = `<span class="ic" aria-hidden="true">${ADMONITIONS[type]}</span><span class="t">${ttl}</span>`;
    // remember for the closer
    for (let j = i + 1; j < tokens.length; j++) if (tokens[j].type === "container_adm_close" && tokens[j].level === tok.level) { tokens[j].__open = i; break; }
    tok.__details = !!details;
    return details
      ? `<details class="adm ${type}"><summary>${head}</summary><div class="b">\n`
      : `<div class="adm ${type}" role="note"><span class="ic" aria-hidden="true">${ADMONITIONS[type]}</span><span class="t">${ttl}</span><div class="b">\n`;
  },
});
md.use(container, "tabs", { marker: ":", render: (t, i) => (t[i].nesting === 1 ? '<div class="tabs">\n' : "</div>\n") });
md.use(container, "tab", {
  marker: ":",
  render: (t, i) => (t[i].nesting === 1 ? `<section class="tab"><h4 class="tab-t">${md.renderInline(t[i].info.trim().slice(3).trim())}</h4>\n` : "</section>\n"),
});
md.use(container, "figure", {
  marker: ":",
  render: (t, i) => (t[i].nesting === 1 ? '<figure class="fig">\n' : `<figcaption>${md.renderInline(t[i].__cap)}</figcaption></figure>\n`),
});
// the figure closer needs the opener's caption
md.core.ruler.push("figure_caption", (state) => {
  const stack = [];
  for (const tok of state.tokens) {
    if (tok.type === "container_figure_open") stack.push(tok);
    if (tok.type === "container_figure_close") tok.__cap = stack.pop().info.trim().replace(/^figure\s*/, "");
  }
});

// footnotes in the reader's markup
const fnId = (tokens, idx, opts, env) => Number(tokens[idx].meta.id) + 1;
const fnRefId = (tokens, idx) => `fnref${Number(tokens[idx].meta.id) + 1}${tokens[idx].meta.subId > 0 ? ":" + tokens[idx].meta.subId : ""}`;
md.renderer.rules.footnote_ref = (tokens, idx) => { const n = fnId(tokens, idx); return `<sup class="fn" id="${fnRefId(tokens, idx)}"><a href="#fn${n}" aria-label="Footnote ${n}">${n}</a></sup>`; };
md.renderer.rules.footnote_block_open = () => '<section class="footnotes" aria-label="Footnotes"><h2>footnotes</h2><ol>\n';
md.renderer.rules.footnote_block_close = () => "</ol></section>\n";
md.renderer.rules.footnote_open = (tokens, idx) => `<li id="fn${fnId(tokens, idx)}">`;
md.renderer.rules.footnote_close = () => "</li>\n";
md.renderer.rules.footnote_anchor = (tokens, idx) => { const n = fnId(tokens, idx); return ` <a class="back" href="#${fnRefId(tokens, idx)}" aria-label="Back to reference ${n}">↩</a>`; };

// code blocks: <figure class="code"> with a header (lang · title · copy) and shiki output
md.renderer.rules.fence = (tokens, idx) => {
  const tok = tokens[idx];
  const { lang, title } = fenceInfo(tok.info);
  const body = highlights.get(tok) ?? `<pre class="shiki"><code>${esc(tok.content)}</code></pre>`;
  return `<figure class="code"><figcaption class="ch"><span class="lang">${esc(lang)}</span>${title ? `<span class="nm">${esc(title)}</span>` : ""}<button type="button" data-copy>copy</button></figcaption>\n${body}</figure>\n`;
};
// "lang {4-8,11} title="…""
function fenceInfo(info) {
  const [lang0, ...rest] = info.trim().split(/\s+/);
  const lang = lang0 || "text", meta = rest.join(" ");
  const hl = new Set();
  for (const [, a, b] of (meta.match(/\{([^}]*)\}/)?.[1] ?? "").matchAll(/(\d+)(?:-(\d+))?/g)) for (let n = +a; n <= +(b ?? a); n++) hl.add(n);
  return { lang: lang.toLowerCase(), hl, title: meta.match(/title="([^"]*)"/)?.[1] };
}

// shiki: a CSS-variables theme; the reader defines --shiki-* from its own palette
const LANG_ALIAS = { postgresql: "sql", psql: "sql", pgsql: "sql", shell: "shellscript", sh: "shellscript", bash: "shellscript", zsh: "shellscript", console: "shellscript", js: "javascript", ts: "typescript", yml: "yaml", md: "markdown", txt: "text", text: "text", plain: "text" };
const highlighter = await createHighlighter({ themes: [createCssVariablesTheme({ name: "css-variables", variablePrefix: "--shiki-", fontStyle: true })], langs: [] });
async function highlightFences(tokens) {
  for (const tok of tokens) {
    if (tok.type !== "fence") continue;
    const { lang: raw, hl } = fenceInfo(tok.info);
    let lang = LANG_ALIAS[raw] ?? raw;
    if (lang !== "text") {
      if (!(lang in bundledLanguages)) { console.warn(`  ? unknown language "${raw}", rendering as text`); lang = "text"; }
      else if (!highlighter.getLoadedLanguages().includes(lang)) await highlighter.loadLanguage(lang);
    }
    const code = tok.content.replace(/\n$/, "");
    const html = highlighter.codeToHtml(code, {
      lang, theme: "css-variables",
      transformers: [{
        pre(node) { delete node.properties.style; node.properties.tabindex = undefined; },
        line(node, line) {
          if (hl.has(line)) node.properties.class = (node.properties.class || "") + " hl";
          node.children.unshift({ type: "element", tagName: "span", properties: { class: "ln", "aria-hidden": "true" }, children: [{ type: "text", value: String(line) }] });
        },
      }],
    });
    highlights.set(tok, html);
  }
}

// ── content ──────────────────────────────────────────────────────────────────
const atlas = readJson(join(DATA_DIR, "atlas.json")) ?? { sectors: [], bodies: [] };
const bodyByUrl = new Map(atlas.bodies.filter((b) => b.url).map((b) => [b.url, b]));
const bodyById = new Map(atlas.bodies.map((b) => [b.id, b]));
const sectorIndex = new Map(atlas.sectors.map((s, i) => [s.id, i]));
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

const listFiles = (dir, exts) => (existsSync(dir) ? readdirSync(dir).filter((f) => exts.includes(extname(f)) && !f.startsWith(".")).sort().map((f) => join(dir, f)) : []);
const stripTags = (h) => h.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
const longDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const yearFraction = (d) => { const [y, m, day] = d.split("-").map(Number); return y + (Date.UTC(y, m - 1, day) - Date.UTC(y, 0, 1)) / (365 * 864e5); };

async function loadPost(file) {
  const src = readFileSync(file, "utf8");
  const { data, body: rawBody } = parseFrontmatter(src, file);
  for (const k of ["title", "date", "permalink"]) if (!data[k]) throw new Error(`${file}: frontmatter needs ${k}`);
  if (!/^\/.*\/$/.test(data.permalink)) throw new Error(`${file}: permalink must start and end with "/"`);
  const isHtml = extname(file) === ".html";
  let body = rawBody;
  let excerpt = data.excerpt;
  const more = body.indexOf("<!-- more -->");
  if (!excerpt) { // derive from the lead
    const lead = (more >= 0 ? body.slice(0, more) : body).split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(#|>|\[\^|:::|!\[|<)/.test(p)) ?? "";
    excerpt = isHtml ? stripTags(lead) : stripTags(md.renderInline(lead.replace(/\s*\n\s*/g, " "))).replace(/\[\^[^\]]+\]/g, "");
  }
  if (more >= 0) body = body.replace("<!-- more -->", "");
  let html, headings;
  if (isHtml) {
    html = body;
    headings = [...body.matchAll(/<h([23])[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({ level: +m[1], id: m[2], text: stripTags(m[3]).replace(/#$/, "").trim() }));
  } else {
    const env = {};
    const tokens = md.parse(body, env);
    await highlightFences(tokens);
    html = md.renderer.render(tokens, md.options, env);
    headings = [];
    tokens.forEach((t, i) => { if (t.type === "heading_open" && /^h[23]$/.test(t.tag)) headings.push({ level: +t.tag[1], id: t.attrGet("id"), text: stripTags(md.renderInline(tokens[i + 1].content)) }); });
  }
  // A standfirst is shown only when it says something the opening paragraph does not.
  const norm = (t) => stripTags(t).replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
  const opening = norm(stripTags(html).slice(0, 2000));
  const standfirst = data.standfirst ? String(data.standfirst) : opening.includes(norm(excerpt).slice(0, 80)) ? "" : excerpt;
  const words = (stripTags(html).match(/\S+/g) || []).length;
  const tags = (data.tags ?? []).map(String);
  const atlasBody = bodyByUrl.get(data.permalink) ?? null;
  return {
    file, title: String(data.title), date: String(data.date), updated: data.updated ? String(data.updated) : null,
    permalink: data.permalink, tags, excerpt, standfirst, listed: data.listed !== false, html, headings, words,
    minutes: Math.max(1, Math.round(words / 220)), atlas: atlasBody, series: data.series ?? null,
    original: data.original ? { url: String(data.original), venue: String(data.originalVenue ?? new URL(String(data.original)).hostname) } : null,
  };
}

async function loadNote(file) {
  const { data, body } = parseFrontmatter(readFileSync(file, "utf8"), file);
  const tokens = md.parse(body, {});
  await highlightFences(tokens);
  const html = md.renderer.render(tokens, md.options, {});
  return { title: String(data.title ?? basename(file, ".md")), date: String(data.date ?? ""), tags: (data.tags ?? []).map(String), html, text: stripTags(html), slug: basename(file, extname(file)) };
}

// ── templates ────────────────────────────────────────────────────────────────
// {{key}} is HTML-escaped, {{{key}}} is raw. Missing keys render empty.
const tpl = (name) => readFileSync(join(TEMPLATES, name), "utf8");
const render = (template, vars) => template.replace(/\{\{\{(\w+)\}\}\}|\{\{(\w+)\}\}/g, (_, raw, escd) => (raw ? vars[raw] ?? "" : esc(vars[escd] ?? "")));

// Locator: the Atlas' geometry (rings are years, recent years wider: t^0.6; rim = birth year),
// 200×200, with the post and the body it orbits. Pure function of the data, so builds are stable.
function locator(post) {
  const NOW = yearFraction(new Date().toISOString().slice(0, 10));
  const BIRTH = atlas.person?.born ?? 1981, POW = 0.6, R0 = 16, SPAN = 72;
  const KR = SPAN / Math.pow(NOW - BIRTH, POW), rOf = (y) => R0 + KR * Math.pow(Math.max(0, NOW - y), POW);
  const cx = 100, cy = 100, D2R = Math.PI / 180, n = Math.max(1, atlas.sectors.length), W = 360 / n;
  const pol = (r, a) => [cx + r * Math.cos(a * D2R), cy + r * Math.sin(a * D2R)];
  const ang = (sector, f) => -90 + W * (sectorIndex.get(sector) ?? 0) + W * f;
  const fx = (v) => v.toFixed(1);
  const b = post.atlas;
  const sector = b?.sector ?? "writing";
  const f = b?.f ?? (0.15 + (hash(post.permalink) % 700) / 1000);
  const y = b?.year ?? yearFraction(post.date);
  const rel = b?.related?.map((id) => bodyById.get(id)).find(Boolean) ?? null;
  let h = "";
  for (let yr = Math.floor(NOW); yr > BIRTH; yr--) { const r = rOf(yr), dec = yr % 10 === 0, gap = rOf(yr - 1) - rOf(yr); if (!dec && gap < 2.5) continue; h += `<circle cx="${cx}" cy="${cy}" r="${fx(r)}" fill="none" stroke="currentColor" stroke-opacity="${dec ? 0.35 : 0.12}" stroke-width="${dec ? 1 : 0.6}"/>`; }
  h += `<circle cx="${cx}" cy="${cy}" r="${fx(rOf(BIRTH))}" fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="1"/>`;
  for (let i = 0; i < n; i++) { const a0 = -90 + W * i; const [x1, y1] = pol(R0 + 2, a0), [x2, y2] = pol(rOf(BIRTH), a0); h += `<line x1="${fx(x1)}" y1="${fx(y1)}" x2="${fx(x2)}" y2="${fx(y2)}" stroke="currentColor" stroke-opacity=".18" stroke-dasharray="2 3"/>`; }
  h += `<circle cx="${cx}" cy="${cy}" r="${R0}" fill="none" stroke="var(--signal)" stroke-opacity=".6"/><circle cx="${cx}" cy="${cy}" r="2.2" fill="var(--signal)"/>`;
  const [px, py] = pol(rOf(y), ang(sector, f));
  if (rel) {
    const ra = ang(rel.sector, rel.f ?? 0.5);
    const ry = rel.year ?? (rel.start != null ? (rel.start + (rel.end ?? rel.start)) / 2 : y); // as the shell's locator does
    const [ox, oy] = pol(rOf(ry), ra);
    if (rel.start != null) { // its span, as the Atlas draws it: start → end (or now)
      const [sx, sy] = pol(rOf(rel.start), ra), [ex, ey] = rel.end == null ? pol(R0, ra) : pol(rOf(rel.end), ra);
      h += `<line x1="${fx(sx)}" y1="${fx(sy)}" x2="${fx(ex)}" y2="${fx(ey)}" stroke="${rel.end == null ? "var(--signal)" : "currentColor"}" stroke-opacity=".35" stroke-dasharray="2 4"/>`;
    }
    h += `<circle cx="${fx(ox)}" cy="${fx(oy)}" r="3.2" fill="currentColor"/><text x="${fx(ox + 6)}" y="${fx(oy + 4)}" font-family="var(--serif)" font-style="italic" font-size="11" fill="currentColor" fill-opacity=".85">${esc(rel.name)}</text>`;
    h += `<line x1="${fx(px)}" y1="${fx(py)}" x2="${fx(ox)}" y2="${fx(oy)}" stroke="currentColor" stroke-opacity=".3"/>`;
  }
  h += `<circle class="pulse" cx="${fx(px)}" cy="${fx(py)}" r="4" fill="none" stroke="var(--signal)"/><circle cx="${fx(px)}" cy="${fx(py)}" r="2.6" fill="none" stroke="var(--signal)" stroke-width="1.2"/>`;
  const label = (yr, text, dy) => `<text x="${cx + 4}" y="${fx(cy - rOf(yr) + dy)}" font-family="var(--mono)" font-size="7.5" fill="currentColor" fill-opacity=".55">${text}</text>`;
  h += label(BIRTH, BIRTH, 9) + label(2020, "2020", -3) + label(2010, "2010", -3);
  h += `<text x="${fx(px - 4)}" y="${fx(py + 16)}" text-anchor="end" font-family="var(--mono)" font-size="8" fill="var(--signal)">this essay</text>`;
  const sec = atlas.sectors[sectorIndex.get(sector) ?? 0];
  const secLabel = sec ? `S ${ROMAN[sectorIndex.get(sector)]} ${sec.label.split(" &")[0]}` : "";
  return { svg: h, sectorLabel: secLabel, orbits: rel ? rel.name : "", focus: b?.id ?? "" };
}
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function renderPost(post, prev, next, template) {
  const loc = locator(post);
  const [y, m, d] = post.date.split("-");
  const series = post.series ?? loc.orbits ?? "";
  const eyebrowMid = (series || post.tags[0] || "").toLowerCase();
  const toc = post.headings.length
    ? `<ol class="toc" id="toc">${post.headings.map((h) => `<li${h.level === 3 ? ' class="sub"' : ""}><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join("")}</ol>`
    : '<p class="toc-none">no sections</p>';
  const navLink = (p, arrow) => (p ? `<a href="${p.permalink}"><span>${arrow}</span>${esc(p.title)}</a>` : "");
  const pagerLink = (p, cls, k, rel) => (p
    ? `<a class="${cls}" href="${p.permalink}" rel="${rel}"><span class="k">${k}</span><span class="t">${esc(p.title)}</span><span class="d">${p.date}</span></a>`
    : `<span class="${cls} none"><span class="k">${k}</span><span class="t">—</span></span>`);
  const atlasHref = loc.focus ? `/#focus=${loc.focus}` : "/#app=atlas";
  return render(template, {
    title: post.title, siteTitle: SITE_TITLE, description: post.excerpt, permalink: post.permalink, canonical: ORIGIN + post.permalink,
    homesJson: JSON.stringify(HOMES).replace(/</g, "\\u003c"), homesNames: HOMES.map((h) => h.n).join(" · "), here: atlas.person?.here ?? "",
    standfirst: post.standfirst ? `<p class="standfirst">${esc(post.standfirst)}</p>` : "",
    date: post.date, dateLong: longDate(post.date), dateSlash: `${y} / ${m} / ${d}`, dateDots: `${y} · ${m} · ${d}`,
    updatedRow: post.updated ? `<dt>updated</dt><dd><time datetime="${post.updated}">${post.updated}</time></dd>` : "",
    seriesRow: series ? `<dt>series</dt><dd>${esc(series)}</dd>` : "",
    originalMeta: post.original ? `<span class="orig">first published on <a href="${esc(post.original.url)}" rel="noopener">${esc(post.original.venue)}</a></span>` : "",
    eyebrowMid, minutes: post.minutes, words: post.words.toLocaleString("en-US"),
    tagsRail: post.tags.map((t) => `<a href="/#k=${encodeURIComponent(t.toLowerCase())}">${esc(t.toLowerCase())}</a>`).join(""),
    tagsInline: post.tags.map((t) => `#${esc(t.toLowerCase())}`).join(" · "),
    atlasHref, locatorSvg: loc.svg,
    locatorCaption: `<b>${y} · ${m} · ${d}</b>${loc.sectorLabel ? ` · ${esc(loc.sectorLabel)}` : ""}${loc.orbits ? ` · orbits ${esc(loc.orbits)}` : ""}`,
    locatorAria: `This essay's position on the Atlas: ${y}${loc.sectorLabel ? `, sector ${loc.sectorLabel}` : ""}${loc.orbits ? `, orbiting ${loc.orbits}` : ""}`,
    toc, navPrev: navLink(prev, "←"), navNext: navLink(next, "→"),
    pagerPrev: pagerLink(prev, "prev", "← previous", "prev"), pagerNext: pagerLink(next, "next", "next →", "next"),
    prevHrefJson: JSON.stringify(prev?.permalink ?? null), nextHrefJson: JSON.stringify(next?.permalink ?? null),
    content: post.html, author: AUTHOR,
  });
}

// ── feeds, sitemap ───────────────────────────────────────────────────────────
const absolutize = (html) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${ORIGIN}/`);
const rfc822 = (d) => new Date(d + "T00:00:00Z").toUTCString();
function rss(posts, path, title, dateOf) {
  const items = posts.map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${ORIGIN}${p.permalink}</link>
      <guid isPermaLink="true">${ORIGIN}${p.permalink}</guid>
      <pubDate>${rfc822(dateOf(p))}</pubDate>
      <dc:creator>${esc(AUTHOR)}</dc:creator>
${p.tags.map((t) => `      <category>${esc(t)}</category>`).join("\n")}
      <description>${esc(p.excerpt)}</description>
      <content:encoded><![CDATA[${absolutize(p.html).replace(/]]>/g, "]]]]><![CDATA[>")}]]></content:encoded>
    </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${esc(title)}</title>
    <link>${ORIGIN}/</link>
    <description>${esc(SITE_DESC)}</description>
    <language>en</language>
    <atom:link href="${ORIGIN}${path}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${posts.length ? rfc822(dateOf(posts[0])) : rfc822("1981-01-01")}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

// ── build ────────────────────────────────────────────────────────────────────
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 1. posts
const posts = [];
for (const f of listFiles(POSTS_DIR, [".md", ".html"])) posts.push(await loadPost(f));
posts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.permalink.localeCompare(b.permalink)));
const seen = new Set();
for (const p of posts) { if (seen.has(p.permalink)) throw new Error(`duplicate permalink ${p.permalink}`); seen.add(p.permalink); }
// The reader's top-bar clock: his homes (person.homes) with their time zones; person.here is underlined.
const HOMES = (atlas.person?.homes ?? []).map((id) => atlas.places?.find((p) => p.id === id)).filter((p) => p?.tz).map((p) => ({ id: p.id, n: p.name.split(",")[0], tz: p.tz }));
const article = tpl("article.html");
posts.forEach((p, i) => write(join(p.permalink, "index.html"), renderPost(p, posts[i - 1], posts[i + 1], article)));
const listed = posts.filter((p) => p.listed).slice().reverse(); // newest first

// 2. notes
const notes = [];
for (const f of listFiles(NOTES_DIR, [".md"]).filter((f) => /^\d{4}-\d{2}-\d{2}-/.test(basename(f)))) notes.push(await loadNote(f));
notes.sort((a, b) => (a.date < b.date ? 1 : -1));

// 2b. shelf: ideas not built yet. Any .md with frontmatter (README.md excluded); ordered by `order`, then title.
const shelf = [];
for (const f of listFiles(SHELF_DIR, [".md"]).filter((f) => basename(f) !== "README.md")) {
  const { data } = parseFrontmatter(readFileSync(f, "utf8"), f);
  const item = await loadNote(f);
  shelf.push({ ...item, order: Number(data.order ?? 0), since: data.since != null ? String(data.since) : undefined, atlas: data.atlas !== false });
}
shelf.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

// 3. data: copy, then the generated lists
cpSync(DATA_DIR, join(DIST, "data"), { recursive: true, filter: (src) => !DEV_ONLY.has(basename(src)) });
const postsJs = posts.slice().reverse().map((p) => ({
  id: p.atlas?.id ?? null, title: p.title, date: p.date, updated: p.updated ?? undefined, url: p.permalink, tags: p.tags,
  excerpt: p.excerpt, listed: p.listed, featured: p.atlas?.featured ?? undefined, related: p.atlas?.related ?? undefined, minutes: p.minutes,
}));
write("data/posts.js", `// Generated by scripts/build.mjs from site/content/posts. Do not edit.\nwindow.POSTS = ${JSON.stringify(postsJs)};\n`);
write("data/posts.json", JSON.stringify(postsJs, null, 1) + "\n");
write("data/shelf.js", `// Generated by scripts/build.mjs from site/content/shelf. Do not edit.\nwindow.SHELF = ${JSON.stringify(shelf.map((n) => ({ id: n.slug, title: n.title, since: n.since, tags: n.tags, body: n.text, atlas: n.atlas })))};\n`);
write("data/notes.js", `// Generated by scripts/build.mjs from site/content/notes. Do not edit.\nwindow.NOTES = ${JSON.stringify(notes.map((n) => ({ id: n.slug, title: n.title, date: n.date, tags: n.tags, tag: n.tags[0] ?? "", body: n.text })))};\n`);

// 4. app shell and its files
for (const f of readdirSync(APP_DIR)) {
  if (f === "index.html" || DEV_ONLY.has(f) || f.startsWith(".")) continue;
  cpSync(join(APP_DIR, f), join(DIST, f), { recursive: true, filter: (src) => !DEV_ONLY.has(basename(src)) });
}
let shell = readFileSync(join(APP_DIR, "index.html"), "utf8")
  .replaceAll("../data/", "/data/")
  .replace(/(["'(])index\.html(?=[#"')?])/g, "$1/")
  .replaceAll("article.html", SAMPLE_ARTICLE);
// the shell reads window.POSTS / window.NOTES / window.SHELF when present (atlas.json is its fallback)
const lists = '<script src="/data/posts.js"></script>\n<script src="/data/notes.js"></script>\n<script src="/data/shelf.js"></script>\n';
const lastData = shell.lastIndexOf('<script src="/data/');
const afterLast = lastData >= 0 ? shell.indexOf("</script>", lastData) + "</script>".length + 1 : shell.indexOf("<script>");
shell = shell.slice(0, afterLast) + lists + shell.slice(afterLast);
const feedLinks = `<link rel="alternate" type="application/rss+xml" title="${esc(SITE_TITLE)}" href="/feed.xml">\n<link rel="canonical" href="${ORIGIN}/">\n`;
shell = shell.includes("</head>") ? shell.replace("</head>", feedLinks + "</head>") : feedLinks + shell;
write("index.html", shell);

// 5. static files, 404, robots, CNAME
if (existsSync(STATIC)) cpSync(STATIC, DIST, { recursive: true });
write("404.html", render(tpl("404.html"), { siteTitle: SITE_TITLE }));
if (!existsSync(join(DIST, "robots.txt"))) write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
if (!existsSync(join(DIST, "CNAME"))) write("CNAME", "yrashk.com\n");

// 6. feeds and sitemap (listed posts only, full content)
const byCreated = listed;
const byUpdated = listed.slice().sort((a, b) => ((b.updated ?? b.date) < (a.updated ?? a.date) ? -1 : 1));
write("feed.xml", rss(byCreated, "/feed.xml", SITE_TITLE, (p) => p.date));
write("feed_rss_created.xml", rss(byCreated, "/feed_rss_created.xml", `${SITE_TITLE} — new posts`, (p) => p.date));
write("feed_rss_updated.xml", rss(byUpdated, "/feed_rss_updated.xml", `${SITE_TITLE} — updated posts`, (p) => p.updated ?? p.date));
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.w3.org/1999/sitemaps/0.9">\n  <url><loc>${ORIGIN}/</loc></url>\n${listed.map((p) => `  <url><loc>${ORIGIN}${p.permalink}</loc><lastmod>${p.updated ?? p.date}</lastmod></url>`).join("\n")}\n</urlset>\n`);

// 7. redirect stubs for retired pages (they honour the site theme too: site/DATA.md "Theme contract")
const PREPAINT = `<script>(function(){var t='dark';try{var q=new URLSearchParams(location.search).get('theme');if(q==='paper'||q==='dark'){localStorage.setItem('yr-theme',q);t=q;}else{t=localStorage.getItem('yr-theme')==='paper'?'paper':'dark';}}catch(e){}document.documentElement.setAttribute('data-theme',t);})()</script>`;
for (const [target, paths] of Object.entries(RETIRED)) {
  const canonical = ORIGIN + target.replace(/#.*$/, "");
  for (const p of paths) {
    write(join(p, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Moved — ${esc(SITE_TITLE)}</title>
<link rel="icon" href="/favicon-32x32.png" sizes="32x32" type="image/png">
<meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${target}"><link rel="canonical" href="${canonical}">
${PREPAINT}
<style>:root,:root[data-theme="dark"]{--desk:#0a0c0f;--bone:#e9e4d9;--signal:#ff6a3d}:root[data-theme="paper"]{--desk:#e4ded2;--bone:#17191c;--signal:#d9481f;color-scheme:light}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--desk);color:var(--bone);font:15px/1.6 ui-monospace,Menlo,monospace}a{color:var(--signal)}</style></head>
<body><p>This page moved to <a href="${target}">yrashk.com${target}</a>.</p></body></html>
`);
  }
}

// 8. cache-busting. GitHub Pages serves with a 10-minute cache, so after a deploy a browser could pair
// a new page with stale data. Every quoted reference to a data/vendor file (and to sparql.js, player.js, clock.js) gets
// ?v=<content hash>. Leaves first, then sparql.js (whose hash covers its rewritten references), then pages.
{
  const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])) : []);
  const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 10);
  const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // a quoted string that is the file's name, optionally preceded by a path: "contributions.ttl", '/data/atlas.ttl', "./sparql.js"
  const stamp = (text, versions) =>
    versions.reduce((t, [name, v]) => t.replace(new RegExp(`(["'\`])((?:\\.{0,2}/)?(?:[\\w.-]+/)*)${reEsc(name)}\\1`, "g"), (_, q, dir) => `${q}${dir}${name}?v=${v}${q}`), text);
  const icons = readdirSync(DIST).filter((f) => /^(favicon|apple-touch-icon)/.test(f)).map((f) => join(DIST, f));
  const leaves = [...walk(join(DIST, "data")), ...walk(join(DIST, "vendor")), ...icons].map((f) => [basename(f), hash(f)]);
  const sparql = join(DIST, "sparql.js");
  if (existsSync(sparql)) {
    writeFileSync(sparql, stamp(readFileSync(sparql, "utf8"), leaves));
    leaves.push(["sparql.js", hash(sparql)]);
  }
  const player = join(DIST, "player.js"); // the floating talk player, on the shell and every reader page
  if (existsSync(player)) leaves.push(["player.js", hash(player)]);
  const clock = join(DIST, "clock.js"); // the two-homes clock, also on the shell and every reader page
  if (existsSync(clock)) leaves.push(["clock.js", hash(clock)]);
  for (const page of walk(DIST).filter((f) => f.endsWith(".html"))) writeFileSync(page, stamp(readFileSync(page, "utf8"), leaves));
}

if (existsSync(join(DIST, "strata"))) throw new Error("dist/strata must not exist: /strata is served by another repository");

const ms = Math.round(performance.now() - t0);
console.log(`build: ${posts.length} posts (${listed.length} listed), ${notes.length} notes, ${shelf.length} on the shelf, ${Object.values(RETIRED).flat().length} redirect stubs → ${DIST}/ in ${ms} ms`);
for (const p of posts) console.log(`  ${p.listed ? "•" : "·"} ${p.date}  ${p.permalink}${p.atlas ? "" : "   (no atlas body)"}`);
