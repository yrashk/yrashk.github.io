# Data contract — Atlas, RDF and the Lab query console

Two pieces of work meet here; both sides must follow this file. Change it only by agreement.

## Sources

| File | Made by | What |
|---|---|---|
| `data/github.json` / `github.js` (`window.GITHUB`) | `scripts/github-data.mjs` (re-run on every Pages build) | profile, last-year calendar, `authored[]`, `contributed[]` with per-year activity |
| `data/atlas.json` / `atlas.js` (`window.ATLAS`) | hand-curated (extracted from the 05 prototype) | everything that is not GitHub: life, companies, curated projects, writing, ideas, places |
| `data/atlas.ttl` | `scripts/atlas-rdf.mjs` from the two above | the whole Atlas as RDF (Turtle) |

`atlas.js` is just `window.ATLAS = <atlas.json>;` so pages work over file://. Keep both in sync (the
RDF script may regenerate `atlas.js` from `atlas.json`).

## `data/atlas.json`

```jsonc
{
  "person": {
    "id": "yrashk", "name": "Yurii Rashkovskii", "born": 1981, "birthplace": "Ukraine",
    "homes": ["redwood-city", "comox"]
  },
  "places": [
    { "id": "redwood-city", "name": "Redwood City, CA", "lat": 37.49, "lon": -122.24, "tz": "America/Los_Angeles" },
    { "id": "comox", "name": "Comox, BC", "lat": 49.67, "lon": -124.93, "tz": "America/Vancouver" }
  ],
  "sectors": [ { "id": "companies", "label": "Companies" } /* … in drawing order */ ],
  "bodies": [
    {
      "id": "strata",                 // stable, url-safe; used by #focus=<id>, `locate <id>`, RDF IRIs
      "kind": "project",              // life | company | project | writing | idea | oss
      "name": "Strata",
      "sector": "machines",           // a sectors[].id
      "start": 2026, "end": null,     // years; end null = ongoing; single-moment things use start only
      "approx": false,                // true when the year is an estimate ("c. YYYY")
      "weight": 3,                    // 1..4 visual significance
      "url": "https://yrashk.com/strata",
      "line": "A 64-bit machine where memory is explicit I/O.",   // positioning line
      "quote": "The machine shows through instead of being hidden.",
      "github": ["yrashk/strata"],    // optional: links to github.json repos (dedupe + activity)
      "place": "comox",               // optional, life events
      "date": "2023-02-16",           // writing only
      "listed": true,                 // writing only: shown in Writing (unlisted posts still resolve)
      "related": ["omnigres"]         // optional: other body ids
    }
  ]
}
```

The Atlas draws `bodies` plus GitHub repos: `authored[]` are **filled** dots, `contributed[]` are
**hollow** (outline) dots. A repo listed in some body's `github` is drawn as that body, not twice.
GitHub repos get the sector their language/topic suggests or a dedicated "Open source" sector — the
Atlas owner decides.

### Legend categories (toggleable)

`life`, `company`, `project`, `authored`, `contributed`, `writing`, `idea` (+ the contribution ring).
Clicking a legend item hides that category on the chart and dims the item; clicking again restores.
State is mirrored in the URL hash (`#show=company,project,life`) so slices are shareable, and is
exposed to the console via `window.atlas.setVisible(kinds)` / `window.atlas.highlight(ids)`.

## RDF vocabulary (`data/atlas.ttl`)

Base IRI `https://yrashk.com/atlas/` (bodies are `<https://yrashk.com/atlas/strata>`), prefixes:

```turtle
@prefix :       <https://yrashk.com/atlas/> .
@prefix yr:     <https://yrashk.com/ns#> .
@prefix schema: <https://schema.org/> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .
@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .
```

- Person `:yrashk a schema:Person ; schema:name ; schema:birthDate "1981"^^xsd:gYear ; schema:homeLocation :redwood-city, :comox ; yr:currentLocation :comox` (from `person.here`, one of `person.homes`).
- Kinds → classes: `yr:LifeEvent`, `yr:Company` (also `schema:Organization`), `yr:Project` (also `schema:CreativeWork`),
  `yr:Essay` (also `schema:BlogPosting`), `yr:Idea`, `yr:Repository` (also `schema:SoftwareSourceCode`).
- Body properties: `schema:name`, `schema:url`, `schema:description` (= line), `yr:quote`, `yr:sector`
  (IRI `:sector/<id>`, with `rdfs:label`), `yr:start` / `yr:end` (`xsd:gYear`), `yr:approximate true`,
  `yr:weight`, `schema:datePublished` (writing), `yr:listed`, `yr:featured`, `yr:related`, `schema:location`,
  `yr:continuedAs` (IRI of the body this one continued as — e.g. `:omnigres yr:continuedAs :inferal`; the Atlas draws it as a curved arrow in the company layer).
