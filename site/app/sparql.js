// Lab query console: a SPARQL editor over the Atlas (atlas.ttl) on the Semblance WAT engine.
//
//   import { mountQueryConsole } from "./sparql.js";
//   const api = await mountQueryConsole(element, { turtleUrl, engineUrl, onLocate, onHighlight });
//   api.run("SELECT …") / api.run("companies");   api.dispose();
// Options: turtleUrl, engineUrl, contributionsUrl (default: contributions.ttl next to the Turtle; null
// skips it), stravaUrl (default: strava.ttl next to the Turtle; null skips it and hides the Strava
// presets), tracksUrl (default: strava-tracks.json beside it, for the Map view), tiles (map background;
// null for none), initial ({q, sparql, view}: what to show first) and onState (called with the same shape
// whenever the query or view changes, so a host can keep it in its URL), onLocate, onHighlight, hash (read/write #q=&view=&node=; harness only), codemirror
// (false forces the plain textarea editor). The editor is CodeMirror 6 from ./vendor/codemirror.js,
// lazily imported, with optional Vim keys; the textarea editor is the fallback when it cannot load.
//
// Everything lives inside `element` (class "qc"): a highlighted editor, presets, results as a
// sortable table, a force-directed graph, a bar chart, a map of routes and places, a resource inspector, a vocabulary view, CSV/Turtle
// export and a status line. Styles use the OS tokens (--bone, --signal, …) with fallbacks and follow
// the site theme contract (DATA.md): no hard-coded colours; the canvas re-reads its palette on `yr-theme`.
// No dependencies beyond ../data/rdf/engine.js. See DATA.md.

const BASE = "https://yrashk.com/atlas/";
const NS = "https://yrashk.com/ns#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD = "http://www.w3.org/2001/XMLSchema#";

// Prefixes pre-declared for every query (shown collapsed above the editor).
const PREFIXES = [
  ["", BASE],
  ["yr", NS],
  ["schema", "https://schema.org/"],
  ["xsd", XSD],
  ["rdfs", "http://www.w3.org/2000/01/rdf-schema#"],
  ["rdf", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
];
const PREFIX_BLOCK = PREFIXES.map(([p, ns]) => `PREFIX ${p}: <${ns}>`).join("\n");
// Prefixes the editor can complete and declare on demand (added to the PREFIX block when used).
const COMMON_PREFIXES = [
  ["owl", "http://www.w3.org/2002/07/owl#"],
  ["foaf", "http://xmlns.com/foaf/0.1/"],
  ["dcterms", "http://purl.org/dc/terms/"],
  ["dc", "http://purl.org/dc/elements/1.1/"],
  ["skos", "http://www.w3.org/2004/02/skos/core#"],
  ["geo", "http://www.w3.org/2003/01/geo/wgs84_pos#"],
  ["prov", "http://www.w3.org/ns/prov#"],
  ["sh", "http://www.w3.org/ns/shacl#"],
];
const KNOWN_NS = new Map([...PREFIXES, ...COMMON_PREFIXES]);
// Keywords and built-ins for completion: label → one-line detail (signature).
const SPARQL_KEYWORDS = {
  SELECT: "query form", DISTINCT: "", REDUCED: "", WHERE: "", FROM: "", NAMED: "", PREFIX: "PREFIX p: <iri>", BASE: "", ORDER: "ORDER BY …", BY: "", ASC: "ASC(expr)", DESC: "DESC(expr)",
  LIMIT: "LIMIT n", OFFSET: "OFFSET n", OPTIONAL: "OPTIONAL { … }", UNION: "{ … } UNION { … }", FILTER: "FILTER(expr)", GRAPH: "GRAPH ?g { … }", BIND: "BIND(expr AS ?v)", AS: "",
  VALUES: "VALUES ?v { … }", UNDEF: "", MINUS: "MINUS { … }", SERVICE: "SERVICE <iri> { … }", SILENT: "", GROUP: "GROUP BY …", HAVING: "HAVING(expr)", CONSTRUCT: "CONSTRUCT { … } WHERE { … }",
  ASK: "ASK { … }", DESCRIBE: "DESCRIBE <iri>", EXISTS: "EXISTS { … }", NOT: "NOT EXISTS / NOT IN", IN: "expr IN (…)", LATERAL: "LATERAL { … }", a: "rdf:type", true: "", false: "",
};
const SPARQL_FUNCTIONS = {
  STR: "(term) → string", LANG: "(literal) → lang", LANGMATCHES: "(lang, range) → bool", DATATYPE: "(literal) → iri", BOUND: "(?v) → bool", IRI: "(string) → iri", URI: "(string) → iri",
  BNODE: "() → bnode", RAND: "() → double", ABS: "(n) → n", CEIL: "(n) → n", FLOOR: "(n) → n", ROUND: "(n) → n", CONCAT: "(s, …) → string", STRLEN: "(s) → int", UCASE: "(s) → string",
  LCASE: "(s) → string", ENCODE_FOR_URI: "(s) → string", CONTAINS: "(s, sub) → bool", STRSTARTS: "(s, prefix) → bool", STRENDS: "(s, suffix) → bool", STRBEFORE: "(s, sep) → string",
  STRAFTER: "(s, sep) → string", YEAR: "(date) → int", MONTH: "(date) → int", DAY: "(date) → int", HOURS: "(dateTime) → int", MINUTES: "(dateTime) → int", SECONDS: "(dateTime) → decimal",
  TIMEZONE: "(dateTime) → duration", TZ: "(dateTime) → string", NOW: "() → dateTime", UUID: "() → iri", STRUUID: "() → string", MD5: "(s) → hex", SHA1: "(s) → hex", SHA256: "(s) → hex",
  COALESCE: "(expr, …) → first bound", IF: "(cond, then, else)", STRLANG: "(s, lang) → literal", STRDT: "(s, datatype) → literal", SAMETERM: "(a, b) → bool", ISIRI: "(term) → bool",
  ISBLANK: "(term) → bool", ISLITERAL: "(term) → bool", ISNUMERIC: "(term) → bool", REGEX: "(s, pattern[, flags]) → bool", SUBSTR: "(s, start[, len]) → string", REPLACE: "(s, pattern, repl) → string",
  COUNT: "(?v | *) → int · aggregate", SUM: "(expr) · aggregate", MIN: "(expr) · aggregate", MAX: "(expr) · aggregate", AVG: "(expr) · aggregate", SAMPLE: "(expr) · aggregate",
  GROUP_CONCAT: "(expr; SEPARATOR=\",\") · aggregate",
};

// ── presets: the story, as queries ─────────────────────────────────────────────
export const PRESETS = [
  {
    id: "companies",
    label: "Companies founded",
    blurb: "Every company, in order, and what it continued as.",
    query: `# Every company he founded, oldest first.
SELECT ?company ?name ?from ?to ?continuedAs WHERE {
  :yrashk yr:founded ?company .
  ?company schema:name ?name ; yr:start ?from .
  OPTIONAL { ?company yr:end ?to }
  OPTIONAL { ?company yr:continuedAs ?continuedAs }
}
ORDER BY ?from`,
  },
  {
    id: "lineage",
    label: "Lineage",
    blurb: "What became what: the continuedAs chain, oldest first.",
    view: "graph",
    query: `# Lineage: one thing continued as the next (yr:continuedAs+).
# Switch to the graph view: continuedAs is drawn as an arrow.
SELECT ?from ?fromName ?began ?ended ?to ?toName ?toBegan WHERE {
  ?from yr:continuedAs+ ?to .
  ?from schema:name ?fromName ; yr:start ?began .
  ?to   schema:name ?toName   ; yr:start ?toBegan .
  OPTIONAL { ?from yr:end ?ended }
}
ORDER BY ?began ?toBegan`,
  },
  {
    id: "year",
    label: "The year 2012",
    blurb: "Companies, projects and repositories alive in one year. Change the year.",
    query: `# What was he doing in 2012? Bodies whose span covers it,
# and repositories with commits that year. Edit the year and re-run.
SELECT ?what ?name ?kind ?commits WHERE {
  BIND(2012 AS ?year)
  {
    ?what yr:sector ?sector ; schema:name ?name ; a ?kind ; yr:start ?from .
    OPTIONAL { ?what yr:end ?until }
    FILTER(STRSTARTS(STR(?kind), "${NS}"))
  } UNION {
    ?what yr:activity [ yr:year ?y ; yr:contributions ?commits ] ; schema:name ?name .
    BIND(yr:Repository AS ?kind)
  }
  # gYear has no order in SPARQL, so compare the digits.
  FILTER(
    (BOUND(?from) && xsd:integer(STR(?from)) <= ?year && (!BOUND(?until) || xsd:integer(STR(?until)) >= ?year))
    || (BOUND(?y) && xsd:integer(STR(?y)) = ?year)
  )
}
ORDER BY ?kind DESC(?commits) ?name`,
  },
  {
    id: "languages",
    label: "Languages by decade",
    blurb: "Commits per language, per decade, from the repository activity.",
    query: `# Languages by decade: commits summed over repository activity.
SELECT ?decade ?language (SUM(?n) AS ?commits) (COUNT(DISTINCT ?repo) AS ?repos) WHERE {
  ?repo schema:programmingLanguage ?language ;
        yr:activity [ yr:year ?year ; yr:contributions ?n ] .
  BIND(CONCAT(SUBSTR(STR(?year), 1, 3), "0s") AS ?decade)
}
GROUP BY ?decade ?language
HAVING (SUM(?n) >= 20)
ORDER BY ?decade DESC(?commits)`,
  },
  {
    id: "repos",
    label: "Contributions",
    blurb: "Other people's repositories he contributed to most, by activity.",
    query: `# Repositories he does not own, by total activity, with their span.
SELECT ?repo ?language (SUM(?n) AS ?commits) (MIN(?year) AS ?from) (MAX(?year) AS ?to) WHERE {
  :yrashk yr:contributedTo ?repo .
  ?repo yr:activity [ yr:year ?year ; yr:contributions ?n ] .
  OPTIONAL { ?repo schema:programmingLanguage ?language }
}
GROUP BY ?repo ?language
ORDER BY DESC(?commits)
LIMIT 25`,
  },
  {
    id: "essays",
    label: "Essays and orbits",
    blurb: "Everything written, when, and what it orbits.",
    query: `# Essays, dated, and the body each one orbits (yr:related).
SELECT ?essay ?title ?published ?orbits ?keywords WHERE {
  :yrashk yr:wrote ?essay .
  ?essay schema:name ?title ; schema:datePublished ?published .
  OPTIONAL { ?essay yr:related ?about . ?about schema:name ?orbits }
  OPTIONAL {
    SELECT ?essay (GROUP_CONCAT(?k; SEPARATOR=", ") AS ?keywords) WHERE { ?essay schema:keywords ?k } GROUP BY ?essay
  }
}
ORDER BY ?published`,
  },
  {
    id: "life",
    label: "Life and places",
    blurb: "Life events with where they happened, and coordinates.",
    query: `# Life events, their year and place; places with coordinates.
SELECT ?event ?name ?year ?place ?lat ?lon WHERE {
  :yrashk yr:lived ?event .
  ?event schema:name ?name ; yr:start ?year .
  OPTIONAL {
    ?event schema:location ?where .
    ?where schema:name ?place ; schema:geo [ schema:latitude ?lat ; schema:longitude ?lon ]
  }
}
ORDER BY ?year`,
  },
  {
    id: "constellation",
    label: "Constellation",
    blurb: "A graph: the person, every curated body, and the links between them.",
    view: "graph",
    query: `# The curated Atlas as a graph: roles from the person, relations between bodies.
# Best seen in the graph view; click a body to pull in its repositories.
CONSTRUCT {
  :yrashk ?role ?body .
  ?body ?rel ?other ; yr:sector ?sector .
} WHERE {
  :yrashk ?role ?body .
  ?body yr:sector ?sector .
  OPTIONAL { ?body ?rel ?other . ?other yr:sector ?s2 . FILTER(?rel IN (yr:related, yr:continuedAs)) }
}`,
  },
  // ── contributions (loaded second, from contributions.ttl) ──
  {
    id: "prs",
    group: "contributions",
    needs: "contributions",
    label: "PRs per year",
    blurb: "Pull requests opened per year: merged against the rest.",
    query: `# Pull requests per year: merged, and the rest (open or closed).
SELECT ?year (SUM(IF(?state = "merged", 1, 0)) AS ?merged) (SUM(IF(?state != "merged", 1, 0)) AS ?notMerged) (COUNT(?pr) AS ?total) WHERE {
  :yrashk yr:opened ?pr .
  ?pr a yr:PullRequest ; yr:state ?state ; schema:dateCreated ?opened .
  BIND(YEAR(?opened) AS ?year)
}
GROUP BY ?year
ORDER BY ?year`,
  },
  {
    id: "first-pr",
    group: "contributions",
    needs: "contributions",
    label: "First PR to each project",
    blurb: "The first pull request to every repository, oldest first.",
    query: `# The first pull request to each project, and how many followed.
SELECT ?repo ?first (SAMPLE(?title) AS ?opened) (COUNT(DISTINCT ?pr) AS ?prs) WHERE {
  { SELECT ?repo (MIN(?d) AS ?first) WHERE { ?p a yr:PullRequest ; yr:repository ?repo ; schema:dateCreated ?d } GROUP BY ?repo }
  ?pr yr:repository ?repo ; schema:dateCreated ?first ; schema:name ?title .
  ?any yr:repository ?repo ; a yr:PullRequest .
}
GROUP BY ?repo ?first
ORDER BY ?first`,
  },
  {
    id: "longest",
    group: "contributions",
    needs: "contributions",
    label: "Longest-running",
    blurb: "Repositories he kept sending pull requests to, by span.",
    query: `# The longest-running contributions: first and last pull request, and the span between them.
SELECT ?repo (MIN(?d) AS ?first) (MAX(?d) AS ?last)
       ((xsd:dateTime(CONCAT(STR(MAX(?d)), "T00:00:00Z")) - xsd:dateTime(CONCAT(STR(MIN(?d)), "T00:00:00Z"))) AS ?span)
       (COUNT(?pr) AS ?prs) WHERE {
  ?pr a yr:PullRequest ; yr:repository ?repo ; schema:dateCreated ?d .
}
GROUP BY ?repo
HAVING (COUNT(?pr) >= 3)
ORDER BY DESC(?span)
LIMIT 25`,
  },
  {
    id: "elixir",
    group: "contributions",
    needs: "contributions",
    label: "Merged into Elixir",
    blurb: "Every pull request of his merged into the Elixir language.",
    query: `# Pull requests merged into elixir-lang/elixir, in order.
SELECT ?pr ?title ?merged WHERE {
  ?pr yr:repository <https://yrashk.com/atlas/repo/elixir-lang/elixir> ;
      yr:state "merged" ; schema:name ?title ; schema:dateCreated ?merged .
}
ORDER BY ?merged`,
  },
  {
    id: "problem",
    group: "contributions",
    needs: "contributions",
    label: "Problem: …",
    blurb: "Pull requests whose title starts with “Problem:” — the C4 habit, in real titles.",
    query: `# "Problem:" is how the commits and pull requests start (see the essay on C4).
# Every pull request titled that way, newest first.
SELECT ?pr ?repo ?title ?state ?date WHERE {
  :yrashk yr:opened ?pr .
  ?pr a yr:PullRequest ; schema:name ?title ; yr:repository ?repo ; yr:state ?state ; schema:dateCreated ?date .
  FILTER(STRSTARTS(?title, "Problem:"))
}
ORDER BY DESC(?date)`,
  },
  // ── activities (loaded third, from strava.ttl; hidden when there is none) ──
  {
    id: "km-per-year",
    group: "activities",
    view: "chart",
    needs: "strava",
    label: "Distance per year",
    blurb: "Kilometres per year and sport, from Strava.",
    query: `# Kilometres per year and sport (Strava), with the number of activities.
SELECT ?year ?sport (ROUND(SUM(?m) / 1000) AS ?km) (COUNT(?a) AS ?activities) WHERE {
  :yrashk yr:did ?a .
  ?a schema:exerciseType ?sport ; schema:startDate ?day ; yr:distance ?m .
  BIND(YEAR(?day) AS ?year)
}
GROUP BY ?year ?sport
ORDER BY DESC(?year) DESC(?km)`,
  },
  {
    id: "longest-rides",
    group: "activities",
    view: "map",
    needs: "strava",
    label: "Longest rides",
    blurb: "The twenty longest rides: distance, climbing and where.",
    query: `# The longest rides, with climbing and the nearest Atlas place.
SELECT ?ride ?day (ROUND(?m / 100) / 10 AS ?km) (?climb AS ?metresUp) ?place WHERE {
  ?ride schema:exerciseType "Ride" ; schema:startDate ?day ; yr:distance ?m ; yr:elevationGain ?climb .
  OPTIONAL { ?ride schema:location ?place }
}
ORDER BY DESC(?m)
LIMIT 20`,
  },
  {
    id: "climbs",
    group: "activities",
    view: "map",
    needs: "strava",
    label: "Biggest climbs",
    blurb: "The activities with the most metres climbed, of any sport.",
    query: `# The most climbing in one go, of any sport.
SELECT ?activity ?sport ?day ?metresUp (ROUND(?m / 1000) AS ?km) WHERE {
  ?activity schema:exerciseType ?sport ; schema:startDate ?day ; yr:elevationGain ?metresUp ; yr:distance ?m .
}
ORDER BY DESC(?metresUp)
LIMIT 20`,
  },
  {
    id: "hours",
    group: "activities",
    view: "chart",
    needs: "strava",
    label: "Time of day",
    blurb: "When he heads out: activities by local hour.",
    query: `# Activities by the local hour they started.
SELECT ?hour (COUNT(?a) AS ?activities) (ROUND(SUM(?s) / 3600) AS ?hoursMoving) WHERE {
  ?a a yr:Activity ; yr:hour ?hour ; yr:movingTime ?s .
}
GROUP BY ?hour
ORDER BY ?hour`,
  },
  {
    id: "where",
    group: "activities",
    view: "chart",
    needs: "strava",
    label: "Home and away",
    blurb: "Activities by Atlas place (within 60 km), and everywhere else.",
    query: `# Where the activities happen: the nearest Atlas place within 60 km, else "elsewhere".
SELECT ?where (COUNT(?a) AS ?activities) (ROUND(SUM(?m) / 1000) AS ?km) (MIN(?day) AS ?first) (MAX(?day) AS ?last) WHERE {
  ?a a yr:Activity ; yr:distance ?m ; schema:startDate ?day .
  OPTIONAL { ?a schema:location ?place . ?place schema:name ?name }
  BIND(COALESCE(?name, "elsewhere") AS ?where)
}
GROUP BY ?where
ORDER BY DESC(?activities)`,
  },
  {
    id: "commits-and-rides",
    group: "activities",
    needs: "strava",
    label: "Commits & rides",
    blurb: "Days with both a ride and commits: GitHub and Strava, joined on the date.",
    query: `# Days he both rode and pushed commits: two datasets, one graph, joined on the day.
SELECT ?day (SAMPLE(?km) AS ?rideKm) (SUM(?c) AS ?commits) (COUNT(DISTINCT ?repo) AS ?repos) WHERE {
  { SELECT ?day (ROUND(SUM(?m) / 1000) AS ?km) WHERE {
      ?a schema:exerciseType "Ride" ; schema:startDate ?day ; yr:distance ?m .
    } GROUP BY ?day }
  ?repo yr:commitDay ?cd .
  ?cd schema:startDate ?day ; yr:commits ?c .
}
GROUP BY ?day
ORDER BY DESC(?commits)
LIMIT 25`,
  },
  {
    id: "shape",
    label: "Vocabulary",
    blurb: "Classes by instance count — the shape of the data.",
    query: `# The shape of the data: classes and how many things have each.
SELECT ?class (COUNT(?thing) AS ?things) WHERE {
  ?thing a ?class
}
GROUP BY ?class
ORDER BY DESC(?things)`,
  },
];

// ── small helpers ──────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const h = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const fmtN = (n) => n.toLocaleString("en-US");
const fmtMs = (ms) => (ms < 10 ? ms.toFixed(1) : Math.round(ms).toString()) + " ms";
const termKey = (t) => (t ? `${t.termType[0]}:${t.value}${t.language ? "@" + t.language : ""}${t.datatype ? "^" + t.datatype : ""}` : "");

/** Display form of an IRI: prefixed when possible (allows / in the local part, unlike SPARQL). */
function shortIri(iri) {
  const gh = /^https:\/\/yrashk\.com\/atlas\/repo\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)$/.exec(iri);
  if (gh) return `${gh[1]}#${gh[3]}`;
  for (const [p, ns] of PREFIXES) if (iri.startsWith(ns) && iri.length > ns.length) return `${p}:${iri.slice(ns.length)}`;
  if (iri.startsWith("https://github.com/")) return "gh:" + iri.slice(19);
  return iri.replace(/^https?:\/\//, "");
}
/** SPARQL-valid form of an IRI (prefixed only when the local part is a plain name). */
function sparqlIri(iri) {
  for (const [p, ns] of PREFIXES) {
    if (iri.startsWith(ns)) {
      const local = iri.slice(ns.length);
      if (/^[A-Za-z0-9_][A-Za-z0-9_\-.]*$/.test(local) && !local.endsWith(".")) return `${p}:${local}`;
    }
  }
  return `<${iri}>`;
}
/** Literal rendering for cells: value plus a quiet datatype/lang hint. */
function literalParts(t) {
  const dt = t.datatype || "";
  if (t.language) return [t.value, "@" + t.language];
  if (!dt || dt === XSD + "string") return [t.value, ""];
  if (dt.startsWith(XSD)) {
    const k = dt.slice(XSD.length);
    if (["integer", "decimal", "double", "float", "boolean", "gYear", "date", "dateTime", "long", "int"].includes(k)) return [t.value, k === "integer" || k === "decimal" || k === "boolean" ? "" : k];
  }
  return [t.value, "^^" + shortIri(dt)];
}
const isNumeric = (t) => t?.termType === "Literal" && t.datatype && /#(integer|decimal|double|float|long|int|short|byte|nonNegativeInteger|positiveInteger|gYear)$/.test(t.datatype);

// ── SPARQL highlighting ────────────────────────────────────────────────────────
const KW = "SELECT|DISTINCT|REDUCED|WHERE|FROM|NAMED|PREFIX|BASE|ORDER|BY|ASC|DESC|LIMIT|OFFSET|OPTIONAL|UNION|FILTER|GRAPH|BIND|AS|VALUES|UNDEF|MINUS|SERVICE|SILENT|GROUP|HAVING|CONSTRUCT|ASK|DESCRIBE|EXISTS|NOT|IN|LATERAL|INSERT|DELETE|DATA|WITH|USING|CLEAR|DROP|CREATE|LOAD|INTO|TO|SEPARATOR|a|true|false";
const FN = "STR|LANG|LANGMATCHES|DATATYPE|BOUND|IRI|URI|BNODE|RAND|ABS|CEIL|FLOOR|ROUND|CONCAT|STRLEN|UCASE|LCASE|ENCODE_FOR_URI|CONTAINS|STRSTARTS|STRENDS|STRBEFORE|STRAFTER|YEAR|MONTH|DAY|HOURS|MINUTES|SECONDS|TIMEZONE|TZ|NOW|UUID|STRUUID|MD5|SHA1|SHA256|SHA384|SHA512|COALESCE|IF|STRLANG|STRDT|SAMETERM|ISIRI|ISURI|ISBLANK|ISLITERAL|ISNUMERIC|ISTRIPLE|TRIPLE|SUBJECT|PREDICATE|OBJECT|REGEX|SUBSTR|REPLACE|COUNT|SUM|MIN|MAX|AVG|SAMPLE|GROUP_CONCAT";
const TOKEN = new RegExp(
  [
    "(#[^\\n]*)", // 1 comment
    `("""[\\s\\S]*?"""|'''[\\s\\S]*?'''|"(?:[^"\\\\\\n]|\\\\.)*"?|'(?:[^'\\\\\\n]|\\\\.)*'?)`, // 2 string
    "(<[^<>\"{}|^`\\\\\\s]*>)", // 3 iri
    "([?$][A-Za-z_][\\w]*)", // 4 variable
    "((?:[A-Za-z_][\\w.-]*)?:[\\w.\\-%/]*)", // 5 prefixed name
    `(\\b(?:${KW})\\b)`, // 6 keyword
    `(\\b(?:${FN})\\b(?=\\s*\\())`, // 7 function
    "(\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)", // 8 number
    "([{}()\\[\\]])", // 9 bracket
    "([;,.])", // 10 punctuation
    "(\\|\\||&&|!=|<=|>=|[=<>!+\\-*/^|])", // 11 operator
    "(\\s+)", // 12 space
    "([\\s\\S])", // 13 anything else
  ].join("|"),
  "giy",
);
const CLASSES = [null, "c", "s", "i", "v", "p", "k", "f", "n", "b", "u", "o", null, null];
export function highlight(src) {
  TOKEN.lastIndex = 0;
  let out = "";
  let m;
  while ((m = TOKEN.exec(src))) {
    const i = m.findIndex((g, k) => k > 0 && g !== undefined);
    const cls = CLASSES[i];
    out += cls ? `<span class="${cls}">${esc(m[0])}</span>` : esc(m[0]);
  }
  return out;
}

// ── styles (scoped under .qc) ──────────────────────────────────────────────────
const CSS = `
.qc{--qbone:var(--bone,#e9e4d9);--qbone2:var(--bone-2,#b7b1a6);--qbone3:var(--bone-3,#7f7a71);--qbone4:var(--bone-4,#514d47);
  --qsig:var(--signal,#ff6a3d);--qsig2:var(--signal-2,#ffa98a);--qsigdim:var(--signal-dim,rgba(255,106,61,.16));
  --qpanel:var(--panel,#121518);--qpanel2:var(--panel-2,#181c21);--qpanel3:var(--panel-3,#1e2329);--qline:var(--line,#242a31);--qline2:var(--line-2,#30373f);
  --qmono:var(--mono,"IBM Plex Mono",ui-monospace,Menlo,monospace);--qserif:var(--serif,"Instrument Serif",Georgia,serif);--qsans:var(--sans,"Instrument Sans",system-ui,sans-serif);
  --qbg:var(--bg,#0c0e11);--qon-signal:var(--on-signal,var(--bg,#0c0e11));
  /* syntax colours: the OS may define --code-*; else per-theme defaults below */
  --qc-str:var(--code-string,#c9b88a);--qc-iri:var(--code-iri,#8fb7c7);--qc-pn:var(--code-name,#9fc6a3);--qc-fn:var(--code-function,#d7a6e5);--qc-num:var(--code-number,#e6c07b);
  --qsel:color-mix(in oklab,var(--qsig) 30%,transparent);--qsigline:color-mix(in oklab,var(--qsig) 40%,transparent);--qgrid:color-mix(in oklab,var(--qbone) 5%,transparent);
  display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;grid-template-columns:minmax(0,1fr);height:100%;min-height:0;min-width:0;max-width:100%;overflow:hidden;contain:inline-size;background:var(--qpanel);color:var(--qbone);font:13px/1.45 var(--qsans);-webkit-font-smoothing:antialiased}
:root[data-theme="paper"] .qc,.qc[data-theme="paper"]{--qc-str:var(--code-string,#8a6d1f);--qc-iri:var(--code-iri,#1f6b8a);--qc-pn:var(--code-name,#2f7a3d);--qc-fn:var(--code-function,#7a3f8f);--qc-num:var(--code-number,#9a5b00)}
/* contain:inline-size — long editor lines and the status line never widen the host window. */
.qc *,.qc *::before,.qc *::after{box-sizing:border-box}
.qc :where(button){font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
.qc button:focus-visible,.qc textarea:focus-visible,.qc [tabindex]:focus-visible{outline:2px solid var(--qsig);outline-offset:-2px;border-radius:3px}
.qc .k{font:500 10.5px/1 var(--qmono);letter-spacing:.09em;text-transform:uppercase;color:var(--qbone3)}
.qc .mono{font-family:var(--qmono)}
/* toolbar */
.qc-bar{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--qline);min-width:0;overflow:hidden}
.qc-presets{display:flex;gap:3px;overflow-x:auto;scrollbar-width:none;min-width:0;flex:1}
.qc-presets::-webkit-scrollbar{display:none}
.qc-presets .sep{flex:none;width:1px;height:14px;background:var(--qline2);margin:5px 4px}
.qc-presets button{flex:none;height:24px;padding:0 9px;border:1px solid transparent;border-radius:5px;font:500 11px/1 var(--qmono);letter-spacing:.04em;color:var(--qbone3);white-space:nowrap}
.qc-presets button:hover{color:var(--qbone);background:var(--qpanel2)}
.qc-presets button[aria-pressed="true"]{color:var(--qsig2);border-color:var(--qsigline);background:var(--qsigdim)}
.qc-run{flex:none;display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px 0 11px;border-radius:5px;background:var(--qsig);color:var(--qon-signal);font:600 12px/1 var(--qsans)}
.qc-run:hover{filter:brightness(1.08)}
.qc-run kbd{font:500 9.5px/1 var(--qmono);color:var(--qon-signal);opacity:.7;border:1px solid currentColor;border-radius:3px;padding:2px 3px 1px}
/* editor */
.qc-ed{display:grid;grid-template-rows:auto auto;grid-template-columns:minmax(0,1fr);min-width:0;border-bottom:1px solid var(--qline);background:var(--qpanel)}
.qc-edh{display:flex;align-items:flex-start;gap:10px;padding:0 10px 0 0;border-bottom:1px dashed var(--qline);min-width:0}
.qc-edh .qc-pfx{flex:1;min-width:0;border-bottom:0}
.qc-tg{display:inline-flex;align-items:center;gap:5px;height:24px;font:500 10.5px/1 var(--qmono);letter-spacing:.08em;text-transform:uppercase;color:var(--qbone4);cursor:pointer;user-select:none;white-space:nowrap}
.qc-tg:hover{color:var(--qbone2)}
.qc-tg input{appearance:none;width:22px;height:12px;border-radius:7px;background:var(--qline2);position:relative;margin:0;cursor:pointer;transition:background .15s}
.qc-tg input::after{content:"";position:absolute;top:2px;left:2px;width:8px;height:8px;border-radius:50%;background:var(--qpanel);transition:transform .15s}
.qc-tg input:checked{background:var(--qsig)}
.qc-tg input:checked::after{transform:translateX(10px)}
.qc-tg input:checked+span{color:var(--qbone2)}
.qc-tg input:disabled{opacity:.35;cursor:not-allowed}
.qc-pfx{display:flex;align-items:center;gap:8px;padding:4px 10px;font:11px/1.3 var(--qmono);color:var(--qbone4);cursor:pointer;user-select:none;border-bottom:1px dashed var(--qline)}
.qc-pfx:hover{color:var(--qbone3)}
.qc-pfx .tri{display:inline-block;transition:transform .15s;font-size:9px}
.qc-pfx.open .tri{transform:rotate(90deg)}
.qc-pfx pre{display:none;margin:0;font:inherit;color:var(--qbone4);white-space:pre}
.qc-pfx.open pre{display:block}
.qc-pfx.open .sum{display:none}
.qc-pfx .sum{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qc-pfx .sum b{color:var(--qbone3);font-weight:500}
.qc-code{position:relative;display:grid;grid-template-columns:auto 1fr;max-height:min(46vh,380px);overflow:auto;font:12.5px/1.6 var(--qmono);tab-size:2}
.qc-gut{padding:8px 0 10px;text-align:right;color:var(--qbone4);user-select:none;background:var(--qpanel);position:sticky;left:0;z-index:2;border-right:1px solid var(--qline)}
.qc-gut i{display:block;padding:0 9px 0 10px;font-style:normal;min-width:3.5ch}
.qc-gut i.err{color:var(--qsig);background:var(--qsigdim)}
.qc-wrap{position:relative;min-width:0}
.qc-code pre,.qc-code textarea{margin:0;padding:8px 14px 10px 12px;font:inherit;white-space:pre;overflow:hidden;min-height:100%;width:100%;border:0;background:transparent;tab-size:2}
.qc-code pre{position:absolute;inset:0;pointer-events:none;color:var(--qbone2);width:max-content;min-width:100%}
.qc-code pre .errline{background:var(--qsigdim);display:inline-block;width:100%;margin:0 -14px 0 -12px;padding:0 14px 0 12px}
.qc-code textarea{position:relative;display:block;color:transparent;caret-color:var(--qsig);resize:none;outline:0;-webkit-text-fill-color:transparent;overflow:hidden}
.qc-code textarea::selection{background:var(--qsel);-webkit-text-fill-color:transparent}
.qc-code .c{color:var(--qbone4);font-style:italic}.qc-code .s{color:var(--qc-str)}.qc-code .i{color:var(--qc-iri)}.qc-code .v{color:var(--qsig2)}.qc-code .p{color:var(--qc-pn)}
.qc-code .k{color:var(--qbone);font-weight:500;letter-spacing:0;text-transform:none;font-size:inherit;font-family:inherit}.qc-code .f{color:var(--qc-fn)}.qc-code .n{color:var(--qc-num)}.qc-code .b{color:var(--qbone3)}.qc-code .u{color:var(--qbone4)}.qc-code .o{color:var(--qbone3)}
/* CodeMirror editor (lazy; the textarea above is the fallback) */
.qc-code.cm{display:block;overflow:visible;max-height:none;min-width:0}
.qc-code .cm-editor{min-width:0;max-width:100%}
.qc-code .cm-editor{max-height:min(46vh,380px);font:12.5px/1.6 var(--qmono);color:var(--qbone2);background:transparent}
.qc-code .cm-editor.cm-focused{outline:none}
.qc-code .cm-scroller{font-family:inherit;line-height:inherit;overflow:auto}
.qc-code .cm-content{padding:8px 0 10px;caret-color:var(--qsig)}
.qc-code .cm-line{padding:0 14px 0 12px}
.qc-code .cm-gutters{background:var(--qpanel);color:var(--qbone4);border:0;border-right:1px solid var(--qline);font-family:inherit}
.qc-code .cm-lineNumbers .cm-gutterElement{padding:0 9px 0 10px;min-width:3.5ch}
.qc-code .cm-activeLineGutter{background:transparent;color:var(--qbone3)}
.qc-code .cm-activeLine{background:transparent}
.qc-code .cm-cursor,.qc-code .cm-dropCursor{border-left:1.5px solid var(--qsig)}
.qc-code .cm-selectionBackground,.qc-code.cm .cm-editor.cm-focused .cm-selectionBackground{background:var(--qsel)!important}
.qc-code .cm-matchingBracket{background:var(--qsigdim);outline:1px solid var(--qsigline)}
.qc-code .cm-errline{background:var(--qsigdim)}
.qc-code .cm-errline.cm-line::before{content:"";position:absolute;left:0;top:0;bottom:0;border-left:2px solid var(--qsig)}
.qc-code .cm-line{position:relative}
.qc-code .cm-fat-cursor{background:var(--qsig)!important;color:var(--qon-signal)!important}
.qc-code .cm-editor:not(.cm-focused) .cm-fat-cursor{outline:1px solid var(--qsig);background:transparent!important;color:inherit!important}
.qc-code .cm-panels{background:var(--qpanel2);border-top:1px solid var(--qline);color:var(--qbone2);font:12px/1.4 var(--qmono)}
.qc-code .cm-vim-panel{padding:3px 10px;display:flex;gap:6px;align-items:center;color:var(--qsig2)}
.qc-code .cm-vim-panel input{font:inherit;color:var(--qbone);background:transparent;border:0;outline:0;flex:1}
.qc-code .cm-searchMatch{background:var(--qsigdim);outline:1px solid var(--qsigline)}
.qc-code .cm-searchMatch.cm-searchMatch-selected{background:var(--qsel)}
.qc-code .cm-selectionMatch{background:color-mix(in oklab,var(--qbone) 10%,transparent)}
.qc-code .cm-tooltip{background:var(--qpanel3);border:1px solid var(--qline2);color:var(--qbone2);font:11px var(--qmono)}
/* completion popup: OS look, no CodeMirror defaults */
.qc .qc-code .cm-tooltip.cm-tooltip-autocomplete{background:var(--qpanel2);border:1px solid var(--qline2);border-radius:5px;box-shadow:0 10px 28px rgba(0,0,0,.28);font:12px/1.5 var(--qmono);color:var(--qbone2);overflow:hidden}
.qc .qc-code .cm-tooltip.cm-tooltip-autocomplete>ul{font:inherit;max-height:16em;min-width:22ch;max-width:min(60ch,80vw)}
.qc .qc-code .cm-tooltip.cm-tooltip-autocomplete>ul>li{padding:3px 10px 3px 8px;line-height:1.5;display:flex;align-items:baseline;gap:7px;min-width:0}
.qc .qc-code .cm-tooltip.cm-tooltip-autocomplete>ul>li[aria-selected]{background:var(--qsigdim);color:var(--qbone)}
.qc .qc-code .cm-tooltip.cm-tooltip-autocomplete>ul>li[aria-selected] .cm-completionLabel{color:var(--qbone)}
.qc .qc-code .cm-completionLabel{flex:none;color:var(--qbone);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34ch}
.qc .qc-code .cm-completionMatchedText{text-decoration:none;color:var(--qsig2);font-weight:500}
.qc .qc-code .cm-completionDetail{margin-left:auto;font-style:normal;color:var(--qbone4);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;padding-left:8px}
.qc .qc-code .cm-completionIcon{flex:none;width:1.4em;opacity:1;padding:0;font:500 9.5px/1 var(--qmono);letter-spacing:0;color:var(--qbone4);text-align:center;border:1px solid var(--qline2);border-radius:3px;height:1.4em;display:inline-grid;place-items:center;align-self:center}
.qc .qc-code .cm-completionIcon::after{content:"·"}
.qc .qc-code .cm-completionIcon-class::after{content:"C"}
.qc .qc-code .cm-completionIcon-class{color:var(--qc-iri);border-color:var(--qc-iri)}
.qc .qc-code .cm-completionIcon-property::after{content:"p"}
.qc .qc-code .cm-completionIcon-property{color:var(--qc-pn);border-color:var(--qc-pn)}
.qc .qc-code .cm-completionIcon-individual::after{content:"◎"}
.qc .qc-code .cm-completionIcon-individual{color:var(--qbone2)}
.qc .qc-code .cm-completionIcon-datatype::after{content:"^^"}
.qc .qc-code .cm-completionIcon-datatype{color:var(--qc-num)}
.qc .qc-code .cm-completionIcon-variable::after{content:"?"}
.qc .qc-code .cm-completionIcon-variable{color:var(--qsig2);border-color:var(--qsig2)}
.qc .qc-code .cm-completionIcon-namespace::after{content:":"}
.qc .qc-code .cm-completionIcon-keyword::after{content:"K"}
.qc .qc-code .cm-completionIcon-function::after{content:"ƒ"}
.qc .qc-code .cm-completionIcon-function{color:var(--qc-fn)}
.qc .qc-code .cm-tooltip.cm-completionInfo{display:none}
/* results */
.qc-res{display:grid;grid-template-rows:auto minmax(0,1fr);grid-template-columns:minmax(0,1fr);min-height:0;min-width:0;position:relative}
.qc-res.stale .qc-view{opacity:.5;transition:opacity .25s}
.qc-res.stale::after{content:"stale";position:absolute;right:10px;top:34px;font:500 9.5px/1 var(--qmono);letter-spacing:.1em;text-transform:uppercase;color:var(--qsig2);background:var(--qsigdim);border:1px solid var(--qsigline);border-radius:3px;padding:3px 6px;pointer-events:none;z-index:2}
.qc-tabs{display:flex;align-items:center;gap:2px;padding:4px 8px;border-bottom:1px solid var(--qline);background:var(--qpanel)}
.qc-tabs button{height:22px;padding:0 8px;border-radius:4px;font:500 10.5px/1 var(--qmono);letter-spacing:.08em;text-transform:uppercase;color:var(--qbone3)}
.qc-tabs button:hover{color:var(--qbone);background:var(--qpanel2)}
.qc-tabs button[aria-selected="true"]{color:var(--qbone);background:var(--qpanel3)}
.qc-tabs button .x{margin-left:6px;color:var(--qbone4)}
.qc-tabs .sp{flex:1}
.qc-tabs .act{color:var(--qbone4);text-transform:none;letter-spacing:.02em;font-weight:400}
.qc-tabs .act:hover{color:var(--qsig2)}
.qc-view{min-height:0;overflow:auto;position:relative;overscroll-behavior:contain}
.qc-view[hidden]{display:none}
.qc-empty{padding:28px 20px;color:var(--qbone3);font:italic 16px/1.5 var(--qserif);text-align:center}
.qc-empty b{color:var(--qbone2);font-weight:400}
/* table */
.qc-table{width:100%;border-collapse:collapse;font:12px/1.5 var(--qmono);color:var(--qbone2)}
.qc-table th{font:500 10px/1 var(--qmono);letter-spacing:.1em;text-transform:uppercase;color:var(--qbone4);text-align:left;padding:9px 12px 7px;border-bottom:1px solid var(--qline);position:sticky;top:0;background:var(--qpanel);cursor:pointer;user-select:none;white-space:nowrap;z-index:1}
.qc-table th:hover{color:var(--qbone2)}
.qc-table th[aria-sort="ascending"],.qc-table th[aria-sort="descending"]{color:var(--qsig2)}
.qc-table th .dir{margin-left:4px;color:var(--qsig)}
.qc-table th.num,.qc-table td.num{text-align:right;font-variant-numeric:tabular-nums}
.qc-table td{padding:5px 12px;border-bottom:1px solid var(--qline);white-space:nowrap;max-width:34ch;overflow:hidden;text-overflow:ellipsis;vertical-align:top}
.qc-table td.wide{max-width:60ch}
.qc-table tr:hover td{background:var(--qpanel2)}
.qc-table tr.lit td{background:var(--qsigdim)}
.qc-table td.row{color:var(--qbone4);width:4ch;text-align:right;padding-right:6px;font-size:10px}
.qc-table td .hint{color:var(--qbone4);font-size:10px;margin-left:5px}
.qc-table td .str{color:var(--qbone)}
.qc-table td .un{color:var(--qbone4)}
.qc-table td .bn{color:var(--qbone3)}
.qc-iri{color:var(--qc-iri);text-decoration:none;border-bottom:1px solid transparent;cursor:pointer;font:inherit;white-space:nowrap}
.qc-iri:hover{border-color:currentColor}
.qc-iri.body{color:var(--qbone)}
.qc-loc{display:inline-block;margin-left:5px;color:var(--qbone4);font-size:11px;line-height:1;vertical-align:0}
.qc-loc:hover{color:var(--qsig)}
.qc-foot{padding:8px 12px;color:var(--qbone4);font:11px/1.4 var(--qmono)}
/* graph */
.qc-g{position:relative;height:100%;min-height:200px;overflow:hidden;background:
  radial-gradient(var(--qgrid) 1px,transparent 1px) 11px 11px/22px 22px, var(--qpanel)}
.qc-g canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
.qc-g canvas.drag{cursor:grabbing}
.qc-g canvas.pt{cursor:pointer}
.qc-crumbs{position:absolute;left:8px;top:8px;right:8px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;pointer-events:none;font:11px/1 var(--qmono)}
.qc-crumbs button{pointer-events:auto;height:22px;padding:0 8px;border-radius:4px;border:1px solid var(--qline);background:var(--qpanel);color:var(--qbone3);font:inherit;max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qc-crumbs button:hover{color:var(--qbone);border-color:var(--qline2)}
.qc-crumbs button[aria-current="true"]{color:var(--qsig2);border-color:var(--qsigline);background:var(--qsigdim)}
.qc-crumbs .sep{color:var(--qbone4)}
.qc-gctl{position:absolute;right:8px;bottom:8px;display:flex;gap:2px;flex-direction:column}
.qc-gctl button{width:24px;height:24px;display:grid;place-items:center;border:1px solid var(--qline);border-radius:4px;background:var(--qpanel);color:var(--qbone3);font:13px/1 var(--qmono)}
.qc-gctl button:hover{color:var(--qbone);border-color:var(--qline2)}
.qc-gsel:not([hidden])~.qc-gnote{display:none}
.qc-gnote{position:absolute;left:10px;bottom:9px;color:var(--qbone4);font:italic 12px/1.3 var(--qserif);pointer-events:none;max-width:60%}
.qc-gtip{position:absolute;pointer-events:none;background:var(--qpanel3);border:1px solid var(--qline2);border-radius:5px;padding:6px 9px;font:11px/1.4 var(--qmono);color:var(--qbone2);max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform:translate(12px,12px);box-shadow:0 6px 18px rgba(0,0,0,.35);z-index:3}
.qc-gtip b{display:block;font:italic 14px/1.2 var(--qserif);color:var(--qbone);font-weight:400;margin-bottom:2px}
.qc-gtip[hidden]{display:none}
.qc-gsel{position:absolute;left:8px;bottom:8px;display:flex;gap:4px;align-items:center;background:var(--qpanel);border:1px solid var(--qline2);border-radius:5px;padding:5px 6px 5px 10px;font:11px/1 var(--qmono);color:var(--qbone2);max-width:calc(100% - 60px)}
.qc-gsel[hidden]{display:none}
.qc-gsel b{font:italic 14px/1 var(--qserif);color:var(--qbone);font-weight:400;max-width:24ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qc-gsel button{height:20px;padding:0 7px;border-radius:3px;color:var(--qbone3);font:inherit;border:1px solid transparent}
.qc-gsel button:hover{color:var(--qsig2);background:var(--qsigdim)}
/* inspector */
.qc-insp{padding:14px 16px 20px;font:12px/1.5 var(--qmono)}
.qc-insp h2{margin:0 0 2px;font:italic 22px/1.15 var(--qserif);font-weight:400;color:var(--qbone)}
.qc-insp .iri{color:var(--qbone3);font-size:11px;word-break:break-all}
.qc-insp .acts{display:flex;gap:6px;margin:10px 0 14px;flex-wrap:wrap}
.qc-insp .acts button,.qc-insp .acts a{height:24px;display:inline-flex;align-items:center;gap:6px;padding:0 9px;border:1px solid var(--qline2);border-radius:4px;font:11px/1 var(--qmono);color:var(--qbone2);text-decoration:none;background:var(--qpanel2)}
.qc-insp .acts button:hover,.qc-insp .acts a:hover{border-color:var(--qsig);color:var(--qsig2)}
.qc-insp h3{margin:14px 0 6px;font:500 10px/1 var(--qmono);letter-spacing:.1em;text-transform:uppercase;color:var(--qbone4)}
.qc-insp table{border-collapse:collapse;width:100%}
.qc-insp td{padding:4px 10px 4px 0;vertical-align:top;border-bottom:1px solid var(--qline);color:var(--qbone2)}
.qc-insp td.p{color:var(--qc-pn);white-space:nowrap;width:1%}
.qc-insp td .str{color:var(--qbone);white-space:pre-wrap}
.qc-insp td .hint{color:var(--qbone4);font-size:10px;margin-left:5px}
.qc-insp .bn{color:var(--qbone3)}
.qc-insp .nested{color:var(--qbone3)}
/* schema */
.qc-schema{padding:12px 16px 20px;display:grid;grid-template-columns:1fr 1fr;gap:18px;font:12px/1.5 var(--qmono)}
@media (max-width:720px){.qc-schema{grid-template-columns:1fr}}
.qc-schema h3{margin:0 0 6px;font:500 10px/1 var(--qmono);letter-spacing:.1em;text-transform:uppercase;color:var(--qbone4)}
.qc-schema ul{list-style:none;margin:0;padding:0}
.qc-schema li{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:3px 0;border-bottom:1px solid var(--qline)}
.qc-schema li button{text-align:left;color:var(--qc-pn);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qc-schema li button.cls{color:var(--qc-iri)}
.qc-schema li button:hover{color:var(--qsig2)}
.qc-schema li .n{color:var(--qbone3);font-variant-numeric:tabular-nums}
.qc-schema li .bar{height:3px;background:var(--qsig);opacity:.55;border-radius:2px;grid-column:1/-1;margin:-2px 0 2px;justify-self:start}
.qc-schema p{grid-column:1/-1;margin:0;color:var(--qbone3);font:italic 13px/1.5 var(--qserif)}
/* status */
.qc-status{display:flex;align-items:center;gap:14px;padding:5px 10px;border-top:1px solid var(--qline);font:11px/1.3 var(--qmono);color:var(--qbone4);min-width:0;white-space:nowrap;overflow:hidden}
.qc-status .st-load{min-width:0;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto}
.qc-status .st-res{flex:none}
.qc-status .sp{flex:1 1 0;min-width:6px}
.qc-status b{color:var(--qbone3);font-weight:500;font-variant-numeric:tabular-nums}
.qc-status .err{color:var(--qsig);overflow:hidden;text-overflow:ellipsis}
.qc-status .sp{flex:1}
.qc-status .dot{width:6px;height:6px;border-radius:50%;background:var(--qsig);box-shadow:0 0 8px var(--signal-glow,rgba(255,106,61,.55))}
.qc-status .dot.idle{background:var(--qbone4);box-shadow:none}
.qc-status .st-mode{font:500 9.5px/1 var(--qmono);letter-spacing:.1em;text-transform:uppercase;color:var(--qon-signal);background:var(--qsig);border-radius:3px;padding:3px 6px}
.qc-status .st-mode.insert{background:var(--qbone2)}
.qc-status .st-mode.visual{background:var(--qsig2)}
.qc-status .st-mode[hidden]{display:none}
.qc-status .hint{color:var(--qsig2)}
/* chart view: series hues validated (dataviz validator) on the graphite and paper panels */
.qc{--qc-s1:#3987e5;--qc-s2:#d95926;--qc-s3:#199e70;--qc-s4:#c98500;--qc-s5:#d55181;--qc-s6:#008300;--qc-s7:#9085e9;--qc-s8:#e66767;--qc-other:var(--qbone4)}
:root[data-theme="paper"] .qc,.qc[data-theme="paper"]{--qc-s1:#2a78d6;--qc-s2:#eb6834;--qc-s3:#1baf7a;--qc-s4:#eda100;--qc-s5:#e87ba4;--qc-s6:#008300;--qc-s7:#6250d6;--qc-s8:#e34948}
.qc-view[data-view="chart"]{overflow-x:hidden}
.qc-ch-h{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:8px 12px 2px;min-height:34px;font:11px/1.2 var(--qmono);color:var(--qbone3)}
.qc-ch-m{color:var(--qbone2)}
.qc-ch-ms{display:flex;gap:3px;flex-wrap:wrap}
.qc-ch-ms button{height:22px;padding:0 8px;border:1px solid transparent;border-radius:4px;font:inherit;color:var(--qbone3)}
.qc-ch-ms button:hover{color:var(--qbone)}
.qc-ch-ms button[aria-pressed="true"]{color:var(--qsig2);border-color:var(--qsigline);background:var(--qsigdim)}
.qc-ch-lg{display:flex;flex-wrap:wrap;gap:4px 12px}
.qc-ch-lg span{display:inline-flex;align-items:center;gap:5px;color:var(--qbone2)}
.qc-ch-lg i{width:9px;height:9px;border-radius:2px}
.qc-ch{display:block}
.qc-ch .gl{stroke:var(--qline);stroke-width:1}
.qc-ch .base{stroke:var(--qline2);stroke-width:1}
.qc-ch .ax{fill:var(--qbone4);font:10px var(--qmono);font-variant-numeric:tabular-nums}
.qc-ch .lb{fill:var(--qbone2);font:11.5px var(--qmono)}
.qc-ch .hit{fill:transparent}
.qc-ch .hit.on{fill:var(--qpanel2);fill-opacity:.55}
.qc-map{background:var(--qpanel)}
.qc-map .qc-gnote{bottom:22px}
.qc-map .qc-gnote:not(:empty),.qc-mattr:not(:empty){background:color-mix(in oklab,var(--qpanel) 80%,transparent);padding:2px 6px;border-radius:3px;left:6px}
.qc-mattr{position:absolute;left:10px;bottom:6px;font:9.5px/1 var(--qmono);color:var(--qbone4);white-space:nowrap;overflow:hidden;max-width:calc(100% - 60px);text-overflow:ellipsis}
.qc-mattr a{color:inherit}
.qc-mclu{position:absolute;left:8px;top:8px;right:8px;display:flex;flex-wrap:wrap;gap:3px}
.qc-mclu[hidden]{display:none}
.qc-mclu button{height:22px;padding:0 8px;border:1px solid var(--qline);border-radius:4px;background:var(--qpanel);font:11px/1 var(--qmono);color:var(--qbone3)}
.qc-mclu button:hover{color:var(--qbone)}
.qc-mclu button[aria-pressed="true"]{color:var(--qsig2);border-color:var(--qsigline);background:var(--qsigdim)}
`;
// ── the console ────────────────────────────────────────────────────────────────
export async function mountQueryConsole(element, options = {}) {
  const { turtleUrl = "../data/atlas.ttl", engineUrl = "../data/rdf/", onLocate = () => {}, onHighlight = () => {}, hash = false, codemirror = true } = options;
  // contributions.ttl (PRs, issues, commit days) sits next to atlas.ttl; null disables it.
  const contributionsUrl = options.contributionsUrl === undefined ? new URL("contributions.ttl", new URL(turtleUrl, document.baseURI)).href : options.contributionsUrl;
  // strava.ttl (activities) loads third, after contributions; null disables it and its presets.
  const stravaUrl = options.stravaUrl === undefined ? new URL("strava.ttl", new URL(turtleUrl, document.baseURI)).href : options.stravaUrl;
  const presets = PRESETS.filter((p) => p.needs !== "strava" || stravaUrl);
  // strava-tracks.json (privacy-trimmed routes) is read the first time the Map view opens.
  // Map background: OpenStreetMap's standard raster tiles (no key; attribution shown; light use per the
  // OSM tile policy), toned per theme on the canvas. `tiles: null` draws routes on the bare panel.
  const tiles = options.tiles === undefined
    ? { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19,
        dark: "invert(1) hue-rotate(180deg) saturate(0.35) brightness(0.8) contrast(0.85)", paper: "saturate(0.45) sepia(0.12) contrast(0.95)",
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }
    : options.tiles;
  const tracksUrl = options.tracksUrl === undefined ? (stravaUrl ? new URL("strava-tracks.json", new URL(turtleUrl, document.baseURI)).href : null) : options.tracksUrl;
  const ac = new AbortController();
  const sig = ac.signal;
  const on = (el, ev, fn, o) => el.addEventListener(ev, fn, { ...(o || {}), signal: sig });

  element.classList.add("qc");
  element.innerHTML = `
    <style>${CSS}</style>
    <div class="qc-bar">
      <div class="qc-presets" role="tablist" aria-label="Preset queries"></div>
      <button class="qc-run" title="Run (⌘↩ / Ctrl+Enter)">run <kbd>⌘↩</kbd></button>
    </div>
    <div class="qc-ed">
      <div class="qc-edh">
        <div class="qc-pfx" role="button" tabindex="0" aria-expanded="false" title="Prefixes declared for every query"><span class="tri">▶</span><span class="sum"><b>${PREFIXES.length} prefixes</b> declared · ${PREFIXES.map(([p]) => p + ":").join(" ")}</span><pre>${esc(PREFIX_BLOCK)}</pre></div>
        <label class="qc-tg" title="Run the query as you type, once it parses"><input type="checkbox" data-pref="auto"><span>auto</span></label>
        <label class="qc-tg" title="Vim keys in the editor (:w or :run runs, :q leaves)"><input type="checkbox" data-pref="vim"><span>vim</span></label>
      </div>
      <div class="qc-code"></div>
    </div>
    <div class="qc-res">
      <div class="qc-tabs" role="tablist">
        <button data-view="table" role="tab" aria-selected="true">Table</button>
        <button data-view="graph" role="tab">Graph</button>
        <button data-view="chart" role="tab">Chart</button>
        <button data-view="map" role="tab">Map</button>
        <button data-view="schema" role="tab">Vocabulary</button>
        <button data-view="inspect" role="tab" hidden>Inspect</button>
        <span class="sp"></span>
        <button class="act" data-act="csv" title="Download the result as CSV">↓ csv</button>
        <button class="act" data-act="copy" title="Copy the result (CSV, or Turtle for graphs)">copy</button>
      </div>
      <div class="qc-view" data-view="table"></div>
      <div class="qc-view" data-view="graph" hidden><div class="qc-g"><canvas></canvas><div class="qc-crumbs"></div><div class="qc-gtip" hidden></div><div class="qc-gsel" hidden></div><div class="qc-gnote"></div><div class="qc-gctl"><button data-g="in" title="Zoom in">+</button><button data-g="out" title="Zoom out">−</button><button data-g="fit" title="Fit">⌂</button></div></div></div>
      <div class="qc-view" data-view="chart" hidden></div>
      <div class="qc-view" data-view="map" hidden><div class="qc-g qc-map"><canvas></canvas><div class="qc-mclu" hidden></div><div class="qc-mattr"></div><div class="qc-gtip" hidden></div><div class="qc-gnote"></div><div class="qc-gctl"><button data-g="in" title="Zoom in">+</button><button data-g="out" title="Zoom out">−</button><button data-g="fit" title="Fit">⌂</button></div></div></div>
      <div class="qc-view" data-view="schema" hidden></div>
      <div class="qc-view" data-view="inspect" hidden></div>
    </div>
    <div class="qc-status"><span class="dot idle"></span><span class="st-load">loading engine…</span><span class="sp"></span><span class="st-mode" hidden></span><span class="st-res"></span></div>`;

  const $ = (s) => element.querySelector(s);
  const code = $(".qc-code");
  const status = { load: $(".st-load"), res: $(".st-res"), mode: $(".st-mode"), dot: $(".qc-status .dot") };
  const resEl = $(".qc-res");
  const views = Object.fromEntries([...element.querySelectorAll(".qc-view")].map((v) => [v.dataset.view, v]));
  const tabs = Object.fromEntries([...element.querySelectorAll(".qc-tabs [data-view]")].map((b) => [b.dataset.view, b]));

  // ── engine + data ──────────────────────────────────────────────────────────
  const t0 = performance.now();
  const engineBase = new URL(engineUrl, document.baseURI);
  const { openStore } = await import(new URL("engine.js", engineBase).href);
  const [store, ttlRes] = await Promise.all([openStore(new URL("wat.wasm", engineBase).href), fetch(new URL(turtleUrl, document.baseURI))]);
  if (!ttlRes.ok) throw new Error(`query console: ${ttlRes.status} fetching ${turtleUrl}`);
  const parsed = store.loadTurtle(await ttlRes.text());
  const loadMs = performance.now() - t0;
  if (sig.aborted) return { run: () => null, dispose() {} };

  // Atlas bodies: IRI → {id, kind, name, sector}; authored repositories; names for any IRI.
  const bodies = new Map();
  const names = new Map();
  const authored = new Set();
  function refreshNames() {
    for (const [s, name, kind, sector] of store.query(`SELECT ?s ?name ?kind ?sector WHERE { ?s <https://schema.org/name> ?name . OPTIONAL { ?s <${NS}sector> ?sector } OPTIONAL { ?s a ?kind FILTER(STRSTARTS(STR(?kind), "${NS}")) } }`).rows) {
      names.set(s.value, name.value);
      if (sector) bodies.set(s.value, { id: s.value.slice(BASE.length), kind: kind ? kind.value.slice(NS.length) : "", name: name.value });
    }
    for (const [s, label] of store.query(`SELECT ?s ?l WHERE { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?l }`).rows) names.set(s.value, label.value);
  }
  refreshNames();
  for (const [r] of store.query(`SELECT ?r WHERE { <${BASE}yrashk> <${NS}authored> ?r }`).rows) authored.add(r.value);
  const repoBody = new Map();
  for (const [r, b] of store.query(`SELECT ?r ?b WHERE { ?r <${NS}body> ?b }`).rows) repoBody.set(r.value, b.value);
  /** The Atlas id an IRI maps to (a body, or the body a repository is drawn as), else null. */
  const atlasId = (iri) => bodies.get(iri)?.id ?? (repoBody.has(iri) ? bodies.get(repoBody.get(iri))?.id : null) ?? (iri.startsWith(BASE + "repo/") ? iri.slice(BASE.length) : null);
  const labelOf = (t) => {
    if (!t) return "";
    if (t.termType === "Literal") return t.value;
    if (t.termType === "BlankNode") return "_:" + t.value;
    return names.get(t.value) || shortIri(t.value);
  };

  status.dot.classList.remove("idle");
  let last = null; // {text, result, ms, preset}
  let currentPreset = null;
  const coreTriples = store.tripleCount();
  // Graphs that arrive in the background, in order, after the core Atlas: queries see each as it lands.
  const extras = [
    { name: "contributions", url: contributionsUrl },
    { name: "strava", url: stravaUrl },
  ].map((x) => ({ ...x, state: x.url ? "loading" : "none", ms: 0 })); // loading | loaded | failed | none
  const extra = Object.fromEntries(extras.map((x) => [x.name, x]));
  const showLoad = () => {
    const tail = extras
      .map((x) => (x.state === "loaded" ? ` (+ ${x.name}, <b>${fmtMs(x.ms)}</b>)` : x.state === "loading" ? ` <span class="hint">+ ${x.name}…</span>` : x.state === "failed" ? ` <span title="${x.name}.ttl did not load">· ${x.name} unavailable</span>` : ""))
      .join("");
    status.load.innerHTML = `<b>${fmtN(store.tripleCount())}</b> triples · WAT engine · loaded in <b>${fmtMs(loadMs)}</b>${tail}`;
  };
  showLoad();
  let chain = Promise.resolve();
  for (const x of extras) {
    x.ready = !x.url
      ? Promise.resolve(false)
      : (chain = chain.then(async () => {
          try {
            const res = await fetch(x.url);
            if (!res.ok) throw new Error(`${res.status} ${x.url}`);
            const text = await res.text();
            if (sig.aborted) return false;
            const t = performance.now();
            store.loadTurtle(text);
            x.ms = performance.now() - t;
            refreshNames();
            buildIndex();
            x.state = "loaded";
          } catch (e) {
            console.warn(`query console: ${x.name} not loaded:`, e);
            x.state = "failed";
          }
          showLoad();
          // The query on screen may now have more to say.
          if (x.state === "loaded" && last && !last.error && editor.value === last.text) run(last.text, { fromEditor: true, preset: currentPreset, quiet: true });
          return x.state === "loaded";
        }));
  }
  const contribReady = extra.contributions.ready;

  // ── editor: CodeMirror 6 when the vendored bundle loads, else the textarea ──
  const prefs = {
    get: (k, d) => {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : v === "1" || v === "true";
      } catch {
        return d;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v ? "1" : "0");
      } catch {}
    },
  };
  let auto = prefs.get("yr-autorun", true);
  let vimOn = prefs.get("yr-vim", false);
  // Completion data: the term index (rebuilt when contributions land) and the prefixes in play.
  let termIndex = null;
  const buildIndex = () => {
    const t = performance.now();
    termIndex = buildTermIndex(store, names);
    termIndex.ms = performance.now() - t;
  };
  buildIndex();
  const extraPrefixes = new Set(); // common prefixes the query uses; declared on run and shown in the block
  const usedPrefixes = (q) => {
    const found = new Set();
    const clean = q.replace(/#[^\n]*/g, " ").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/<[^>\s]*>/g, "<>");
    for (let m, re = /(^|[^\w:<-])([A-Za-z_][\w-]*):/g; (m = re.exec(clean)); ) found.add(m[2]);
    return found;
  };
  const prefixMap = () => {
    const m = new Map(PREFIXES);
    for (const p of extraPrefixes) m.set(p, KNOWN_NS.get(p));
    for (const [p, ns] of COMMON_PREFIXES) if (!m.has(p)) m.set(p, ns);
    return m;
  };
  function refreshPrefixBlock() {
    for (const p of usedPrefixes(editor.value)) if (KNOWN_NS.has(p) && !PREFIXES.some(([b]) => b === p)) extraPrefixes.add(p);
    const all = [...PREFIXES, ...[...extraPrefixes].map((p) => [p, KNOWN_NS.get(p)])];
    const pfxEl = $(".qc-pfx");
    pfxEl.querySelector("pre").textContent = all.map(([p, ns]) => `PREFIX ${p}: <${ns}>`).join("\n");
    pfxEl.querySelector(".sum").innerHTML = `<b>${all.length} prefixes</b> declared · ${all.map(([p]) => p + ":").join(" ")}`;
  }
  const editorCallbacks = {
    completion: null, // set below, once the index exists
    onRun: () => run(editor.value, { fromEditor: true }),
    onChange: () => onEdit(),
    onMode: (m) => {
      status.mode.hidden = !m;
      if (m) {
        status.mode.textContent = m.toUpperCase();
        status.mode.className = "st-mode " + m.split(" ")[0];
      }
    },
    onBlur: () => {},
  };
  const editor = await createEditor(code, editorCallbacks, {
    cmUrl: codemirror ? new URL("vendor/codemirror.js", import.meta.url).href : null,
    completion: (CM) =>
      sparqlCompletionSource(
        {
          index: () => termIndex,
          prefixes: prefixMap,
          notePrefix: (p) => {
            if (KNOWN_NS.has(p) && !PREFIXES.some(([b]) => b === p)) extraPrefixes.add(p);
            refreshPrefixBlock();
          },
        },
        CM,
      ),
  });
  if (sig.aborted) return { run: () => null, dispose() {} };
  // Keys typed in the editor are the editor's: nothing bubbles to the OS (its global keys, its Esc).
  for (const ev of ["keydown", "keyup", "keypress"]) on($(".qc-ed"), ev, (e) => e.stopPropagation());
  const setQuery = (q) => editor.setValue(q);
  const tgAuto = $('[data-pref="auto"]'), tgVim = $('[data-pref="vim"]');
  tgAuto.checked = auto;
  tgVim.checked = vimOn && editor.kind === "cm";
  if (editor.kind !== "cm") {
    tgVim.disabled = true;
    tgVim.closest("label").title = "Vim mode needs the CodeMirror bundle (vendor/codemirror.js), which did not load";
  } else if (vimOn) editor.setVim(true);
  on(tgAuto, "change", () => {
    auto = tgAuto.checked;
    prefs.set("yr-autorun", auto);
    if (auto) scheduleAuto();
  });
  on(tgVim, "change", () => {
    vimOn = tgVim.checked;
    prefs.set("yr-vim", vimOn);
    editor.setVim(vimOn);
    editor.focus();
  });

  // Autorun: a debounced run after edits, budgeted so a slow query cannot hold the page.
  let autoTimer = 0, slowUntilEdit = false, lastRunText = null;
  const AUTO_DELAY = 320, AUTO_BUDGET_MS = 150;
  const isUpdate = (q) => /^\s*(INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD|WITH)\b/i.test(q.replace(/#[^\n]*/g, "").replace(/^\s*(PREFIX|BASE)\s+[^\n]*$/gim, ""));
  function onEdit() {
    slowUntilEdit = false;
    refreshPrefixBlock();
    if (errLine) {
      errLine = 0;
      editor.setError(0);
    }
    scheduleAuto();
  }
  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (!auto) return;
    autoTimer = setTimeout(autoRun, AUTO_DELAY);
  }
  function autoRun() {
    if (!auto || slowUntilEdit || sig.aborted) return;
    const text = editor.value;
    if (text === lastRunText || !text.trim()) return;
    if (isUpdate(text)) {
      status.res.innerHTML = `<span class="hint">update — ⌘↵ to run</span>`;
      return;
    }
    run(text, { fromEditor: true, auto: true, preset: currentPreset });
  }
  let errLine = 0;
  const pfx = $(".qc-pfx");
  const togglePfx = () => {
    pfx.classList.toggle("open");
    pfx.setAttribute("aria-expanded", pfx.classList.contains("open"));
  };
  on(pfx, "click", togglePfx);
  on(pfx, "keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), togglePfx()));

  // ── presets ────────────────────────────────────────────────────────────────
  const presetBar = $(".qc-presets");
  let lastGroup = null;
  for (const p of presets) {
    if (p.group !== lastGroup && p.group) presetBar.append(h(`<span class="sep" aria-hidden="true" title="${esc(p.group)}"></span>`));
    lastGroup = p.group;
    presetBar.append(h(`<button role="tab" data-preset="${p.id}" title="${esc(p.blurb)}">${esc(p.label)}</button>`));
  }
  on(presetBar, "click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (b) runPreset(b.dataset.preset);
  });
  on($(".qc-run"), "click", () => run(editor.value, { fromEditor: true }));
  function markPreset(id) {
    for (const b of presetBar.querySelectorAll("button")) b.setAttribute("aria-pressed", b.dataset.preset === id);
    if (id) presetBar.querySelector(`[data-preset="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ── views ──────────────────────────────────────────────────────────────────
  let view = "table";
  function showView(v) {
    view = v;
    for (const [k, el] of Object.entries(views)) el.hidden = k !== v;
    for (const [k, b] of Object.entries(tabs)) b.setAttribute("aria-selected", k === v);
    emitState();
    if (v === "inspect") tabs.inspect.hidden = false;
    if (v === "graph") graph.resize(true);
    if (v === "schema" && !schemaBuilt) buildSchema();
    if (v === "chart") chart.render();
    if (v === "map") map.show();
    if (hash) writeHash();
  }
  on($(".qc-tabs"), "click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) {
      if (b.dataset.view === "inspect" && e.target.classList.contains("x")) {
        tabs.inspect.hidden = true;
        showView("table");
      } else showView(b.dataset.view);
      return;
    }
    const act = e.target.closest("[data-act]");
    if (act) exportResult(act.dataset.act);
  });

  // ── running queries ────────────────────────────────────────────────────────
  const prefixed = (q) => {
    const declared = (p) => new RegExp(`(^|\\n)\\s*PREFIX\\s+${p}:`, "i").test(q);
    const used = usedPrefixes(q);
    const missing = [...PREFIXES.filter(([p]) => !declared(p)), ...[...used].filter((p) => KNOWN_NS.has(p) && !PREFIXES.some(([b]) => b === p) && !declared(p)).map((p) => [p, KNOWN_NS.get(p)])];
    const head = missing.map(([p, ns]) => `PREFIX ${p}: <${ns}>`).join("\n");
    return { text: head ? head + "\n" + q : q, offset: head ? missing.length : 0 };
  };
  function run(text, { fromEditor = false, preset = null, view: wantView, auto: isAuto = false, quiet = false } = {}) {
    if (!fromEditor) setQuery(text);
    clearTimeout(autoTimer);
    currentPreset = preset;
    markPreset(preset);
    const { text: full, offset } = prefixed(text);
    let result, ms;
    try {
      const t = performance.now();
      result = store.query(full, { budgetMs: isAuto ? AUTO_BUDGET_MS : 0 });
      ms = performance.now() - t;
    } catch (e) {
      // Keep what is on screen, dimmed, and say what went wrong. A budgeted run that ran out
      // of time stops autorunning until the next edit.
      resEl.classList.toggle("stale", !!last?.result);
      if (e.interrupted) {
        slowUntilEdit = true;
        status.res.innerHTML = `<span class="hint">slow query — ⌘↵ to run</span>`;
        return null;
      }
      const line = e.line ? Math.max(1, e.line - offset) : 0;
      errLine = line;
      editor.setError(line);
      status.res.innerHTML = `<span class="err" title="${esc(e.message)}">✕ ${line ? `line ${line}: ` : ""}${esc(e.message.replace(/^line \d+:\s*/, ""))}</span>`;
      if (!isAuto) last = { text, result: null, error: e, preset };
      return null;
    }
    errLine = 0;
    editor.setError(0);
    resEl.classList.remove("stale");
    lastRunText = text;
    last = { text, result, ms, preset };
    const count = result.type === "select" ? result.count : result.type === "ask" ? (result.value ? 1 : 0) : result.quads.length;
    status.res.innerHTML = `<b>${fmtN(count)}</b> ${result.type === "select" ? (count === 1 ? "row" : "rows") : result.type === "ask" ? (result.value ? "true" : "false") : "triples"} · <b>${fmtMs(ms)}</b>`;
    renderTable(result);
    graph.setResult(result, preset ? PRESETS.find((p) => p.id === preset)?.label : text);
    chart.setResult(result);
    map.setResult(result);
    highlightAtlas(result);
    if (!quiet) showView(wantView || (view === "inspect" || view === "schema" ? "table" : view));
    emitState();
    return result;
  }
  function runPreset(id, v) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return null;
    const opts = { preset: id, view: v || p.view || (view === "graph" ? "graph" : "table") };
    const x = p.needs && extra[p.needs];
    if (x && x.state === "loading") {
      setQuery(p.query);
      markPreset(id);
      status.res.innerHTML = `<span class="hint">loading ${x.name}…</span>`;
      return x.ready.then(() => (sig.aborted ? null : run(p.query, opts)));
    }
    return run(p.query, opts);
  }
  let lastHighlightKey = "";
  function highlightAtlas(result) {
    const ids = new Set();
    const add = (t) => {
      if (t?.termType === "NamedNode") {
        const id = atlasId(t.value);
        if (id && (bodies.has(t.value) || repoBody.has(t.value))) ids.add(id);
      }
    };
    if (result.type === "select") for (const row of result.rows) row.forEach(add);
    else if (result.quads) for (const q of result.quads) (add(q.subject), add(q.object));
    // Only when the set actually changes: autorun must not make the Atlas flicker.
    const key = [...ids].sort().join(",");
    if (key === lastHighlightKey) return;
    lastHighlightKey = key;
    try {
      onHighlight([...ids]);
    } catch (e) {
      console.warn(e);
    }
  }
  const locate = (iri) => {
    const id = atlasId(iri);
    if (id) {
      try {
        onLocate(id);
      } catch (e) {
        console.warn(e);
      }
    }
  };

  // ── table ──────────────────────────────────────────────────────────────────
  let sort = { col: -1, dir: 1 };
  function cellHtml(t, { wide = false } = {}) {
    if (!t) return `<span class="un">—</span>`;
    if (t.termType === "NamedNode") {
      const body = bodies.has(t.value) || repoBody.has(t.value);
      const id = atlasId(t.value);
      return `<button class="qc-iri${body ? " body" : ""}" data-iri="${esc(t.value)}" title="${esc(t.value)}">${esc(shortIri(t.value))}</button>${id ? `<button class="qc-loc" data-locate="${esc(t.value)}" title="Locate in the Atlas">◎</button>` : ""}`;
    }
    if (t.termType === "BlankNode") return `<span class="bn">_:${esc(t.value)}</span>`;
    if (t.termType === "Quad") return `<span class="bn">&lt;&lt; ${esc(labelOf(t.subject))} ${esc(shortIri(t.predicate.value))} ${esc(labelOf(t.object))} &gt;&gt;</span>`;
    const [v, hint] = literalParts(t);
    return `<span class="str" title="${esc(v)}">${esc(v)}</span>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}`;
  }
  function renderTable(result) {
    const el = views.table;
    sort = { col: -1, dir: 1 };
    if (result.type === "ask") {
      el.innerHTML = `<div class="qc-empty">The answer is <b>${result.value}</b>.</div>`;
      return;
    }
    if (result.type !== "select") {
      // CONSTRUCT / DESCRIBE: a triple table.
      const rows = result.quads.map((q) => [q.subject, q.predicate, q.object]);
      drawTable(["subject", "predicate", "object"], rows, el, `${fmtN(rows.length)} triples · see them as a graph →`);
      return;
    }
    if (!result.count) {
      el.innerHTML = `<div class="qc-empty">No rows. <b>Loosen the pattern</b>, or try a preset.</div>`;
      return;
    }
    drawTable(result.vars, result.rows, el);
  }
  function drawTable(vars, rows, el, foot) {
    const numeric = vars.map((_, c) => rows.some((r) => r[c]) && rows.every((r) => !r[c] || isNumeric(r[c])));
    const wide = vars.map((_, c) => rows.some((r) => r[c]?.termType === "Literal" && r[c].value.length > 34));
    const order = rows.map((_, i) => i);
    if (sort.col >= 0) {
      const c = sort.col;
      const key = (t) => (!t ? null : numeric[c] ? Number(t.value) : t.termType === "Literal" ? t.value : labelOf(t).toLowerCase());
      order.sort((i, j) => {
        const a = key(rows[i][c]), b = key(rows[j][c]);
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return (a < b ? -1 : a > b ? 1 : 0) * sort.dir;
      });
    }
    const MAX = 1500;
    const body = order
      .slice(0, MAX)
      .map((i) => `<tr><td class="row">${i + 1}</td>${rows[i].map((t, c) => `<td class="${numeric[c] ? "num" : ""}${wide[c] ? " wide" : ""}">${cellHtml(t)}</td>`).join("")}</tr>`)
      .join("");
    el.innerHTML = `<table class="qc-table"><thead><tr><th></th>${vars
      .map((v, c) => `<th class="${numeric[c] ? "num" : ""}" data-col="${c}" aria-sort="${sort.col === c ? (sort.dir > 0 ? "ascending" : "descending") : "none"}">?${esc(v)}${sort.col === c ? `<span class="dir">${sort.dir > 0 ? "↑" : "↓"}</span>` : ""}</th>`)
      .join("")}</tr></thead><tbody>${body}</tbody></table>${rows.length > MAX ? `<div class="qc-foot">showing ${MAX} of ${fmtN(rows.length)} rows · download the CSV for all of them</div>` : foot ? `<div class="qc-foot">${foot}</div>` : ""}`;
    el._vars = vars;
    el._rows = rows;
  }
  on(views.table, "click", (e) => {
    const th = e.target.closest("th[data-col]");
    if (th) {
      const c = Number(th.dataset.col);
      sort = { col: c, dir: sort.col === c ? -sort.dir : 1 };
      drawTable(views.table._vars, views.table._rows, views.table);
      return;
    }
    const loc = e.target.closest("[data-locate]");
    if (loc) return locate(loc.dataset.locate);
    const iri = e.target.closest("[data-iri]");
    if (iri) inspect(iri.dataset.iri);
  });

  // ── export ─────────────────────────────────────────────────────────────────
  const csvCell = (t) => {
    if (!t) return "";
    const v = t.termType === "Literal" ? t.value : t.termType === "BlankNode" ? "_:" + t.value : t.value;
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const ttlTerm = (t) => (t.termType === "NamedNode" ? sparqlIri(t.value) : t.termType === "BlankNode" ? "_:" + t.value : literalTtl(t));
  const literalTtl = (t) => {
    const s = `"${t.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    if (t.language) return `${s}@${t.language}`;
    if (!t.datatype || t.datatype === XSD + "string") return s;
    if (/#(integer|decimal|boolean)$/.test(t.datatype)) return t.value;
    return `${s}^^${sparqlIri(t.datatype)}`;
  };
  function exportText() {
    if (!last?.result) return null;
    const r = last.result;
    if (r.type === "select") return { text: [r.vars.join(","), ...r.rows.map((row) => row.map(csvCell).join(","))].join("\n"), ext: "csv", mime: "text/csv" };
    if (r.type === "ask") return { text: String(r.value), ext: "txt", mime: "text/plain" };
    const lines = PREFIXES.map(([p, ns]) => `@prefix ${p}: <${ns}> .`);
    lines.push("");
    for (const q of r.quads) lines.push(`${ttlTerm(q.subject)} ${q.predicate.value === RDF_TYPE ? "a" : ttlTerm(q.predicate)} ${ttlTerm(q.object)} .`);
    return { text: lines.join("\n"), ext: "ttl", mime: "text/turtle" };
  }
  async function exportResult(kind) {
    const out = exportText();
    if (!out) return;
    if (kind === "copy") {
      try {
        await navigator.clipboard.writeText(out.text);
        flash(`copied ${out.ext === "csv" ? "CSV" : out.ext === "ttl" ? "Turtle" : "text"}`);
      } catch {
        flash("clipboard blocked");
      }
      return;
    }
    const blob = new Blob([out.text], { type: out.mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `atlas-${last.preset || "query"}.${out.ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  let flashT = 0;
  function flash(msg) {
    const prev = status.res.innerHTML;
    status.res.innerHTML = `<b>${esc(msg)}</b>`;
    clearTimeout(flashT);
    flashT = setTimeout(() => (status.res.innerHTML = prev), 1400);
  }

  // ── inspector: everything about one resource ──────────────────────────────
  const trail = [];
  function inspect(iri, push = true) {
    if (push && trail.at(-1) !== iri) trail.push(iri);
    const out = store.describe(iri);
    const about = out.filter((q) => q.subject.value === iri && q.subject.termType === "NamedNode");
    const incoming = out.filter((q) => q.object.termType === "NamedNode" && q.object.value === iri);
    const name = names.get(iri) || shortIri(iri);
    const id = atlasId(iri);
    const link = (t) => (t.termType === "NamedNode" ? `<button class="qc-iri${bodies.has(t.value) ? " body" : ""}" data-iri="${esc(t.value)}" title="${esc(t.value)}">${esc(names.get(t.value) ? `${names.get(t.value)}` : shortIri(t.value))}</button>${names.get(t.value) ? `<span class="hint">${esc(shortIri(t.value))}</span>` : ""}` : t.termType === "BlankNode" ? nested(t) : cellHtml(t));
    // Blank nodes (geo, activity) are shown inline as their own small table.
    const nested = (b) => {
      const inner = store.describe === undefined ? [] : out.filter((q) => q.subject.termType === "BlankNode" && q.subject.value === b.value);
      const rows = inner.length ? inner : store.match(b.id, 0, 0, 0).map(([s, p, o]) => ({ subject: s, predicate: p, object: o }));
      return `<span class="nested">[ ${rows.map((q) => `${esc(shortIri(q.predicate.value))} ${q.object.termType === "Literal" ? esc(literalParts(q.object)[0]) : esc(labelOf(q.object))}`).join(" ; ")} ]</span>`;
    };
    const types = about.filter((q) => q.predicate.value === RDF_TYPE).map((q) => shortIri(q.object.value));
    const rows = (qs, side) =>
      qs.length
        ? `<table>${qs
            .filter((q) => q.predicate.value !== RDF_TYPE || side === "in")
            .map((q) => `<tr><td class="p">${esc(shortIri(q.predicate.value))}</td><td>${side === "out" ? link(q.object) : link(q.subject)}</td></tr>`)
            .join("")}</table>`
        : `<div class="qc-foot">none</div>`;
    views.inspect.innerHTML = `<div class="qc-insp">
      <div class="k">${esc(types.join(" · ") || "resource")}</div>
      <h2>${esc(name)}</h2>
      <div class="iri">${esc(iri)}</div>
      <div class="acts">
        ${trail.length > 1 ? `<button data-back>← back</button>` : ""}
        ${id ? `<button data-locate="${esc(iri)}">◎ locate in Atlas</button>` : ""}
        <button data-graph="${esc(iri)}">⌬ graph around it</button>
        <button data-describe="${esc(iri)}">DESCRIBE it</button>
        ${(() => { const u = !iri.startsWith(BASE) && /^https?:/.test(iri) ? iri : about.find((q) => /^https:\/\/schema\.org\/(url|codeRepository)$/.test(q.predicate.value) && q.object.termType === "NamedNode")?.object.value; return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">open ↗</a>` : ""; })()}
      </div>
      <h3>about it · ${about.length}</h3>${rows(about, "out")}
      <h3>pointing at it · ${incoming.length}</h3>${rows(incoming, "in")}
    </div>`;
    tabs.inspect.innerHTML = `${esc(name.length > 22 ? name.slice(0, 21) + "…" : name)}<span class="x" title="Close">×</span>`;
    showView("inspect");
    views.inspect.scrollTop = 0;
  }
  on(views.inspect, "click", (e) => {
    const t = e.target;
    if (t.closest("[data-back]")) {
      trail.pop();
      return inspect(trail.at(-1), false);
    }
    const loc = t.closest("[data-locate]");
    if (loc) return locate(loc.dataset.locate);
    const g = t.closest("[data-graph]");
    if (g) {
      graph.setResult({ type: "describe", quads: store.describe(g.dataset.graph) }, null, g.dataset.graph);
      return showView("graph");
    }
    const d = t.closest("[data-describe]");
    if (d) return run(`DESCRIBE ${sparqlIri(d.dataset.describe)}`, { view: "table" });
    const iri = t.closest("[data-iri]");
    if (iri) inspect(iri.dataset.iri);
  });

  // ── vocabulary: classes and properties with counts ─────────────────────────
  let schemaBuilt = false;
  function buildSchema() {
    schemaBuilt = true;
    const classes = store.query(`SELECT ?c (COUNT(?s) AS ?n) WHERE { ?s a ?c } GROUP BY ?c ORDER BY DESC(?n)`).rows;
    const props = store.query(`SELECT ?p (COUNT(*) AS ?n) WHERE { ?s ?p ?o } GROUP BY ?p ORDER BY DESC(?n)`).rows;
    const max = Math.max(...props.map(([, n]) => Number(n.value)), 1);
    const li = (t, n, cls) => `<li><button class="${cls}" data-${cls === "cls" ? "class" : "prop"}="${esc(t.value)}" title="${esc(t.value)}">${esc(shortIri(t.value))}</button><span class="n">${fmtN(Number(n.value))}</span><span class="bar" style="width:${Math.max(2, (100 * Math.log1p(Number(n.value))) / Math.log1p(max)).toFixed(1)}%"></span></li>`;
    views.schema.innerHTML = `<div class="qc-schema">
      <p>The vocabulary as the data uses it: click a class to list its things, a property to see what it connects. Base <span class="mono">${esc(BASE)}</span>, terms in <span class="mono">yr:</span> and <span class="mono">schema:</span>.</p>
      <div><h3>classes · ${classes.length}</h3><ul>${classes.map(([c, n]) => li(c, n, "cls")).join("")}</ul></div>
      <div><h3>properties · ${props.length}</h3><ul>${props.map(([p, n]) => li(p, n, "prp")).join("")}</ul></div>
    </div>`;
  }
  on(views.schema, "click", (e) => {
    const c = e.target.closest("[data-class]");
    if (c) return run(`SELECT ?thing ?name WHERE {\n  ?thing a ${sparqlIri(c.dataset.class)} .\n  OPTIONAL { ?thing schema:name ?name }\n}\nORDER BY ?name`, { view: "table" });
    const p = e.target.closest("[data-prop]");
    if (p) return run(`SELECT ?subject ?object WHERE {\n  ?subject ${sparqlIri(p.dataset.prop)} ?object .\n}\nLIMIT 200`, { view: "table" });
  });

  // ── graph view ─────────────────────────────────────────────────────────────
  const graph = makeGraph({
    root: views.graph.querySelector(".qc-g"),
    on,
    store,
    labelOf,
    bodies,
    authored,
    atlasId,
    locate,
    inspect,
    shortIri,
    onNavigate: () => hash && writeHash(),
  });

  // ── chart view: a SELECT result as bars ──────────────────────────────────────
  // The x axis is a year/hour/month column when there is one (ordered, gaps filled), else the first
  // non-numeric column (horizontal bars, largest first). A second non-numeric column stacks the bars
  // as series (eight hues in fixed order by name, the rest folded into "other"). Every numeric column
  // is a measure; chips pick which one. Colours: categorical palette validated for both themes.
  const chart = (() => {
    const el = views.chart;
    let res = null, measure = null;
    const ORDINAL = /^(year|hour|month|day|week|weekday|dow)$/i;
    function analyse() {
      if (!res || res.type !== "select" || !res.count) return null;
      const { vars, rows } = res;
      const numeric = vars.map((_, c) => rows.some((r) => r[c]) && rows.every((r) => !r[c] || isNumeric(r[c])));
      const cats = vars.map((_, c) => c).filter((c) => !numeric[c]);
      let x = vars.findIndex((v, c) => numeric[c] && ORDINAL.test(v));
      if (x < 0) x = cats.length ? cats[0] : -1;
      if (x < 0) return null;
      const measures = vars.map((_, c) => c).filter((c) => numeric[c] && c !== x);
      if (!measures.length) return null;
      const dated = rows.every((r) => !r[x] || /#(date|dateTime|gYear)$/.test(r[x].datatype || ""));
      return { vars, rows, x, ordered: numeric[x] || dated, intX: numeric[x], series: cats.find((c) => c !== x) ?? -1, measures };
    }
    function setResult(r) {
      res = r;
      measure = null;
      if (view === "chart") render();
    }
    const nice = (max) => {
      if (!(max > 0)) return [0, 1];
      const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
      return [step, Math.ceil(max / step) * step];
    };
    const fmtV = (v) => (Math.abs(v) >= 100 ? fmtN(Math.round(v)) : String(Math.round(v * 10) / 10));
    function render() {
      const a = analyse();
      if (!a) {
        el.innerHTML = `<div class="qc-empty">${res && res.type === "select" ? "Nothing to chart: <b>a chart needs a numeric column</b> and something to put along the axis." : "Charts draw <b>SELECT</b> results. Try <b>Distance per year</b> or <b>PRs per year</b>."}</div>`;
        return;
      }
      const m = a.measures.includes(measure) ? measure : a.measures[0];
      const key = (t) => (t ? (t.termType === "Literal" ? t.value : t.value) : "");
      // series, in a fixed order by name; more than eight fold into "other"
      let names = a.series >= 0 ? [...new Set(a.rows.map((r) => labelOf(r[a.series]) || "—"))] : [""];
      names.sort((p, q) => p.localeCompare(q));
      let other = false;
      if (names.length > 8) {
        const tot = new Map();
        for (const r of a.rows) { const n = labelOf(r[a.series]) || "—"; tot.set(n, (tot.get(n) || 0) + (Number(r[m]?.value) || 0)); }
        const keep = new Set([...tot].sort((p, q) => q[1] - p[1]).slice(0, 7).map(([n]) => n));
        names = names.filter((n) => keep.has(n));
        other = true;
      }
      const sIdx = (r) => { if (a.series < 0) return 0; const n = labelOf(r[a.series]) || "—"; const i = names.indexOf(n); return i >= 0 ? i : names.length; };
      const nS = names.length + (other ? 1 : 0);
      // groups along x
      const groups = new Map();
      for (const r of a.rows) {
        const k = key(r[a.x]);
        if (!groups.has(k)) groups.set(k, { k, label: labelOf(r[a.x]), cell: r[a.x], v: new Array(nS).fill(0) });
        groups.get(k).v[sIdx(r)] += Number(r[m]?.value) || 0;
      }
      let gs = [...groups.values()];
      if (a.ordered) {
        gs.sort((p, q) => (a.intX ? Number(p.k) - Number(q.k) : p.k < q.k ? -1 : p.k > q.k ? 1 : 0));
        if (a.intX && gs.length > 1) { // fill integer gaps so the axis is honest
          const lo = Number(gs[0].k), hi = Number(gs[gs.length - 1].k);
          if (Number.isInteger(lo) && Number.isInteger(hi) && hi - lo < 400) {
            const by = new Map(gs.map((g) => [Number(g.k), g]));
            gs = [];
            for (let i = lo; i <= hi; i++) gs.push(by.get(i) || { k: String(i), label: String(i), v: new Array(nS).fill(0) });
          }
        }
      } else gs.sort((p, q) => q.v.reduce((s, x) => s + x, 0) - p.v.reduce((s, x) => s + x, 0));
      const tooMany = !a.ordered && gs.length > 30;
      if (tooMany) gs = gs.slice(0, 30);
      const total = (g) => g.v.reduce((s, x) => s + x, 0);
      const color = (i) => (i >= names.length ? "var(--qc-other)" : `var(--qc-s${i + 1})`);
      const chips = a.measures.length > 1 ? `<span class="qc-ch-ms">${a.measures.map((c) => `<button data-m="${c}" aria-pressed="${c === m}">?${esc(a.vars[c])}</button>`).join("")}</span>` : `<span class="qc-ch-m">?${esc(a.vars[m])}</span>`;
      const legend = nS > 1 ? `<span class="qc-ch-lg">${[...names, ...(other ? ["other"] : [])].map((n, i) => `<span><i style="background:${color(i)}"></i>${esc(n)}</span>`).join("")}</span>` : "";
      el.innerHTML = `<div class="qc-ch-h">${chips}${legend}</div>`; // measured first: the legend may wrap
      const W = Math.max(280, el.clientWidth), H = Math.max(200, el.clientHeight - el.firstElementChild.offsetHeight - 2);
      const max = Math.max(0, ...gs.map(total));
      const [step, top] = nice(max);
      let svg = "";
      if (a.ordered) {
        const L = 46, R = 12, T = 12, B = 26, pw = W - L - R, ph = H - T - B;
        const band = pw / gs.length, bw = Math.max(1, Math.min(48, band * 0.72));
        const y = (v) => T + ph - (v / top) * ph;
        for (let v = 0; v <= top + 1e-9; v += step) svg += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${fmtV(v)}</text>`;
        const every = Math.max(1, Math.ceil(gs.length / Math.max(1, Math.floor(pw / 44))));
        gs.forEach((g, i) => {
          const cx = L + band * (i + 0.5);
          let acc = 0;
          const segs = g.v.map((v, s) => [v, s]).filter(([v]) => v > 0);
          segs.forEach(([v, s], j) => {
            const y0 = y(acc), y1 = y(acc + v), h = Math.max(0, y0 - y1 - (j ? 2 : 0));
            const x0 = cx - bw / 2, r = j === segs.length - 1 ? Math.min(4, bw / 2, h) : 0;
            svg += r ? `<path fill="${color(s)}" d="M${x0},${y0 - (j ? 2 : 0)}V${y1 + r}q0,-${r} ${r},-${r}H${x0 + bw - r}q${r},0 ${r},${r}V${y0 - (j ? 2 : 0)}Z"/>` : `<rect fill="${color(s)}" x="${x0}" y="${y1}" width="${bw}" height="${h}"/>`;
            acc += v;
          });
          if (i % every === 0) svg += `<text class="ax" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(String(g.label).slice(0, 10))}</text>`;
          svg += `<rect class="hit" data-i="${i}" x="${cx - band / 2}" y="${T}" width="${band}" height="${ph}"/>`;
        });
        svg += `<line class="base" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
      } else {
        const rowH = 20, lab = Math.min(200, Math.max(80, W * 0.32)), L = lab + 10, R = 56, pw = W - L - R;
        const x = (v) => L + (v / top) * pw;
        const Hh = gs.length * rowH + 10;
        gs.forEach((g, i) => {
          const cy = 6 + i * rowH, bh = 12;
          let acc = 0;
          const segs = g.v.map((v, s) => [v, s]).filter(([v]) => v > 0);
          segs.forEach(([v, s], j) => {
            const x0 = x(acc) + (j ? 2 : 0), x1 = x(acc + v), w = Math.max(0, x1 - x0), r = j === segs.length - 1 ? Math.min(4, bh / 2, w) : 0;
            svg += r ? `<path fill="${color(s)}" d="M${x0},${cy}H${x1 - r}q${r},0 ${r},${r}V${cy + bh - r}q0,${r} -${r},${r}H${x0}Z"/>` : `<rect fill="${color(s)}" x="${x0}" y="${cy}" width="${w}" height="${bh}"/>`;
            acc += v;
          });
          svg += `<text class="lb" x="${lab}" y="${cy + 10}" text-anchor="end">${esc(String(g.label).slice(0, 30))}</text><text class="ax" x="${x(total(g)) + 6}" y="${cy + 10}">${fmtV(total(g))}</text><rect class="hit" data-i="${i}" x="0" y="${cy - 4}" width="${W}" height="${rowH}"/>`;
        });
        svg = `<line class="base" x1="${L}" x2="${L}" y1="0" y2="${Hh}"/>` + svg;
        el.innerHTML = `<div class="qc-ch-h">${chips}${legend}</div><svg class="qc-ch" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}">${svg}</svg>${tooMany ? `<div class="qc-foot">the 30 largest of ${fmtN(groups.size)} · the table has them all</div>` : ""}<div class="qc-gtip" hidden></div>`;
        el._gs = gs; el._names = [...names, ...(other ? ["other"] : [])]; el._m = a.vars[m];
        return;
      }
      el.innerHTML = `<div class="qc-ch-h">${chips}${legend}</div><svg class="qc-ch" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg><div class="qc-gtip" hidden></div>`;
      el._gs = gs; el._names = [...names, ...(other ? ["other"] : [])]; el._m = a.vars[m];
    }
    on(el, "click", (e) => {
      const b = e.target.closest("[data-m]");
      if (b) { measure = Number(b.dataset.m); render(); }
    });
    on(el, "pointermove", (e) => {
      const tip = el.querySelector(".qc-gtip");
      const hit = e.target.closest?.(".hit");
      el.querySelectorAll(".hit.on").forEach((h) => h !== hit && h.classList.remove("on"));
      if (!tip) return;
      if (!hit) { tip.hidden = true; return; }
      hit.classList.add("on");
      const g = el._gs[Number(hit.dataset.i)];
      const parts = g.v.map((v, s) => [v, s]).filter(([v]) => v > 0);
      tip.innerHTML = `<b>${esc(g.label)}</b>${parts.length > 1 || el._names.length > 1 ? parts.map(([v, s]) => `${esc(el._names[s] || "")} ${fmtV(v)}`).join("<br>") + "<br>" : ""}?${esc(el._m)} <span style="color:var(--qbone)">${fmtV(g.v.reduce((s, x) => s + x, 0))}</span>`;
      tip.hidden = false;
      const box = el.getBoundingClientRect();
      const tx = Math.min(e.clientX - box.left + 14, box.width - tip.offsetWidth - 6);
      tip.style.left = Math.max(6, tx) + "px";
      tip.style.top = e.clientY - box.top + el.scrollTop + 14 + "px";
    });
    on(el, "pointerleave", () => { const tip = el.querySelector(".qc-gtip"); if (tip) tip.hidden = true; });
    return { setResult, render };
  })();

  // ── map view: routes and places from a result ────────────────────────────────
  // Activities in the result (…/atlas/strava/<day>-<n>) draw their privacy-trimmed routes from
  // strava-tracks.json (loaded the first time the map opens); every other route stays as a faint
  // trace for context. Places with schema:geo draw as dots, over OpenStreetMap tiles styled for the
// theme (see `tiles`); the tile server sees which area a visitor looks at, nothing else.
  const map = (() => {
    const box = views.map.querySelector(".qc-g");
    const cv = box.querySelector("canvas"), tip = box.querySelector(".qc-gtip"), note = box.querySelector(".qc-gnote"), clu = box.querySelector(".qc-mclu");
    const cx = cv.getContext("2d");
    const STRAVA = BASE + "strava/";
    box.querySelector(".qc-mattr").innerHTML = tiles?.attribution || "";
    // raster tiles, cached per URL; a tile that is still loading shows its loaded parent, scaled up
    const tileCache = new Map();
    const tileUrl = (z, x, y) => tiles.url.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    function tile(z, x, y) {
      if (!tiles) return null;
      const url = tileUrl(z, x, y);
      let t = tileCache.get(url);
      if (!t) {
        t = new Image();
        t.onload = () => draw();
        t.src = url;
        tileCache.set(url, t);
        if (tileCache.size > 600) tileCache.delete(tileCache.keys().next().value);
      }
      return t.complete && t.naturalWidth ? t : null;
    }
    function drawTiles() {
      if (!tiles) return;
      const z = Math.max(0, Math.min(tiles.maxZoom ?? 19, Math.round(Math.log2((V.s * Math.min(2, dpr)) / 256)))), n = 2 ** z, size = V.s / n;
      const x0 = Math.floor((-V.ox / V.s) * n), x1 = Math.floor(((W - V.ox) / V.s) * n);
      const y0 = Math.max(0, Math.floor((-V.oy / V.s) * n)), y1 = Math.min(n - 1, Math.floor(((H - V.oy) / V.s) * n));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 160) return;
      cx.filter = (document.documentElement.dataset.theme === "paper" ? tiles.paper : tiles.dark) || "none";
      for (let ty = y0; ty <= y1; ty++)
        for (let tx = x0; tx <= x1; tx++) {
          const wx = ((tx % n) + n) % n, X = V.ox + tx * size, Y = V.oy + ty * size;
          const img = tile(z, wx, ty);
          if (img) { cx.drawImage(img, X, Y, size + 0.5, size + 0.5); continue; }
          for (let up = 1; up <= 4 && z - up >= 0; up++) { // fall back to a loaded ancestor
            const k = 2 ** up, p = tileCache.get(tileUrl(z - up, wx >> up, ty >> up));
            if (p?.complete && p.naturalWidth) { const sw = p.naturalWidth / k; cx.drawImage(p, (wx % k) * sw, (ty % k) * sw, sw, sw, X, Y, size + 0.5, size + 0.5); break; }
          }
        }
      cx.filter = "none";
    }
    let tracks = null, loading = null, places = null;
    let hi = new Set(), hiPlaces = new Set(), needFit = true;
    let V = { s: 1, ox: 0, oy: 0 }, W = 0, H = 0, dpr = 1, pal = {}, raf = 0;
    const mx = (lon) => (lon + 180) / 360;
    const my = (lat) => { const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
    const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
    function decode(str) {
      const out = [];
      let i = 0, la = 0, lo = 0;
      const next = () => { let r = 0, s = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20); return r & 1 ? ~(r >> 1) : r >> 1; };
      while (i < str.length) { la += next(); lo += next(); out.push(mx(lo / 1e5), my(la / 1e5)); }
      return Float64Array.from(out);
    }
    function load() {
      if (!places) {
        places = new Map();
        try {
          const r = store.query(prefixed(`SELECT ?p ?name ?lat ?lon WHERE { ?p schema:geo ?g . ?g schema:latitude ?lat ; schema:longitude ?lon . OPTIONAL { ?p schema:name ?name } }`).text);
          for (const row of r.rows) places.set(row[0].value, { name: row[1]?.value || shortIri(row[0].value), x: mx(Number(row[3].value)), y: my(Number(row[2].value)) });
        } catch (e) { console.warn("query console: places for the map:", e); }
      }
      if (!tracksUrl) return Promise.resolve();
      return (loading ??= fetch(tracksUrl)
        .then((r) => (r.ok ? r.json() : { tracks: [] }))
        .then((j) => { tracks = new Map((j.tracks || []).map(([id, ...segs]) => [STRAVA + id, segs.map(decode)])); })
        .catch((e) => { console.warn("query console: routes not loaded:", e); tracks = new Map(); }));
    }
    function setResult(r) {
      const iris = new Set();
      if (r.type === "select") for (const row of r.rows) for (const t of row) t?.termType === "NamedNode" && iris.add(t.value);
      else if (r.type !== "ask") for (const q of r.quads) for (const t of [q.subject, q.object]) t.termType === "NamedNode" && iris.add(t.value);
      hi = new Set([...iris].filter((i) => i.startsWith(STRAVA)));
      hiPlaces = new Set([...iris].filter((i) => !i.startsWith(STRAVA)));
      needFit = true;
      region = 0;
      if (view === "map") show();
    }
    function readPal() {
      const cs = getComputedStyle(element);
      const v = (n, f) => cs.getPropertyValue(n).trim() || f;
      pal = { faint: v("--qbone4", "#514d47"), mid: v("--qbone3", "#7f7a71"), text: v("--qbone2", "#b7b1a6"), hot: v("--qsig", "#ff6a3d"), panel: v("--qpanel", "#121518") };
    }
    function resize() {
      const r = box.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height;
      cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr);
      draw();
    }
    // Routes far apart (Bangkok, Comox, the Bay Area) would fit as a whole globe: they are grouped into
    // regions (starts within ~150 km), named after the nearest Atlas place; chips switch between them.
    let regions = [], region = 0;
    function regionsOf(list) {
      const out = [];
      for (const [id, segs] of list) {
        const x = segs[0][0], y = segs[0][1];
        const r = out.find((c) => Math.abs(c.x - x) < c.tol && Math.abs(c.y - y) < c.tol);
        if (r) r.items.push(segs);
        else out.push({ x, y, tol: 150e3 / (40075016.686 * Math.cos((latOf(y) * Math.PI) / 180)), items: [segs] });
      }
      for (const r of out) {
        let best = null, bd = Infinity;
        for (const p of places.values()) { const d = Math.hypot(p.x - r.x, p.y - r.y); if (d < bd) { bd = d; best = p; } }
        const la = latOf(r.y), lo = r.x * 360 - 180;
        r.name = best && bd < (r.tol * 40) / 150 ? best.name.split(",")[0] : `${Math.abs(la).toFixed(1)}°${la < 0 ? "S" : "N"} ${Math.abs(lo).toFixed(1)}°${lo < 0 ? "W" : "E"}`;
      }
      // regions named after the same place are one region
      const byName = new Map();
      for (const r of out.sort((a, b) => b.items.length - a.items.length)) {
        const m = byName.get(r.name);
        if (m) m.items.push(...r.items);
        else byName.set(r.name, r);
      }
      return [...byName.values()].sort((a, b) => b.items.length - a.items.length);
    }
    function fitTo(segsList, pts) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
      for (const segs of segsList) for (const s of segs) for (let k = 0; k < s.length; k += 2) add(s[k], s[k + 1]);
      for (const p of pts) add(p.x, p.y);
      if (!isFinite(x0)) { V = { s: W, ox: 0, oy: (H - W) / 2 }; return; }
      const min = 3e-5; // about 2 km: one short route does not fill the screen
      const w = Math.max(min, x1 - x0), h = Math.max(min, y1 - y0), top = regions.length > 1 ? 30 : 0;
      const sc = Math.min((W - 48) / w, (H - 48 - top) / h);
      V = { s: sc, ox: W / 2 - ((x0 + x1) / 2) * sc, oy: (H + top) / 2 - ((y0 + y1) / 2) * sc };
    }
    function fit() {
      const lit = [...hi].filter((i) => tracks?.has(i)).map((i) => [i, tracks.get(i)]);
      const hp = [...hiPlaces].map((i) => places.get(i)).filter(Boolean);
      regions = lit.length ? regionsOf(lit) : hp.length ? [] : regionsOf([...(tracks || [])]);
      region = Math.min(region, Math.max(0, regions.length - 1));
      clu.hidden = regions.length < 2;
      chips();
      if (regions.length) fitTo(regions[region].items, []);
      else fitTo([], hp.length ? hp : [...places.values()]);
    }
    // the six busiest regions get a chip; "more" steps through the rest, one region per click
    const TOP = 6;
    function chips() {
      if (regions.length < 2) { clu.innerHTML = ""; return; }
      const rest = regions.length - TOP, past = region >= TOP;
      clu.innerHTML = regions.slice(0, TOP).map((r, i) => `<button data-r="${i}" aria-pressed="${i === region}">${esc(r.name)} · ${fmtN(r.items.length)}</button>`).join("") +
        (rest > 0 ? `<button data-r="more" aria-pressed="${past}" title="${fmtN(rest)} more regions">${past ? `${esc(regions[region].name)} · ${fmtN(regions[region].items.length)} · ${region - TOP + 1}/${rest} →` : `+${fmtN(rest)} more →`}</button>` : "");
    }
    on(clu, "click", (e) => {
      const b = e.target.closest("[data-r]");
      if (!b) return;
      region = b.dataset.r === "more" ? (region >= TOP && region < regions.length - 1 ? region + 1 : TOP) : Number(b.dataset.r);
      chips();
      fitTo(regions[region].items, []);
      draw();
    });
    async function show() {
      readPal();
      await load();
      if (sig.aborted) return;
      const r = box.getBoundingClientRect();
      if (r.width !== W || r.height !== H) { W = r.width; H = r.height; cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr); }
      if (needFit) { fit(); needFit = false; }
      const n = [...hi].filter((i) => tracks?.has(i)).length;
      note.textContent = !tracksUrl ? "places from the Atlas" : n ? `${fmtN(n)} route${n === 1 ? "" : "s"} from the result · each loses its first and last kilometre` : hi.size ? "these activities have no route (indoor, or trimmed away)" : `${fmtN(tracks?.size || 0)} routes, faint · query activities to light them up`;
      draw();
    }
    function line(segs) {
      for (const s of segs) {
        cx.moveTo(s[0] * V.s + V.ox, s[1] * V.s + V.oy);
        for (let k = 2; k < s.length; k += 2) cx.lineTo(s[k] * V.s + V.ox, s[k + 1] * V.s + V.oy);
      }
    }
    function draw() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        cx.setTransform(dpr, 0, 0, dpr, 0, 0);
        cx.clearRect(0, 0, W, H);
        drawTiles();
        cx.lineJoin = cx.lineCap = "round";
        if (tracks?.size) {
          cx.globalAlpha = hi.size ? 0.35 : 0.6;
          cx.strokeStyle = pal.faint; cx.lineWidth = 1;
          cx.beginPath();
          for (const [id, segs] of tracks) if (!hi.has(id)) line(segs);
          cx.stroke();
          const lit = [...hi].map((i) => tracks.get(i)).filter(Boolean);
          if (lit.length) {
            cx.globalAlpha = lit.length > 200 ? 0.5 : 0.9;
            cx.strokeStyle = pal.hot; cx.lineWidth = lit.length > 50 ? 1.5 : 2;
            cx.beginPath();
            for (const segs of lit) line(segs);
            cx.stroke();
          }
        }
        cx.globalAlpha = 1;
        cx.font = "italic 13px " + (getComputedStyle(element).getPropertyValue("--qserif").trim() || "serif");
        const taken = [];
        const free = (x, y, w) => !taken.some((t) => x < t[0] + t[2] && x + w > t[0] && Math.abs(y - t[1]) < 14) && taken.push([x, y, w]);
        for (const [iri, p] of [...places].sort((a, b) => hiPlaces.has(b[0]) - hiPlaces.has(a[0]))) {
          const on = hiPlaces.has(iri), X = p.x * V.s + V.ox, Y = p.y * V.s + V.oy;
          if (X < -40 || Y < -20 || X > W + 40 || Y > H + 20) continue;
          cx.beginPath(); cx.arc(X, Y, on ? 5 : 3.5, 0, Math.PI * 2);
          cx.fillStyle = on ? pal.hot : pal.mid; cx.fill();
          cx.lineWidth = 2; cx.strokeStyle = pal.panel; cx.stroke();
          cx.fillStyle = on ? pal.text : pal.mid;
          if (free(X + 8, Y, cx.measureText(p.name).width)) cx.fillText(p.name, X + 8, Y + 4);
        }
        // scale bar: a round distance about 90 px long at the centre latitude
        const lat = latOf((H / 2 - V.oy) / V.s), mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / V.s;
        const raw = mPerPx * 90, mag = 10 ** Math.floor(Math.log10(raw)), len = [1, 2, 5, 10].map((k) => k * mag).filter((d) => d <= raw).pop() || mag;
        const px = len / mPerPx, x0 = W - 44 - px, y0 = H - 12;
        cx.strokeStyle = pal.mid; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(x0, y0 - 4); cx.lineTo(x0, y0); cx.lineTo(x0 + px, y0); cx.lineTo(x0 + px, y0 - 4); cx.stroke();
        cx.fillStyle = pal.mid; cx.font = "10px " + (getComputedStyle(element).getPropertyValue("--qmono").trim() || "monospace"); cx.textAlign = "center";
        cx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, x0 + px / 2, y0 - 6); cx.textAlign = "start";
      });
    }
    const zoomAt = (k, X, Y) => { const s = Math.max(50, Math.min(V.s * k, 2 ** 26)); k = s / V.s; V = { s, ox: X - (X - V.ox) * k, oy: Y - (Y - V.oy) * k }; draw(); };
    const ptrs = new Map();
    let pinch = null;
    const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const placeAt = (X, Y) => { for (const [iri, p] of places || []) if (Math.hypot(p.x * V.s + V.ox - X, p.y * V.s + V.oy - Y) < 9) return [iri, p]; return null; };
    on(cv, "pointerdown", (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, local(e)); cv.classList.add("drag"); pinch = null; ptrs.moved = false; });
    on(cv, "pointermove", (e) => {
      const [X, Y] = local(e);
      if (!ptrs.has(e.pointerId)) {
        const hit = placeAt(X, Y);
        cv.classList.toggle("pt", !!hit);
        tip.hidden = !hit;
        if (hit) { tip.innerHTML = `<b>${esc(hit[1].name)}</b>click to inspect`; tip.style.left = X + 12 + "px"; tip.style.top = Y + 12 + "px"; }
        return;
      }
      const prev = ptrs.get(e.pointerId);
      ptrs.set(e.pointerId, [X, Y]);
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (pinch) { V.ox += c[0] - pinch.c[0]; V.oy += c[1] - pinch.c[1]; zoomAt(d / pinch.d, c[0], c[1]); }
        pinch = { d, c };
        ptrs.moved = true;
        return;
      }
      if (ptrs.size === 1) { V.ox += X - prev[0]; V.oy += Y - prev[1]; if (Math.abs(X - prev[0]) + Math.abs(Y - prev[1]) > 1) ptrs.moved = true; draw(); }
    });
    const up = (e) => {
      const moved = ptrs.moved;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (!ptrs.size) cv.classList.remove("drag");
      if (e.type === "pointerup" && !moved) { const hit = placeAt(...local(e)); if (hit) inspect(hit[0]); }
    };
    on(cv, "pointerup", up);
    on(cv, "pointercancel", up);
    on(cv, "pointerleave", () => (tip.hidden = true));
    on(cv, "wheel", (e) => { e.preventDefault(); const [X, Y] = local(e); zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), X, Y); }, { passive: false });
    on(cv, "dblclick", (e) => { const [X, Y] = local(e); zoomAt(2, X, Y); });
    on(box.querySelector(".qc-gctl"), "click", (e) => {
      const b = e.target.closest("[data-g]");
      if (!b) return;
      if (b.dataset.g === "fit") { fit(); draw(); } else zoomAt(b.dataset.g === "in" ? 1.6 : 1 / 1.6, W / 2, H / 2);
    });
    on(window, "yr-theme", () => { readPal(); draw(); });
    return { setResult, show, resize };
  })();

  // ── state for a host's URL: {q: preset id} when the editor holds a preset unchanged, else {sparql: text} ──
  const onState = options.onState || null;
  let stateTimer = 0;
  function emitState() {
    if (!onState || !last || last.error) return;
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      const p = PRESETS.find((x) => x.id === currentPreset);
      const same = p && p.query.trim() === last.text.trim();
      onState({ q: same ? p.id : null, sparql: same ? null : last.text, view: view === "table" || view === "inspect" ? null : view });
    }, 250);
  }
  const VIEWS = ["table", "graph", "chart", "map", "schema"];
  function applyState(st) {
    if (!st) return false;
    const v = VIEWS.includes(st.view) ? st.view : undefined;
    if (st.sparql) { run(st.sparql, { view: v === "schema" ? "table" : v }); if (v === "schema") showView(v); return true; }
    if (st.q && PRESETS.some((x) => x.id === st.q)) { runPreset(st.q, v === "schema" ? undefined : v); if (v === "schema") showView(v); return true; }
    return false;
  }

  // ── hash state (harness / deep links): #q=<preset>&view=graph&node=<iri> ──
  function writeHash() {
    const p = new URLSearchParams();
    if (currentPreset) p.set("q", currentPreset);
    if (view !== "table") p.set("view", view);
    if (view === "graph" && graph.focus()) p.set("node", graph.focus());
    const s = p.toString().replace(/%3A/g, ":").replace(/%2F/g, "/");
    if (location.hash.slice(1) !== s) history.replaceState(null, "", s ? "#" + s : location.pathname + location.search);
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const q = p.get("q"), v = p.get("view"), node = p.get("node"), raw = p.get("sparql");
    if (raw) run(raw, { view: ["graph", "chart", "map"].includes(v) ? v : "table" });
    else if (q && PRESETS.some((x) => x.id === q)) runPreset(q, ["graph", "table", "chart", "map"].includes(v) ? v : undefined);
    else if (!last) runPreset(PRESETS[0].id, v === "graph" ? "graph" : undefined);
    if (node) {
      const iri = node.startsWith("http") ? node : BASE + node;
      if (v === "inspect") inspect(iri);
      else {
        graph.expand(iri, { focus: true });
        showView("graph");
      }
    } else if (v === "schema" || v === "inspect") showView(v === "inspect" ? "table" : v);
  }
  if (hash) {
    readHash();
    on(window, "hashchange", readHash);
  } else if (!applyState(options.initial)) runPreset(PRESETS[0].id);

  // ── size changes ───────────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    editor.layout();
    if (view === "graph") graph.resize();
    if (view === "chart") chart.render();
    if (view === "map") map.resize();
  });
  ro.observe(element);

  return {
    store,
    presets: PRESETS,
    /** Run a query, or a preset by id. Resolves to the result (or null on error). */
    async run(q, opts = {}) {
      const p = PRESETS.find((x) => x.id === q?.trim());
      return p ? runPreset(p.id, opts.view) : run(q, { view: opts.view });
    },
    editor,
    graph,
    contributions: contribReady,
    strava: extra.strava.ready,
    /** Show {q, sparql, view} (as passed to onState): a preset, or a query text, in a view. */
    setState: applyState,
    get termIndex() {
      return termIndex;
    },
    inspect,
    showView,
    dispose() {
      ac.abort();
      clearTimeout(autoTimer);
      ro.disconnect();
      editor.destroy();
      graph.dispose();
      store.dispose();
      element.classList.remove("qc");
      element.innerHTML = "";
    },
  };
}