- Role links from the person: `:yrashk yr:founded <company>`, `yr:built <project>`, `yr:wrote <essay>`,
  `yr:authored <repo>`, `yr:contributedTo <repo>`, `yr:lived <life-event>`.
- Repos: IRI `:repo/<owner>/<name>`; `schema:codeRepository` (GitHub URL), `schema:programmingLanguage`,
  `yr:stars`, `yr:organization` (owner login), and one activity node per active year:
  `<repo> yr:activity [ yr:year "2012"^^xsd:gYear ; yr:contributions 188 ]`.
- Places: `:redwood-city a schema:Place ; schema:name ; schema:geo [ schema:latitude ; schema:longitude ]`.

### Contributions (`data/contributions.ttl`, from `github-detail.json`)

Kept apart so `atlas.ttl` stays small; the console loads it second, in the background, into the same graph.

- `yr:PullRequest` (also `schema:CreativeWork`), IRI `:repo/<owner>/<name>/pull/<n>`; `yr:Issue`, IRI `…/issues/<n>`.
- Properties: `yr:repository <repo>`, `yr:number`, `schema:name` (title), `yr:state` (`"merged"` | `"open"` | `"closed"`),
  `schema:dateCreated` (`xsd:date`), `schema:url` (the GitHub link).
- `:yrashk yr:opened <pr|issue>`; repositories that appear only here (PRs or issues, no counted commits) get a
  `yr:Repository` node with `schema:name` / `schema:codeRepository` and `:yrashk yr:contributedTo` it.
- Commit days: `<repo> yr:commitDay [ schema:startDate "2013-10-01"^^xsd:date ; yr:commits 1 ]`.

## Lab query console — `05-os-atlas/sparql.js`

A self-contained ES module the OS mounts into a Lab window:

```js
import { mountQueryConsole } from "./sparql.js";
const api = await mountQueryConsole(element, {
  turtleUrl: "../data/atlas.ttl",
  engineUrl: "../data/rdf/",            // WAT engine build + host adapter live here
  onLocate: (atlasId) => {},            // called when a result IRI maps to an Atlas body; OS flies the Atlas to it
  onHighlight: (atlasIds) => {},        // called with all body ids in the current result set
});
api.run("SELECT …");                    // also used by the terminal: `sparql <query>` / `q <preset>`
api.dispose();
```

It styles itself with the OS CSS variables (`--bone`, `--signal`, … read from `:root`) and never
touches DOM outside `element`.

Also: `contributionsUrl` (default `contributions.ttl` next to the Turtle, loaded in the background after the
core Atlas; `null` skips it), `codemirror: false` (plain textarea editor). The editor is CodeMirror 6 vendored
at `app/vendor/codemirror.js` (lazy-imported; the textarea is the fallback) with a Vim toggle
(`localStorage["yr-vim"]`; `:w` / `:run` run, `:q` leaves) and an autorun toggle (`localStorage["yr-autorun"]`,
on by default: a parsed query runs ~320 ms after the last edit under a 150 ms budget; SPARQL Update never
autoruns). Completion (Ctrl-Space or as you type): prefixes (the six above plus owl/foaf/dcterms/dc/skos/geo/prov/sh,
declared automatically when used), terms from the loaded store ranked by use and by position (classes after
`a`, properties after a subject or `;`, individuals/datatypes in object position), variables already in the
query, keywords and built-ins with signatures. Keys typed in the editor do not bubble out of it. `api.run()`
resolves to the result.

## Theme contract (site-wide)

Two themes: `dark` (graphite, the default) and `paper` (light bone/ink). One choice for the whole site.

- Stored in `localStorage["yr-theme"]` = `"dark"` | `"paper"` (wrapped in try/catch; storage may be unavailable).
- Applied as `<html data-theme="dark|paper">` by a tiny inline script in `<head>`, **before first paint**,
  on every page (app shell, article template, 404, redirect stubs). No flash of the wrong theme.
- Default when nothing is stored: `dark`. (Not prefers-color-scheme — the site's identity is dark; paper is a choice.)
- `?theme=paper|dark` in the URL overrides and is stored (shareable).
- Toggle: a small control in the top bar on every page (same glyph/label everywhere), plus the `p` key
  where keys aren't captured by an input. Toggling updates `data-theme`, storage, and dispatches
  `window.dispatchEvent(new CustomEvent("yr-theme", {detail: theme}))` so canvases (Atlas, monitor, SPARQL graph)
  can re-read colours and redraw.
- Cross-tab sync: listen for the `storage` event on `yr-theme` and apply it live.
- All colours come from CSS variables defined for both `[data-theme="dark"]` and `[data-theme="paper"]`; canvas code reads
  them via `getComputedStyle(document.documentElement)` on the `yr-theme` event. Code highlighting (Shiki) emits both
  themes (CSS variables / dual theme) so posts switch without rebuild.