// ── completion: a term index over the store, and a context-aware source ───────
/** Index every class, property, individual and datatype in the store, with counts. */
function buildTermIndex(store, names) {
  const q = (text) => store.query(text).rows;
  const terms = new Map(); // iri → { iri, type, count, cls, label }
  const put = (iri, type, count) => {
    const prev = terms.get(iri);
    const rank = { class: 3, property: 2, datatype: 1, individual: 0 };
    if (prev && rank[prev.type] >= rank[type]) {
      prev.count = Math.max(prev.count, count);
      return prev;
    }
    const t = { iri, type, count, cls: prev?.cls ?? null, label: names.get(iri) ?? null };
    terms.set(iri, t);
    return t;
  };
  for (const [s, n] of q(`SELECT ?s (COUNT(*) AS ?n) WHERE { ?s ?p ?o FILTER(isIRI(?s)) } GROUP BY ?s`)) put(s.value, "individual", Number(n.value));
  for (const [p, n] of q(`SELECT ?p (COUNT(*) AS ?n) WHERE { ?s ?p ?o } GROUP BY ?p`)) put(p.value, "property", Number(n.value));
  for (const [c, n] of q(`SELECT ?c (COUNT(*) AS ?n) WHERE { ?s a ?c } GROUP BY ?c`)) put(c.value, "class", Number(n.value));
  for (const [dt, n] of q(`SELECT ?dt (COUNT(*) AS ?n) WHERE { ?s ?p ?o FILTER(isLiteral(?o)) BIND(DATATYPE(?o) AS ?dt) } GROUP BY ?dt`)) if (dt) put(dt.value, "datatype", Number(n.value));
  // An individual's class (a yr: one when it has several), for the detail text and for predicate ranking.
  for (const [s, c] of q(`SELECT ?s ?c WHERE { ?s a ?c }`)) {
    const t = terms.get(s.value);
    if (t && (!t.cls || c.value.startsWith(NS))) t.cls = c.value;
  }
  const classProps = new Map(); // class iri → Map(property iri → count)
  for (const [c, p, n] of q(`SELECT ?c ?p (COUNT(*) AS ?n) WHERE { ?s a ?c ; ?p ?o } GROUP BY ?c ?p`)) {
    if (!classProps.has(c.value)) classProps.set(c.value, new Map());
    classProps.get(c.value).set(p.value, Number(n.value));
  }
  // Group by the longest known namespace.
  const namespaces = [...KNOWN_NS.values()].sort((a, b) => b.length - a.length);
  const byNs = new Map();
  for (const t of terms.values()) {
    const ns = namespaces.find((n) => t.iri.startsWith(n) && t.iri.length > n.length) ?? "";
    t.ns = ns;
    t.local = t.iri.slice(ns.length);
    if (!byNs.has(ns)) byNs.set(ns, []);
    byNs.get(ns).push(t);
  }
  for (const list of byNs.values()) list.sort((a, b) => b.count - a.count);
  return { terms, byNs, classProps, size: terms.size };
}

const humanKind = (t) => {
  if (t.type !== "individual") return t.type;
  if (!t.cls) return "individual";
  const local = t.cls.includes("#") ? t.cls.slice(t.cls.lastIndexOf("#") + 1) : t.cls.slice(t.cls.lastIndexOf("/") + 1);
  return local.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
};

/**
 * The completion source. `env` gives the live index, the prefix map (declared + common) and a
 * callback for a prefix picked from the list (so its PREFIX line gets declared).
 */
function sparqlCompletionSource(env, CM) {
  const KW_OPTIONS = Object.entries(SPARQL_KEYWORDS).map(([label, detail]) => ({ label, type: "keyword", detail, boost: -2 }));
  const FN_OPTIONS = Object.entries(SPARQL_FUNCTIONS).map(([label, detail]) => ({
    label,
    type: "function",
    detail,
    boost: -1,
    apply: (view, c, from, to) => {
      const zero = /^\(\)/.test(detail);
      view.dispatch({ changes: { from, to, insert: label + "()" }, selection: { anchor: from + label.length + (zero ? 2 : 1) } });
    },
  }));
  const STRUCT_KW = /\b(SELECT|DISTINCT|REDUCED|WHERE|CONSTRUCT|ASK|DESCRIBE|FILTER|BIND|VALUES|ORDER|GROUP|BY|HAVING|LIMIT|OFFSET|AS|ASC|DESC|UNION|OPTIONAL|MINUS|GRAPH|SERVICE|PREFIX|BASE)\b/i;

  /** What sits before the cursor: the token being typed and the triple position it is in. */
  function analyze(doc, pos, explicit) {
    const before = doc.sliceString(Math.max(0, pos - 6000), pos);
    let tok;
    let m;
    if ((m = /\bPREFIX\s+(?:[A-Za-z_][\w-]*)?:\s*<([^>\s]*)$/i.exec(before))) tok = { kind: "nsIri", text: m[1], from: pos - m[1].length - 1 };
    else if ((m = /<([^<>\s"]*)$/.exec(before))) tok = { kind: "iri", text: m[1], from: pos - m[0].length };
    else if ((m = /[?$]([A-Za-z_]\w*)?$/.exec(before))) tok = { kind: "var", text: m[0], from: pos - m[0].length };
    else if ((m = /([A-Za-z_][\w.-]*)?:([\w.\-/]*)$/.exec(before)) && !/[\w>"]$/.test(before.slice(0, pos - m[0].length))) tok = { kind: "pname", prefix: m[1] || "", local: m[2], text: m[0], from: pos - m[0].length };
    else if ((m = /([A-Za-z_][\w-]*)$/.exec(before))) tok = { kind: "word", text: m[1], from: pos - m[1].length };
    else if (explicit) tok = { kind: "word", text: "", from: pos };
    else return null;
    // Context: the text before the token, with comments, strings and IRIs blanked.
    const ctx = before
      .slice(0, tok.from - Math.max(0, pos - 6000))
      .replace(/#[^\n]*/g, " ")
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
      .replace(/<[^>\s]*>/g, "<>");
    // The last structural delimiter and the terms since it.
    const delim = /[{}(\[\]),;]|\.(?=\s|$)/g;
    let last = -1, lastCh = "";
    for (let d; (d = delim.exec(ctx)); ) (last = d.index), (lastCh = d[0]);
    const tail = ctx.slice(last + 1);
    const words = tail.trim().split(/\s+/).filter(Boolean);
    const kwAt = words.findIndex((w) => STRUCT_KW.test(w));
    const terms = kwAt >= 0 ? words.slice(kwAt + 1) : words;
    let position = "subject"; // subject | predicate | object | class | head | expr
    if (kwAt >= 0 && !/^(WHERE|OPTIONAL|UNION|MINUS|GRAPH|SERVICE|LATERAL)$/i.test(words[kwAt])) position = "head";
    else if (lastCh === "(") position = "expr";
    else if (lastCh === ";") position = terms.length === 0 ? "predicate" : "object";
    else if (lastCh === ",") position = "object";
    else if (lastCh === "[") position = terms.length === 0 ? "predicate" : "object";
    else position = ["subject", "predicate", "object"][Math.min(terms.length, 2)];
    if (terms.length && /^(a|rdf:type)$/.test(terms[terms.length - 1]) && position === "object") position = "class";
    // The subject of the current triple, for predicate ranking.
    let subject = null;
    if (position === "predicate" || position === "object" || position === "class") {
      if (lastCh === ";" || lastCh === ",") {
        const prev = ctx.slice(0, last);
        const open = Math.max(prev.lastIndexOf("{"), prev.search(/\.(?=\s)(?![\s\S]*\.(?=\s))/), prev.lastIndexOf("["));
        subject = prev.slice(open + 1).trim().split(/\s+/).filter((w) => w && !STRUCT_KW.test(w))[0] ?? null;
      } else subject = terms[0] ?? null;
    }
    return { tok, position, subject, docText: doc.toString() };
  }

  const expand = (pname, prefixes) => {
    const i = pname.indexOf(":");
    if (i < 0) return null;
    const ns = prefixes.get(pname.slice(0, i));
    return ns ? ns + pname.slice(i + 1) : null;
  };
  /** The class of a subject term: an IRI's own class, or what the query says a variable is (`?x a <C>`). */
  function subjectClass(subject, docText, prefixes, index) {
    if (!subject) return null;
    if (/^[?$]/.test(subject)) {
      const m = new RegExp(`\\${subject}\\s+(?:a|rdf:type)\\s+(<[^>\\s]+>|[\\w.-]*:[\\w.\\-/]*)`).exec(docText);
      if (!m) return null;
      return m[1].startsWith("<") ? m[1].slice(1, -1) : expand(m[1], prefixes);
    }
    const iri = subject.startsWith("<") ? null : expand(subject, prefixes);
    return iri ? index.terms.get(iri)?.cls ?? null : null;
  }

  function termOptions(list, prefix, position, subjClass, index, base = 0) {
    const used = subjClass ? index.classProps.get(subjClass) : null;
    const out = [];
    for (const t of list) {
      let boost = base + Math.min(3, Math.log10(t.count + 1));
      if (position === "class") boost += t.type === "class" ? 6 : t.type === "individual" ? -2 : 0;
      else if (position === "predicate") boost += t.type === "property" ? 5 + (used?.has(t.iri) ? 3 : 0) : -2;
      else if (position === "object") boost += t.type === "individual" ? 4 : t.type === "datatype" ? 2 : t.type === "property" ? -2 : 0;
      else if (position === "subject") boost += t.type === "individual" ? 3 : t.type === "class" ? 1 : -1;
      const label = prefix === null ? `<${t.iri}>` : `${prefix}:${t.local}`;
      out.push({ label, type: t.type, detail: `${t.label ? t.label + " · " : ""}${humanKind(t)} · ${t.count}`, boost: Math.max(-99, Math.min(99, boost)) });
    }
    return out;
  }

  return (context) => {
    const index = env.index();
    const prefixes = env.prefixes();
    const a = analyze(context.state.doc, context.pos, context.explicit);
    if (!a || !index) return null;
    const { tok, position, subject, docText } = a;
    if (tok.kind === "nsIri") {
      return { from: tok.from, options: [...KNOWN_NS].map(([p, ns]) => ({ label: `<${ns}>`, type: "namespace", detail: p + ":" })), validFor: /^<[^>\s]*$/ };
    }
    if (tok.kind === "var") {
      const sigil = tok.text[0];
      const seen = new Map();
      const re = /[?$]([A-Za-z_]\w*)/g;
      for (let m; (m = re.exec(docText)); ) if (m.index < tok.from || m.index >= context.pos) seen.set(m[1], m.index);
      const names = [...seen.entries()].sort((x, y) => (x[1] < tok.from) - (y[1] < tok.from) || y[1] - x[1]); // nearest before the cursor first
      return { from: tok.from, options: names.map(([n], i) => ({ label: sigil + n, type: "variable", boost: 10 - Math.min(9, i) })), validFor: /^[?$]\w*$/ };
    }
    if (tok.kind === "iri") {
      const subjClass = subjectClass(subject, docText, prefixes, index);
      const opts = termOptions([...index.terms.values()], null, position, subjClass, index);
      for (const [p, ns] of KNOWN_NS) opts.push({ label: `<${ns}>`, type: "namespace", detail: p + ":", boost: -3 });
      return { from: tok.from, options: opts, validFor: /^<[^>\s]*$/ };
    }
    if (tok.kind === "pname") {
      const ns = prefixes.get(tok.prefix);
      if (!ns) return null;
      const list = index.byNs.get(ns) ?? [];
      const subjClass = subjectClass(subject, docText, prefixes, index);
      return { from: tok.from, options: termOptions(list, tok.prefix, position, subjClass, index), validFor: /^(?:[A-Za-z_][\w.-]*)?:[\w.\-/]*$/ };
    }
    // A bare word: prefixes, keywords, functions, variables (in expressions), and data terms across
    // the declared namespaces so "found" finds yr:founded.
    const w = tok.text;
    const opts = [];
    for (const [p, ns] of prefixes) {
      opts.push({
        label: p + ":",
        type: "namespace",
        detail: ns,
        boost: KNOWN_NS.has(p) && !PREFIXES.some(([b]) => b === p) ? 1 : 2,
        apply: (view, c, from, to) => {
          view.dispatch({ changes: { from, to, insert: c.label }, selection: { anchor: from + c.label.length } });
          env.notePrefix(p);
          CM.startCompletion(view);
        },
      });
    }
    if (position === "head" || position === "expr") {
      const re = /[?$]([A-Za-z_]\w*)/g;
      const seen = new Set();
      for (let m; (m = re.exec(docText)); ) seen.add(m[1]);
      for (const n of seen) opts.push({ label: "?" + n, type: "variable", boost: 1 });
    }
    if (w.length >= 2) {
      const subjClass = subjectClass(subject, docText, prefixes, index);
      for (const [p, ns] of prefixes) {
        const list = index.byNs.get(ns);
        if (list) opts.push(...termOptions(list.slice(0, 400), p, position, subjClass, index, -1));
      }
    }
    opts.push(...KW_OPTIONS, ...FN_OPTIONS);
    if (!w && !context.explicit) return null;
    return { from: tok.from, options: opts, validFor: /^[\w-]*$/ };
  };
}

// ── editors ───────────────────────────────────────────────────────────────────
// Both expose: kind, value, setValue, focus, setError(line), setVim(on), layout(), destroy().
async function createEditor(host, cb, { cmUrl, completion }) {
  try {
    if (!cmUrl) throw new Error("disabled");
    const CM = await import(cmUrl);
    if (completion) cb.completion = completion(CM);
    return cmEditor(CM, host, cb);
  } catch (e) {
    console.warn("query console: CodeMirror bundle not loaded, using the plain editor:", e);
    return textareaEditor(host, cb);
  }
}

let vimExDefined = false;
function cmEditor(CM, host, cb) {
  const { EditorState, EditorView, Compartment, StateEffect, StateField, Prec, keymap, lineNumbers, drawSelection, Decoration, highlightActiveLineGutter, highlightActiveLine } = CM;
  host.classList.add("cm");
  const vimComp = new Compartment();
  const setErr = StateEffect.define();
  const errField = StateField.define({
    create: () => Decoration.none,
    update(deco, tr) {
      for (const e of tr.effects) {
        if (e.is(setErr)) {
          if (!e.value || e.value > tr.state.doc.lines) return Decoration.none;
          return Decoration.set([Decoration.line({ class: "cm-errline" }).range(tr.state.doc.line(e.value).from)]);
        }
      }
      return tr.docChanged ? Decoration.none : deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  const t = CM.tags;
  const style = CM.HighlightStyle.define([
    { tag: t.keyword, class: "k" },
    { tag: t.meta, class: "k" },
    { tag: t.standard(t.variableName), class: "f" },
    { tag: t.atom, class: "p" },
    { tag: t.local(t.variableName), class: "v" },
    { tag: t.string, class: "s" },
    { tag: t.comment, class: "c" },
    { tag: t.operator, class: "o" },
    { tag: t.bracket, class: "b" },
    { tag: t.number, class: "n" },
  ]);
  const run = () => (cb.onRun(), true);
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "",
      extensions: [
        vimComp.of([]), // vim() must sit before the other keymaps
        Prec.highest(keymap.of([{ key: "Mod-Enter", run }])),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        CM.history(),
        drawSelection(),
        CM.indentUnit.of("  "),
        CM.bracketMatching(),
        CM.closeBrackets(),
        CM.autocompletion({
          override: cb.completion ? [cb.completion] : [],
          activateOnTyping: true,
          activateOnTypingDelay: 120,
          maxRenderedOptions: 80,
          icons: true,
          defaultKeymap: true, // Ctrl-Space opens, Enter accepts, Esc closes, arrows move
          tooltipClass: () => "qc-ac",
        }),
        // Tab accepts; Ctrl-n / Ctrl-p walk the list (Vim insert-mode habit). All fall through when no popup is open.
        Prec.highest(
          keymap.of([
            { key: "Tab", run: CM.acceptCompletion },
            { key: "Ctrl-n", run: (v) => CM.moveCompletionSelection(true)(v) },
            { key: "Ctrl-p", run: (v) => CM.moveCompletionSelection(false)(v) },
          ]),
        ),
        CM.highlightSelectionMatches(),
        CM.StreamLanguage.define(CM.sparql),
        CM.syntaxHighlighting(style),
        errField,
        keymap.of([...CM.closeBracketsKeymap, ...CM.defaultKeymap, ...CM.historyKeymap, ...CM.searchKeymap, CM.indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.onChange();
        }),
        EditorView.contentAttributes.of({ "aria-label": "SPARQL query", spellcheck: "false", autocapitalize: "off", autocorrect: "off" }),
      ],
    }),
  });
  // While the popup is open, Esc / Enter / Tab / Ctrl-n / Ctrl-p belong to it — ahead of Vim's own
  // keydown handler (which would otherwise take Esc to NORMAL first).
  view.contentDOM.addEventListener(
    "keydown",
    (e) => {
      if (CM.completionStatus(view.state) !== "active") return;
      let handled = false;
      if (e.key === "Escape") handled = CM.closeCompletion(view);
      else if (e.key === "Enter" || e.key === "Tab") handled = CM.acceptCompletion(view);
      else if (e.ctrlKey && (e.key === "n" || e.key === "p")) handled = CM.moveCompletionSelection(e.key === "n")(view);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  let vimActive = false;
  const ed = {
    kind: "cm",
    view,
    get value() {
      return view.state.doc.toString();
    },
    setValue(v) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v }, selection: { anchor: 0 }, scrollIntoView: true });
    },
    focus: () => view.focus(),
    setError: (line) => view.dispatch({ effects: setErr.of(line) }),
    setVim(on) {
      if (on === vimActive) return true;
      vimActive = on;
      view.dispatch({ effects: vimComp.reconfigure(on ? CM.vim({ status: false }) : []) });
      if (!on) {
        cb.onMode(null);
        return true;
      }
      if (!vimExDefined) {
        vimExDefined = true;
        CM.Vim.defineEx("write", "w", () => cb.onRun());
        CM.Vim.defineEx("run", "run", () => cb.onRun());
        CM.Vim.defineEx("quit", "q", (cm) => cm.cm6?.contentDOM.blur());
        CM.Vim.defineEx("wq", "wq", (cm) => (cb.onRun(), cm.cm6?.contentDOM.blur()));
      }
      const cm = CM.getCM(view);
      cm?.on("vim-mode-change", (e) => cb.onMode(e.mode + (e.subMode === "linewise" ? " line" : e.subMode === "blockwise" ? " block" : "")));
      cb.onMode("normal");
      return true;
    },
    /** Feed Vim keys as a user would (for tests): "dw", "ciwfoo<Esc>", "3j" … */
    vimKeys(keys) {
      const cm = CM.getCM(view);
      if (!cm) throw new Error("vim is off");
      for (const k of keys.match(/<[^>]+>|[\s\S]/g) || []) {
        // In insert mode, plain characters arrive as text input, not as keys.
        if (k.length === 1 && cm.state.vim?.insertMode) view.dispatch(view.state.replaceSelection(k), { scrollIntoView: true, userEvent: "input.type" });
        else CM.Vim.handleKey(cm, k, "user");
      }
    },
    /** Completion hooks (for tests): open, list, accept. */
    completeOpen: () => CM.startCompletion(view),
    completions: () => ({ status: CM.completionStatus(view.state), options: (CM.currentCompletions(view.state) || []).map((o) => ({ label: o.label, type: o.type, detail: o.detail })), selected: CM.selectedCompletion(view.state)?.label ?? null }),
    completeAccept: () => CM.acceptCompletion(view),
    completeMove: (fwd) => CM.moveCompletionSelection(fwd)(view),
    setCursor: (pos) => view.dispatch({ selection: { anchor: pos } }),
    /** Run an ex command (for tests): "w", "run", "q" … */
    vimEx(cmd) {
      const cm = CM.getCM(view);
      if (!cm) throw new Error("vim is off");
      CM.Vim.handleEx(cm, cmd);
    },
    layout: () => view.requestMeasure(),
    destroy: () => view.destroy(),
  };
  return ed;
}

function textareaEditor(host, cb) {
  host.innerHTML = `<div class="qc-gut"></div><div class="qc-wrap"><pre aria-hidden="true"></pre><textarea spellcheck="false" autocapitalize="off" autocorrect="off" wrap="off" aria-label="SPARQL query"></textarea></div>`;
  const ta = host.querySelector("textarea"), pre = host.querySelector("pre"), gut = host.querySelector(".qc-gut");
  let errLine = 0;
  function render() {
    const src = ta.value;
    const lines = src.split("\n");
    let html = highlight(src);
    if (errLine) {
      const parts = html.split("\n");
      if (parts.length === lines.length && errLine <= parts.length) {
        parts[errLine - 1] = `<span class="errline">${parts[errLine - 1] || " "}</span>`;
        html = parts.join("\n");
      }
    }
    pre.innerHTML = html + "\n";
    gut.innerHTML = lines.map((_, i) => `<i${i + 1 === errLine ? ' class="err"' : ""}>${i + 1}</i>`).join("");
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
    ta.style.width = Math.max(host.clientWidth - gut.offsetWidth, pre.scrollWidth) + "px";
  }
  ta.addEventListener("input", () => {
    render();
    cb.onChange();
  });
  ta.addEventListener("scroll", () => {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  });
  const PAIRS = { "{": "}", "(": ")", "[": "]", '"': '"', "'": "'" };
  ta.addEventListener("keydown", (e) => {
    const { selectionStart: a, selectionEnd: b, value: v } = ta;
    const ins = (text, caret = a + text.length) => {
      ta.setRangeText(text, a, b, "end");
      ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event("input"));
    };
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      cb.onRun();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const ls = v.lastIndexOf("\n", a - 1) + 1;
      if (a !== b || e.shiftKey) {
        const le = v.indexOf("\n", b) === -1 ? v.length : v.indexOf("\n", b);
        const out = v.slice(ls, le).split("\n").map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, "") : "  " + l)).join("\n");
        ta.setRangeText(out, ls, le, "select");
        ta.dispatchEvent(new Event("input"));
      } else ins("  ");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      const ls = v.lastIndexOf("\n", a - 1) + 1;
      const indent = /^[ \t]*/.exec(v.slice(ls, a))[0];
      const before = v[a - 1], after = v[a];
      e.preventDefault();
      if (before === "{" && after === "}") ins(`\n${indent}  \n${indent}`, a + indent.length + 3);
      else ins("\n" + indent + (before === "{" || before === "(" || before === "[" ? "  " : ""));
      return;
    }
    if (PAIRS[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const close = PAIRS[e.key];
      if (a !== b) {
        e.preventDefault();
        ta.setRangeText(e.key + v.slice(a, b) + close, a, b, "select");
        ta.setSelectionRange(a + 1, b + 1);
        ta.dispatchEvent(new Event("input"));
      } else if ((e.key === '"' || e.key === "'") && v[a] === e.key) {
        e.preventDefault();
        ta.setSelectionRange(a + 1, a + 1);
      } else if (e.key === '"' || e.key === "'" ? !/\w/.test(v[a - 1] || "") && !/\w/.test(v[a] || "") : true) {
        e.preventDefault();
        ins(e.key + close, a + 1);
      }
      return;
    }
    if ((e.key === "}" || e.key === ")" || e.key === "]") && v[a] === e.key && a === b) {
      e.preventDefault();
      ta.setSelectionRange(a + 1, a + 1);
      return;
    }
    if (e.key === "Backspace" && a === b && a > 0 && PAIRS[v[a - 1]] === v[a]) {
      e.preventDefault();
      ta.setRangeText("", a - 1, a + 1, "end");
      ta.dispatchEvent(new Event("input"));
    }
  });
  return {
    kind: "textarea",
    get value() {
      return ta.value;
    },
    setValue(v) {
      ta.value = v;
      errLine = 0;
      render();
      cb.onChange();
    },
    focus: () => ta.focus(),
    setError(line) {
      errLine = line;
      render();
    },
    setVim: () => false,
    layout: render,
    destroy() {},
  };
}

// ── force-directed graph on a canvas ──────────────────────────────────────────
function makeGraph({ root, on, store, labelOf, bodies, authored, atlasId, locate, inspect, shortIri, onNavigate }) {
  const canvas = root.querySelector("canvas");
  const cx = canvas.getContext("2d");
  const crumbsEl = root.querySelector(".qc-crumbs");
  const tip = root.querySelector(".qc-gtip");
  const sel = root.querySelector(".qc-gsel");
  const note = root.querySelector(".qc-gnote");
  const CONTINUED = NS + "continuedAs";
  const css = (name, fb) => getComputedStyle(root).getPropertyValue(name).trim() || fb;
  // Any CSS colour → "r,g,b", via the canvas's own parser (it normalises opaque colours to #rrggbb).
  const rgb = (c) => {
    cx.fillStyle = "#000";
    cx.fillStyle = c;
    const v = cx.fillStyle;
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v) || [];
    return m.length ? `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}` : (/rgba?\(([^)]+)\)/.exec(v)?.[1].split(",").slice(0, 3).join(",") ?? "128,128,128");
  };
  const col = () => {
    const c = {
      bone: css("--qbone", "#e9e4d9"),
      bone2: css("--qbone2", "#b7b1a6"),
      bone3: css("--qbone3", "#7f7a71"),
      bone4: css("--qbone4", "#514d47"),
      sig: css("--qsig", "#ff6a3d"),
      sig2: css("--qsig2", "#ffa98a"),
      panel: css("--qpanel", "#121518"),
      line2: css("--qline2", "#30373f"),
    };
    const ink = rgb(c.bone), panel = rgb(c.panel), sig = rgb(c.sig);
    c.edgeLit = `rgba(${ink},.12)`;
    c.edge = `rgba(${ink},.22)`;
    c.arrow = `rgba(${ink},.35)`;
    c.halo = `rgba(${panel},.82)`;
    c.glow = `rgba(${sig},.6)`;
    return c;
  };
  let C = col();
  // Theme changes (site-wide contract: `yr-theme` on window, `storage` across tabs): re-read, redraw.
  const retheme = () => {
    C = col();
    draw();
  };
  on(window, "yr-theme", retheme);
  on(window, "storage", (e) => e.key === "yr-theme" && retheme());
  const SERIF = `"Instrument Serif",Georgia,serif`, MONO = `"IBM Plex Mono",Menlo,monospace`;

  let nodes = [], edges = [], byKey = new Map();
  let W = 0, H = 0, DPR = 1;
  const cam = { x: 0, y: 0, k: 1 };
  let alpha = 0, raf = 0, hover = null, hoverEdge = null, focus = null, dragging = null, panning = null, moved = false;
  let crumbs = []; // [{label, nodes, edges, cam}]
  let title = "";

  function resize(force) {
    const r = root.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), hh = Math.max(1, Math.round(r.height));
    if (!force && w === W && hh === H) return;
    W = w;
    H = hh;
    DPR = Math.min(2, devicePixelRatio || 1);
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    C = col();
    draw();
  }

  // ── building the graph from a result ───────────────────────────────────────
  const nodeOf = (t) => {
    const key = termKey(t);
    let n = byKey.get(key);
    if (!n) {
      const kind = t.termType === "Literal" ? "lit" : t.termType === "BlankNode" ? "bnode" : "iri";
      const small = kind === "iri" && /\/(pull|issues)\/\d+$/.test(t.value); // a PR or an issue: a satellite of its repo
      n = { key, term: t, kind, small, label: labelOf(t), x: 0, y: 0, vx: 0, vy: 0, deg: 0, r: 4, fixed: false, atlas: kind === "iri" && !small && (bodies.has(t.value) || atlasId(t.value)), hollow: kind === "iri" && !small && t.value.startsWith(BASE + "repo/") && !authored.has(t.value) };
      if (kind === "lit") n.label = t.value.length > 28 ? t.value.slice(0, 27) + "…" : t.value;
      byKey.set(key, n);
      nodes.push(n);
    }
    return n;
  };
  const edgeOf = (a, b, label, iri, directed) => {
    if (a === b) return;
    const ek = `${a.key}|${label}|${b.key}`;
    if (edges.some((e) => e.k === ek)) return;
    edges.push({ k: ek, a, b, label, iri, directed, continued: iri === CONTINUED });
    a.deg++;
    b.deg++;
  };
  function fromQuads(quads) {
    for (const q of quads) {
      // Names become labels, not nodes; types become a small tag.
      if (q.predicate.value === "https://schema.org/name" || q.predicate.value === "http://www.w3.org/2000/01/rdf-schema#label") {
        nodeOf(q.subject).label = q.object.value;
        continue;
      }
      if (q.predicate.value === RDF_TYPE) {
        const n = nodeOf(q.subject);
        n.type = shortIri(q.object.value);
        continue;
      }
      if (q.object.termType === "Literal" && q.object.value.length > 60) {
        nodeOf(q.subject);
        continue; // long prose stays in the inspector
      }
      edgeOf(nodeOf(q.subject), nodeOf(q.object), shortIri(q.predicate.value), q.predicate.value, true);
    }
  }
  function fromRows(vars, rows) {
    // Each row is a path through its cells: resources are linked in order; a literal that
    // follows a resource and whose variable looks like a name labels it, other literals hang off it.
    const nameVar = (v) => /^(name|title|label|fromName|toName)$/i.test(v);
    for (const row of rows.slice(0, 400)) {
      let prev = null, prevVar = null;
      for (let c = 0; c < row.length; c++) {
        const t = row[c];
        if (!t) continue;
        if (t.termType === "Literal" && prev && nameVar(vars[c]) && !prev.named) {
          prev.node.label = t.value;
          prev.named = true;
          continue;
        }
        const n = nodeOf(t);
        if (prev) {
          // Two resources in one row: if the store holds a triple between them, draw that
          // predicate (so continuedAs shows as an arrow); otherwise the column name.
          const real = n.kind !== "lit" && prev.node.kind !== "lit" ? store.match(prev.node.term.id, 0, n.term.id, 0)[0] || store.match(n.term.id, 0, prev.node.term.id, 0)[0] : null;
          if (real) edgeOf(nodeOf(real[0]), nodeOf(real[2]), shortIri(real[1].value), real[1].value, true);
          else edgeOf(prev.node, n, vars[c], null, prev.node.kind !== "lit" && n.kind !== "lit");
        }
        if (t.termType !== "Literal" || !prev) prev = { node: n, col: c, named: false };
      }
    }
  }
  function reset() {
    nodes = [];
    edges = [];
    byKey = new Map();
    focus = null;
    hover = null;
  }
  function setResult(result, text, focusIri) {
    reset();
    crumbs = [];
    title = text ? (text.includes("\n") ? "query" : text) : focusIri ? labelOf({ termType: "NamedNode", value: focusIri }) : "query";
    if (result.type === "select") fromRows(result.vars, result.rows);
    if (!text && !focusIri) title = "query";
    else if (result.quads) fromQuads(result.quads);
    if (focusIri) focus = byKey.get(`N:${focusIri}`) || null;
    layoutInitial();
    pushCrumb(title);
    settle();
    fit();
    updateNote();
  }
  // DESCRIBE around a node, merged into the current graph; the old graph goes on the breadcrumb trail.
  function expand(iri, { focus: setFocus = true } = {}) {
    const center = byKey.get(`N:${iri}`);
    if (crumbs.length) crumbs.at(-1).snapshot = snapshot();
    const quads = store.describe(iri);
    const before = nodes.length;
    const seed = center || nodeOf({ termType: "NamedNode", value: iri });
    if (!center) {
      seed.x = cam.x;
      seed.y = cam.y;
    }
    fromQuads(quads);
    const fresh = nodes.slice(before);
    // New nodes spawn in a ring around the one that was clicked, so they do not fly in from the origin.
    fresh.forEach((n, i) => {
      if (n === seed) return;
      const a = (i / Math.max(1, fresh.length)) * Math.PI * 2;
      const d = 40 + 14 * Math.sqrt(fresh.length);
      n.x = seed.x + Math.cos(a) * d;
      n.y = seed.y + Math.sin(a) * d;
    });
    if (setFocus) focus = seed;
    pushCrumb(labelOf(seed.term));
    alpha = 0.9;
    settle(Math.min(60, 10 + fresh.length));
    tick();
    updateNote();
    showSel();
    onNavigate();
  }
  const snapshot = () => ({ nodes: nodes.map((n) => ({ ...n })), edges: edges.map((e) => ({ ...e })), cam: { ...cam }, focus: focus?.key });
  function restore(s) {
    nodes = s.nodes.map((n) => ({ ...n }));
    byKey = new Map(nodes.map((n) => [n.key, n]));
    edges = s.edges.map((e) => ({ ...e, a: byKey.get(e.a.key), b: byKey.get(e.b.key) }));
    Object.assign(cam, s.cam);
    focus = s.focus ? byKey.get(s.focus) : null;
    alpha = 0;
    draw();
  }
  function pushCrumb(label) {
    crumbs.push({ label, snapshot: null });
    renderCrumbs();
  }
  function renderCrumbs() {
    crumbsEl.innerHTML = crumbs
      .map((c, i) => `${i ? '<span class="sep">›</span>' : ""}<button data-crumb="${i}" aria-current="${i === crumbs.length - 1}" title="${esc(c.label)}">${esc(c.label)}</button>`)
      .join("");
  }
  on(crumbsEl, "click", (e) => {
    const b = e.target.closest("[data-crumb]");
    if (!b) return;
    const i = Number(b.dataset.crumb);
    if (i >= crumbs.length - 1 || !crumbs[i].snapshot) return;
    restore(crumbs[i].snapshot);
    crumbs = crumbs.slice(0, i + 1);
    crumbs[i].snapshot = null;
    renderCrumbs();
    updateNote();
    showSel();
    onNavigate();
  });
  function updateNote() {
    note.textContent = nodes.length ? `${nodes.length} nodes · ${edges.length} edges · click expands, double-click locates` : "";
  }

  // ── layout ─────────────────────────────────────────────────────────────────
  function layoutInitial() {
    // Deterministic: hubs near the middle, the rest on rings by degree, angle by index.
    const sorted = [...nodes].sort((a, b) => b.deg - a.deg);
    const golden = Math.PI * (3 - Math.sqrt(5));
    sorted.forEach((n, i) => {
      const r = 60 * Math.sqrt(i + 0.5) * (n.kind === "lit" ? 1.15 : 1);
      n.x = Math.cos(i * golden) * r;
      n.y = Math.sin(i * golden) * r;
      n.vx = n.vy = 0;
      n.r = n.kind === "lit" ? 3 : n.small ? 2.5 : Math.min(13, 4 + 1.8 * Math.sqrt(n.deg));
    });
    alpha = 1;
  }
  function step() {
    const n = nodes.length;
    if (!n) return;
    const rep = n > 250 ? 2200 : 3600;
    // Repulsion (all pairs; fine for a few hundred nodes), with a far-field cutoff.
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 360000) continue;
        if (d2 < 1) {
          dx = (i % 7) - 3 + 0.1;
          dy = (j % 5) - 2 + 0.1;
          d2 = dx * dx + dy * dy;
        }
        const f = ((a.small || b.small ? rep * 0.25 : rep) * alpha) / d2;
        const fx = dx * f, fy = dy * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    // Springs.
    for (const e of edges) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const sat = e.a.small || e.b.small;
      const rest = sat ? 16 + e.a.r + e.b.r + Math.min(60, 0.6 * Math.max(e.a.deg, e.b.deg)) : 58 + e.a.r + e.b.r + (e.a.kind === "lit" || e.b.kind === "lit" ? 0 : 22) + Math.min(150, 5 * Math.max(e.a.deg, e.b.deg));
      const f = ((d - rest) / d) * 0.05 * alpha;
      const fx = dx * f, fy = dy * f;
      e.a.vx += fx;
      e.a.vy += fy;
      e.b.vx -= fx;
      e.b.vy -= fy;
    }
    // Gravity and integration (overdamped: no jitter).
    for (const p of nodes) {
      if (p.fixed) {
        p.vx = p.vy = 0;
        continue;
      }
      p.vx -= p.x * 0.004 * alpha;
      p.vy -= p.y * 0.004 * alpha;
      p.vx *= 0.55;
      p.vy *= 0.55;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 40) {
        p.vx *= 40 / sp;
        p.vy *= 40 / sp;
      }
      p.x += p.vx;
      p.y += p.vy;
    }
    alpha *= nodes.length > 300 ? 0.97 : 0.985;
  }
  // Pre-settle off-screen so the first frame is already calm.
  function settle(iters = nodes.length > 300 ? 70 : 220) {
    for (let i = 0; i < iters && alpha > 0.004; i++) step();
    if (alpha <= 0.004) alpha = 0;
  }
  function tick() {
    if (raf) return;
    const loop = () => {
      raf = 0;
      if (alpha > 0.004) {
        step();
        draw();
        raf = requestAnimationFrame(loop);
      } else {
        alpha = 0;
        draw();
      }
    };
    raf = requestAnimationFrame(loop);
  }
  function fit() {
    if (!nodes.length) {
      draw();
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x);
      y1 = Math.max(y1, n.y);
    }
    const pad = 70;
    cam.k = Math.max(0.15, Math.min(2.2, Math.min((W - pad * 2) / Math.max(40, x1 - x0), (H - pad * 2) / Math.max(40, y1 - y0))));
    cam.x = (x0 + x1) / 2;
    cam.y = (y0 + y1) / 2;
    draw();
  }

  // ── drawing ────────────────────────────────────────────────────────────────
  const toScreen = (x, y) => [W / 2 + (x - cam.x) * cam.k, H / 2 + (y - cam.y) * cam.k];
  const toWorld = (sx, sy) => [(sx - W / 2) / cam.k + cam.x, (sy - H / 2) / cam.k + cam.y];
  function draw() {
    if (!W) return;
    cx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx.clearRect(0, 0, W, H);
    if (!nodes.length) {
      cx.font = `italic 16px ${SERIF}`;
      cx.fillStyle = C.bone3;
      cx.textAlign = "center";
      cx.fillText("Run a query, then see its resources as a graph.", W / 2, H / 2);
      cx.textAlign = "left";
      return;
    }
    const k = cam.k;
    const neighbours = new Set();
    const pick = hover || focus;
    if (pick) for (const e of edges) if (e.a === pick || e.b === pick) neighbours.add(e.a === pick ? e.b : e.a);
    // Edges.
    const showLabels = edges.length <= 160 && k >= 0.75;
    for (const e of edges) {
      const [ax, ay] = toScreen(e.a.x, e.a.y), [bx, by] = toScreen(e.b.x, e.b.y);
      const lit = e.a.kind === "lit" || e.b.kind === "lit";
      const hot = e === hoverEdge || (pick && (e.a === pick || e.b === pick));
      cx.beginPath();
      cx.moveTo(ax, ay);
      cx.lineTo(bx, by);
      cx.strokeStyle = e.continued ? (hot ? C.sig : C.sig2) : hot ? C.bone2 : lit ? C.edgeLit : C.edge;
      cx.lineWidth = e.continued ? 1.6 : hot ? 1.2 : 1;
      if (e.continued) cx.setLineDash([]);
      cx.stroke();
      if (e.directed && (e.continued || hot || (showLabels && !lit))) {
        // Arrowhead at the target's rim.
        const d = Math.hypot(bx - ax, by - ay) || 1;
        const ux = (bx - ax) / d, uy = (by - ay) / d;
        const rr = e.b.r * Math.max(0.6, Math.min(1.4, k)) + 2;
        const tx = bx - ux * rr, ty = by - uy * rr;
        const s = e.continued ? 7 : 4.5;
        cx.beginPath();
        cx.moveTo(tx, ty);
        cx.lineTo(tx - ux * s - uy * s * 0.55, ty - uy * s + ux * s * 0.55);
        cx.lineTo(tx - ux * s + uy * s * 0.55, ty - uy * s - ux * s * 0.55);
        cx.closePath();
        cx.fillStyle = e.continued ? (hot ? C.sig : C.sig2) : hot ? C.bone2 : C.arrow;
        cx.fill();
      }
      if ((showLabels && !lit) || e === hoverEdge || e.continued) {
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        cx.font = `${e.continued ? 500 : 400} 9.5px ${MONO}`;
        const text = e.label;
        const w = cx.measureText(text).width;
        cx.fillStyle = C.panel;
        cx.fillRect(mx - w / 2 - 3, my - 7, w + 6, 13);
        cx.fillStyle = e.continued ? C.sig2 : hot ? C.bone2 : C.bone4;
        cx.textAlign = "center";
        cx.fillText(text, mx, my + 3);
        cx.textAlign = "left";
      }
    }
    // Nodes first, then labels by priority (focus, hover, hubs), skipping any that would overlap.
    const many = nodes.length > 90;
    const labels = [];
    for (const n of nodes) {
      const [x, y] = toScreen(n.x, n.y);
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      const r = n.r * Math.max(0.6, Math.min(1.4, k));
      const isFocus = n === focus, isHover = n === hover, near = neighbours.has(n);
      const dim = pick && !isFocus && !isHover && !near;
      cx.globalAlpha = dim ? 0.35 : 1;
      if (n.kind === "lit") {
        cx.fillStyle = isHover ? C.bone : C.bone3;
        cx.fillRect(x - 3, y - 3, 6, 6);
      } else if (n.small) {
        cx.beginPath();
        cx.arc(x, y, Math.max(1.5, r), 0, Math.PI * 2);
        cx.fillStyle = isFocus ? C.sig : isHover || near ? C.bone : C.bone3;
        cx.fill();
      } else if (n.kind === "bnode") {
        cx.beginPath();
        cx.arc(x, y, 3.5, 0, Math.PI * 2);
        cx.strokeStyle = C.bone4;
        cx.lineWidth = 1;
        cx.stroke();
      } else {
        cx.beginPath();
        cx.arc(x, y, r, 0, Math.PI * 2);
        if (isFocus) {
          cx.fillStyle = C.sig;
          cx.shadowColor = C.glow;
          cx.shadowBlur = 14;
          cx.fill();
          cx.shadowBlur = 0;
        } else if (n.hollow) {
          cx.fillStyle = C.panel;
          cx.fill();
          cx.strokeStyle = isHover || near ? C.bone : C.bone2;
          cx.lineWidth = 1.2;
          cx.stroke();
        } else {
          cx.fillStyle = isHover ? C.sig2 : near ? C.bone : n.atlas ? C.bone : C.bone2;
          cx.fill();
        }
      }
      const labelled = n.small ? isFocus || isHover : !many || n.deg >= 3 || isFocus || isHover || near || (n.kind === "iri" && n.atlas && n.deg >= 2);
      if (labelled && n.label) labels.push({ n, x, y, r, pri: isHover ? 4 : isFocus ? 3 : near ? 2 : 1, dim, isFocus, isHover });
      cx.globalAlpha = 1;
    }
    labels.sort((a, b) => b.pri - a.pri || b.n.deg - a.n.deg);
    const taken = [];
    const free = (x, y, w, hh) => !taken.some((t) => x < t.x + t.w && x + w > t.x && y < t.y + t.h && y + hh > t.y) && taken.push({ x, y, w, h: hh });
    cx.textBaseline = "middle";
    for (const { n, x, y, r, dim, isFocus, isHover } of labels) {
      const size = n.kind === "lit" ? 11 : isFocus ? 15 : Math.min(14.5, 11 + n.deg * 0.4);
      cx.font = n.kind === "lit" ? `11px ${MONO}` : `italic ${size}px ${SERIF}`;
      const text = n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label;
      const tw = cx.measureText(text).width;
      // Right of the node, else left of it; otherwise the label waits for a zoom.
      let lx = x + r + 5;
      if (!free(lx - 2, y - size / 2 - 1, tw + 4, size + 3)) {
        lx = x - r - 5 - tw;
        if (!free(lx - 2, y - size / 2 - 1, tw + 4, size + 3) && !isFocus && !isHover) continue;
      }
      cx.globalAlpha = dim ? 0.45 : 1;
      cx.fillStyle = C.halo;
      cx.fillRect(lx - 2, y - size / 2 - 1, tw + 4, size + 3);
      cx.fillStyle = n.kind === "lit" ? C.bone3 : isFocus ? C.sig2 : isHover ? C.bone : dim ? C.bone3 : C.bone2;
      cx.fillText(text, lx, y);
    }
    cx.textBaseline = "alphabetic";
    cx.globalAlpha = 1;
  }

  // ── interaction ────────────────────────────────────────────────────────────
  function nodeAt(sx, sy) {
    let best = null, bd = 12;
    for (const n of nodes) {
      const [x, y] = toScreen(n.x, n.y);
      const d = Math.hypot(x - sx, y - sy) - n.r * Math.max(0.6, Math.min(1.4, cam.k));
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }
  function edgeAt(sx, sy) {
    let best = null, bd = 6;
    for (const e of edges) {
      const [ax, ay] = toScreen(e.a.x, e.a.y), [bx, by] = toScreen(e.b.x, e.b.y);
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / L2));
      const d = Math.hypot(sx - (ax + t * (bx - ax)), sy - (ay + t * (by - ay)));
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  // Pointers: one finger drags a node or pans; two fingers pinch (zoom around the midpoint) and pan.
  // `touch-action: none` on the canvas keeps the browser from taking the gesture for page zoom/scroll.
  let clickTimer = 0;
  const pts = new Map(); // pointerId → [sx, sy]
  let pinch = null; // { d0, k0, wx, wy } — the world point under the initial midpoint stays put
  const clampK = (k) => Math.max(0.1, Math.min(5, k));
  const startPan = (sx, sy) => (panning = { sx, sy, cx: cam.x, cy: cam.y });
  on(canvas, "pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = pos(e);
    pts.set(e.pointerId, [sx, sy]);
    if (pts.size === 2) {
      // Second finger: whatever the first was doing becomes a pinch; it will not end as a tap.
      if (dragging) {
        dragging.n.fixed = false;
        dragging = null;
      }
      panning = null;
      moved = true;
      const [a, b] = [...pts.values()];
      const [wx, wy] = toWorld((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pinch = { d0: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), k0: cam.k, wx, wy };
      tip.hidden = true;
      return;
    }
    if (pts.size > 2) return;
    const n = nodeAt(sx, sy);
    moved = false;
    if (n) {
      dragging = { n, dx: 0, dy: 0 };
      n.fixed = true;
    } else startPan(sx, sy);
    canvas.classList.add("drag");
  });
  on(canvas, "pointermove", (e) => {
    const [sx, sy] = pos(e);
    if (pts.has(e.pointerId)) pts.set(e.pointerId, [sx, sy]);
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]));
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      cam.k = clampK((pinch.k0 * d) / pinch.d0);
      // Zoom around the pinch and follow it: the world point grabbed at the start stays under the midpoint.
      cam.x = pinch.wx - (mx - W / 2) / cam.k;
      cam.y = pinch.wy - (my - H / 2) / cam.k;
      draw();
      return;
    }
    if (dragging) {
      const [wx, wy] = toWorld(sx, sy);
      if (Math.hypot(wx - dragging.n.x, wy - dragging.n.y) > 0.5) moved = true;
      dragging.n.x = wx;
      dragging.n.y = wy;
      if (alpha < 0.15) alpha = 0.15;
      tick();
      return;
    }
    if (panning) {
      if (Math.hypot(sx - panning.sx, sy - panning.sy) > 2) moved = true;
      cam.x = panning.cx - (sx - panning.sx) / cam.k;
      cam.y = panning.cy - (sy - panning.sy) / cam.k;
      draw();
      return;
    }
    if (e.pointerType !== "mouse") return; // no hover on touch
    const n = nodeAt(sx, sy);
    const ed = n ? null : edgeAt(sx, sy);
    if (n !== hover || ed !== hoverEdge) {
      hover = n;
      hoverEdge = ed;
      canvas.classList.toggle("pt", !!n);
      draw();
    }
    if (n) {
      tip.hidden = false;
      tip.style.left = sx + "px";
      tip.style.top = sy + "px";
      const t = n.term;
      tip.innerHTML = `<b>${esc(n.label)}</b>${n.type ? `${esc(n.type)} · ` : ""}${t.termType === "NamedNode" ? esc(shortIri(t.value)) : t.termType === "Literal" ? esc(literalParts(t)[1] || "literal") : "blank node"}${n.deg ? ` · ${n.deg} link${n.deg > 1 ? "s" : ""}` : ""}`;
    } else if (ed) {
      tip.hidden = false;
      tip.style.left = sx + "px";
      tip.style.top = sy + "px";
      tip.innerHTML = `${esc(ed.a.label)} <span style="color:var(--qsig2)">${esc(ed.label)}</span> ${esc(ed.b.label)}`;
    } else tip.hidden = true;
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pinch) {
      // Pinch over: a finger left behind continues as a plain pan from where it is; never a tap.
      if (pts.size < 2) {
        pinch = null;
        const rest = [...pts.values()][0];
        if (rest) startPan(rest[0], rest[1]);
        else canvas.classList.remove("drag");
      }
      return;
    }
    if (pts.size) return;
    canvas.classList.remove("drag");
    if (dragging) {
      const n = dragging.n;
      dragging = null;
      n.fixed = false;
      if (!moved) {
        // Tap/click: select; a second one within 300 ms is a double-tap (locate).
        if (clickTimer && focus === n) {
          clearTimeout(clickTimer);
          clickTimer = 0;
          if (n.kind === "iri") locate(n.term.value);
          return;
        }
        focus = n;
        draw();
        showSel();
        clickTimer = setTimeout(() => {
          clickTimer = 0;
          if (n.kind === "iri" && focus === n) expand(n.term.value);
        }, 280);
      } else if (alpha < 0.1) alpha = 0.1, tick();
      return;
    }
    if (panning) {
      panning = null;
      if (!moved) {
        focus = null;
        draw();
        showSel();
      }
    }
  };
  on(canvas, "pointerup", up);
  on(canvas, "pointercancel", up);
  on(canvas, "lostpointercapture", (e) => {
    if (pts.has(e.pointerId)) up(e);
  });
  on(canvas, "pointerleave", () => {
    tip.hidden = true;
    if (hover || hoverEdge) {
      hover = hoverEdge = null;
      draw();
    }
  });
  // Wheel zooms; a trackpad pinch arrives as wheel + ctrlKey with small deltas, so it gets a larger gain.
  on(canvas, "wheel", (e) => {
    e.preventDefault();
    const [sx, sy] = pos(e);
    const [wx, wy] = toWorld(sx, sy);
    const gain = e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.012 : 0.0022;
    cam.k = clampK(cam.k * Math.exp(-e.deltaY * gain));
    cam.x = wx - (sx - W / 2) / cam.k;
    cam.y = wy - (sy - H / 2) / cam.k;
    draw();
  }, { passive: false });
  on(root.querySelector(".qc-gctl"), "click", (e) => {
    const b = e.target.closest("[data-g]");
    if (!b) return;
    if (b.dataset.g === "fit") return fit();
    cam.k = Math.max(0.1, Math.min(5, cam.k * (b.dataset.g === "in" ? 1.35 : 1 / 1.35)));
    draw();
  });
  function showSel() {
    if (!focus || focus.kind !== "iri") {
      sel.hidden = true;
      return;
    }
    const iri = focus.term.value;
    sel.hidden = false;
    sel.innerHTML = `<b title="${esc(iri)}">${esc(focus.label)}</b><button data-s="expand">expand</button><button data-s="inspect">inspect</button>${atlasId(iri) ? `<button data-s="locate">◎ locate</button>` : ""}`;
  }
  on(sel, "click", (e) => {
    const b = e.target.closest("[data-s]");
    if (!b || !focus) return;
    const iri = focus.term.value;
    if (b.dataset.s === "expand") expand(iri);
    else if (b.dataset.s === "inspect") inspect(iri);
    else locate(iri);
  });
  on(canvas, "keydown", (e) => {
    if (e.key === "Escape") {
      focus = null;
      draw();
      showSel();
    }
  });
  canvas.tabIndex = 0;

  return {
    setResult,
    expand,
    resize,
    fit,
    focus: () => (focus?.kind === "iri" ? focus.term.value : null),
    /** For tests: the camera (scale and centre) and node count. */
    camera: () => ({ k: cam.k, x: cam.x, y: cam.y, nodes: nodes.length, w: W, h: H }),
    nodeScreenPositions: () => nodes.map((n) => { const [x, y] = toScreen(n.x, n.y); return { x, y, kind: n.kind, label: n.label, iri: n.kind === "iri" ? n.term.value : null }; }),
    dispose() {
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
