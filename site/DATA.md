# Data contract — Atlas, RDF and the Lab query console

Two pieces of work meet here; both sides must follow this file. Change it only by agreement.

## Sources

| File | Made by | What |
|---|---|---|
| `data/atlas.ttl` | **hand-edited** (Turtle) | everything that is not GitHub: the person, homes and stays, places, sectors, life, companies, curated projects, writing, talks, ideas |
| `data/github.json` / `github.js` (`window.GITHUB`) | `scripts/github-data.mjs` (re-run on every Pages build) | profile, last-year calendar, `authored[]`, `contributed[]` with per-year activity |
| `data/github.ttl`, `data/contributions.ttl` | `scripts/github-rdf.mjs` from `github.json`, `github-detail.json` (and `atlas.ttl`, for repo → body links) | the GitHub side as RDF |
| `/data/atlas.js` (`window.ATLAS`), `/data/atlas.json` | `scripts/build.mjs`, build output only | the Atlas as the desktop reads it, queried out of `atlas.ttl` |

`atlas.ttl` is the only place the curated Atlas lives. Nothing reads it as text: `scripts/atlas.mjs` loads it
into the WAT engine (`data/rdf/`) and SPARQL-queries it into the plain-object shape below, for the build
(reader pages, the clock, `posts.js`), `github-rdf.mjs` and `strava-rdf.mjs`. The build writes that shape to
`/data/atlas.js` so the desktop draws without loading the engine; the Lab loads the Turtle itself.
A Turtle error fails the build with the line it is on.

## `data/atlas.ttl`

Prefixes and `@base <https://yrashk.com/atlas/>` are at the top of the file, so `<sector/data>` and
`<repo/omnigres/omnigres>` are relative IRIs. A body is anything with a `yr:sector`; its kind is its class.
Each body is preceded by the person's link to it (see "Role links" below), so a new body is two statements:

```turtle
:yrashk yr:built :strata .
:strata
    a                  yr:Project, schema:CreativeWork ;
    schema:name        "Strata" ;
    schema:url         <https://yrashk.com/strata/> ;
    schema:description "A 64-bit machine where memory is explicit I/O." ;    # the positioning line
    yr:voice           "The machine shows through instead of being hidden." ;
    yr:sector          <sector/machines> ;
    ord:inOrdering     <ordering/chart> ;
    ord:rank           170 ;                        # its place in the chart order (below)
    yr:start           "2026"^^xsd:gYear ;          # no yr:end: ongoing
    yr:weight          3 ;                          # 1..4 visual significance
    yr:position        0.5 ;                        # 0..1 across its sector (default: a hash of the id)
    yr:repos           ( <repo/yrashk/strata> ) ;   # ordered: an RDF list
    yr:notes           ( "First note." "Second note." ) .
```

The person carries homes (an ordered list, clock order), the usual location, and stays:

```turtle
:yrashk
    yr:homes           ( :redwood-city :comox ) ;
    yr:defaultLocation :comox ;                     # where he is when no stay covers the day
    yr:stay            [ a yr:Stay ; yr:place :bangkok ; schema:startDate "2026-11-22"^^xsd:date ; schema:endDate "2026-12-07"^^xsd:date ],
                       [ a yr:Stay ; yr:place :redwood-city ; schema:startDate "2027-01-23"^^xsd:date ] .   # open-ended
```

Places: `:bangkok a schema:Place ; schema:name "Bangkok, Thailand" ; schema:geo [ schema:latitude 13.76 ;
schema:longitude 100.5 ] ; yr:timeZone "Asia/Bangkok"`. A place whose id is also a body id is written `<place/id>`.
Sectors: `<sector/companies> a yr:Sector ; rdfs:label "Companies" ; ord:inOrdering <ordering/sectors> ; ord:rank 1`.

**Order** uses Ontosome's ordering module (`ord:` = `https://ontology.inferal.com/modules/ordering/`,
[ontosome.com/modules/ordering](https://ontosome.com/modules/ordering/current/ontology.ttl)), since RDF itself keeps none.
Two named orderings, both `ord:rankDirection ord:AscendingRank` (a lesser `ord:rank` comes first):

- `<ordering/sectors>` (`ord:TotalOrdering`): the slices, in drawing order.
- `<ordering/chart>` (`ord:PartialOrdering`): the order the desktop receives bodies in. It decides which label
  wins where labels collide: among bodies of the same weight, the earlier one keeps its label. Ranks step by 10, so a
  new body can go between two without renumbering. A body with no rank comes after every ranked one, by kind
  (life, company, project, oss, writing, talk, idea), then start year, then id.

Values whose order matters but that are not things of their own (homes, notes, a body's repos, `yr:alsoAt`) are
RDF lists instead.

### The queried shape (`window.ATLAS`)

`{person, places, sectors, bodies}`. `person`: `{id, name, born, birthplace, homes: [placeId], here, stays:
[{place, from, to?}]}`; `places`: `[{id, name, lat, lon, tz}]`; `sectors`: `[{id, label}]` in `<ordering/sectors>`;
`bodies` in `<ordering/chart>`. Body fields and the predicates they come from:

| field | predicate | field | predicate |
|---|---|---|---|
| `id`, `kind` | the IRI, the class | `name` | `schema:name` |
| `url` | `schema:url` (on yrashk.com: a path) | `line` | `schema:description` |
| `desc` | `schema:abstract` | `quote` | `yr:quote` |
| `voice` | `yr:voice` | `role` | `yr:role` |
| `status` | `yr:status` | `group` | `yr:group` |
| `sector` | `yr:sector` | `start`, `end` | `yr:start`, `yr:end` (`xsd:gYear`; no end = `null`, ongoing) |
| `approx` | `yr:approximate` | `weight` | `yr:weight` |
| `f` | `yr:position` | `year` | `yr:chartYear` (where on the chart, as a fractional year) |
| `color`, `mono` | `yr:color`, `yr:mono` | `date` | `schema:datePublished` (writing), `schema:startDate` (talks) |
| `listed`, `featured`, `sample` | `yr:listed`, `yr:featured`, `yr:sample` | `tags` | `schema:keywords` (sorted) |
| `place` | `schema:location` | `related` | `yr:related` (sorted by id; an essay orbits the first) |
| `continuedAs` | `yr:continuedAs` | `github` | `yr:repos` (list) |
| `githubOrgs` | `yr:githubOrganization` | `notes` | `yr:notes` (list) |
| `event`, `venue` | `schema:superEvent [ schema:name ; schema:location ]` | `format`, `also`, `slides` | `yr:format`, `yr:alsoAt` (list), `yr:slides` |
| `video` | `schema:recordedIn` (below) | | |

The Atlas draws `bodies` plus GitHub repos: `authored[]` are **filled** dots, `contributed[]` are
**hollow** (outline) dots. A repo listed in some body's `github` is drawn as that body, not twice.

`authored` means he wrote it, not that he owns it: a repo (his or an organization's) is authored
only when he is its top contributor, counting unlinked-email commits by name
(`contributors?anon=1`). Forks, whoever owns them, credit their activity to the parent as a
contribution. Repos under his account that are someone else's code (mirrors, imports, detached
copies) drop to `contributed` if he has activity there and off the site if not. `EXCLUDE` and
`OWN` in `github-data.mjs` override the test; a curated body's `github` list holds only repos that
belong to that body (no forks).
GitHub repos get the sector their language/topic suggests or a dedicated "Open source" sector — the
Atlas owner decides.

### Legend categories (toggleable)

`life`, `company`, `project`, `authored`, `contributed`, `writing`, `idea` (+ the contribution ring).
Clicking a legend item hides that category on the chart and dims the item; clicking again restores.
State is mirrored in the URL hash (`#show=company,project,life`) so slices are shareable, and is
exposed to the console via `window.atlas.setVisible(kinds)` / `window.atlas.highlight(ids)`.

## RDF vocabulary (`atlas.ttl`, `github.ttl`)

Base IRI `https://yrashk.com/atlas/` (bodies are `<https://yrashk.com/atlas/strata>`), prefixes:

```turtle
@prefix :       <https://yrashk.com/atlas/> .
@prefix yr:     <https://yrashk.com/ns#> .
@prefix schema: <https://schema.org/> .
@prefix xsd:    <http://www.w3.org/2001/XMLSchema#> .
@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .
@prefix ord:    <https://ontology.inferal.com/modules/ordering/> .   # atlas.ttl only
```

- Person `:yrashk a schema:Person ; schema:name ; schema:birthDate "1981"^^xsd:gYear ; schema:birthPlace :ukraine ;
  yr:homes ( :redwood-city :comox ) ; yr:defaultLocation :comox ; yr:stay [ … ]`. Homes in SPARQL:
  `:yrashk yr:homes/rdf:rest*/rdf:first ?home`.
- Stays: `[ a yr:Stay ; yr:place :bangkok ; schema:startDate "2026-11-22"^^xsd:date ; schema:endDate "2026-12-07"^^xsd:date ]`
  (`yr:place` must have a `yr:timeZone`). Dates are days in that place's own calendar; `endDate` is inclusive and
  optional. The current stay is the latest one that has started; its end ends it only when the next stay does not
  begin the day after, so travel days never fall back to `yr:defaultLocation`. The top-bar clock (`app/clock.js`)
  applies that rule in the visitor's browser: the current place is underlined, and a place that is not a home gets
  its own clock in front of the homes. The Lab's "Where he is" preset marks today's stay with `NOW()`.
- Kinds → classes: `yr:LifeEvent` (also `schema:Event`), `yr:Company` (also `schema:Organization`), `yr:Project`
  (also `schema:CreativeWork`), `yr:Essay` (also `schema:BlogPosting`), `yr:Talk` (also `schema:Event`), `yr:Idea`,
  `yr:Repository` (also `schema:SoftwareSourceCode`; a curated `oss` body, or a GitHub repo in `github.ttl`).
- Body properties: the table above. `yr:continuedAs` is the body this one continued as — e.g. `:omnigres
  yr:continuedAs :inferal`; the Atlas draws it as a curved arrow in the company layer.
- Role links from the person: `:yrashk yr:founded <company>` (or `yr:workedAt`, with `yr:role` e.g. `"employee"`),
  `yr:built <project>`, `yr:wrote <essay>`, `yr:authored <repo>`, `yr:contributedTo <repo>`, `yr:lived <life-event>`,
  `yr:presented <talk>`, `yr:shelved <idea>`. A curated `oss` body he wrote before GitHub (SourceForge, CLiki) is
  `yr:authored` with `yr:role "author"` and drawn filled; other `oss` bodies are `yr:contributedTo`.
- Talks: `schema:startDate` (when known; else `yr:start` + a fractional `yr:chartYear`), `schema:superEvent [ a
  schema:Event ; schema:name ; schema:location ]`, `yr:format` (e.g. `"panel"`), `yr:alsoAt ( … )` (other events it
  was given at), `yr:slides`, and the recording, `schema:recordedIn [ a schema:VideoObject ; schema:url ; … ]`:
  a YouTube `watch?v=` URL (the desktop gets `video.yt`) or a page elsewhere (`video.href`, with `yr:host`).
  `yr:startOffset` / `yr:endOffset` (seconds) cut one talk out of a longer stream and `yr:cut true` says it was
  cut; `yr:seconds` is the length. No recording means no public video; `schema:url` then points at the talk's page.
  A whole event stream lives on its event's body (e.g. `:pgext`): its recording has `schema:name`,
  `schema:startDate`, `schema:location`, `yr:streamFrom` (where it starts) and `schema:hasPart [ a schema:Clip ;
  schema:startOffset ; yr:speaker ; schema:name ; yr:talk ]`, one per talk (`yr:talk` names the talk body when it's
  his). A talk cut from that stream has `yr:stream :pgext`; the player then offers "watch the whole day" at the same
  moment, and the Atlas inspector "Watch the day". The Talks window (writing workspace) draws them as a timeline;
  the floating player (`/player.js`, also on every reader page) plays them and resumes across page loads from
  `sessionStorage["yr-player"]`.
- Repos (`github.ttl`): IRI `:repo/<owner>/<name>`; `schema:codeRepository` (GitHub URL), `schema:programmingLanguage`,
  `yr:stars`, `yr:organization` (owner login), `yr:body` (the curated body it is drawn as), and one activity node
  per active year: `<repo> yr:activity [ yr:year "2012"^^xsd:gYear ; yr:contributions 188 ]`.

### Contributions (`data/contributions.ttl`, from `github-detail.json`)

Kept apart so the core graph stays small; the console loads it after `atlas.ttl` + `github.ttl`, in the background, into the same graph.

- `yr:PullRequest` (also `schema:CreativeWork`), IRI `:repo/<owner>/<name>/pull/<n>`; `yr:Issue`, IRI `…/issues/<n>`.
- Properties: `yr:repository <repo>`, `yr:number`, `schema:name` (title), `yr:state` (`"merged"` | `"open"` | `"closed"`),
  `schema:dateCreated` (`xsd:date`), `schema:url` (the GitHub link).
- `:yrashk yr:opened <pr|issue>`; repositories that appear only here (PRs or issues, no counted commits) get a
  `yr:Repository` node with `schema:name` / `schema:codeRepository` and `:yrashk yr:contributedTo` it.
- Commit days: `<repo> yr:commitDay [ schema:startDate "2013-10-01"^^xsd:date ; yr:commits 1 ]`.

### Strava activities (`data/strava.ttl`, `strava.js`, `strava-tracks.json`)

Made by `scripts/strava-rdf.mjs` from a Strava bulk export (Settings → My Account → Download or
Delete Your Account → Request Your Archive): `npm run strava` picks the newest `~/Downloads/export_*.zip`
(or pass a path: `npm run strava -- path/to/export.zip`); `npm run strava:update` also builds and checks.
Zone offsets come from a secret `seed` in `.strava-private.json` (created on first run; keep it), so a
re-import of the same export reproduces the same routes, and versions in git history cannot be overlaid.
`npm run strava:seal` encrypts `.strava-private.json` with a password (AES-256-GCM, scrypt) into the committed
`strava-private.sealed.json`; `npm run strava:unseal` restores it on another machine. The importer refuses to
run (and mint a new seed) when the sealed file exists but the private file does not. Only
`activities.csv` and `activities/*` (GPX, TCX, FIT, gzipped or not) are read. The zip is never
committed; the three outputs are, and CI does not regenerate them. `--empty` writes the no-data
placeholders (`window.STRAVA = null`, which hides the Strava presets).

Privacy, by construction: no names, descriptions, notes, gear, photos, heart rate, calories or Strava
ids (activities are numbered by local date instead: `:strava/2025-06-14-1` is the first that day);
times only to the local hour; a place only as the nearest Atlas place within 60 km; every route loses
its first and last kilometre, splits at GPS jumps, and drops points inside the private zones listed in
`.strava-private.json` (gitignored: `{"trim": 1000, "zones": [{"lat", "lon", "radius"}], "exclude": [strava ids]}`).
If the export carries a visibility column, only activities visible to everyone are kept.

- `yr:Activity` (also `schema:ExerciseAction`), IRI `<https://yrashk.com/atlas/strava/<day>-<n>>`; `:yrashk yr:did <activity>`.
- `schema:exerciseType` (Strava's type: `"Ride"`, `"Run"`, …), `schema:startDate` (`xsd:date`, local), `yr:hour`
  (local hour, 0–23), `yr:distance` (metres, decimal), `yr:movingTime` / `yr:elapsedTime` (seconds),
  `yr:elevationGain` (metres, decimal), `schema:location` (an Atlas place, when within 60 km).
- `strava.js`: `window.STRAVA = {generated, fields, types, places, acts: [[day, hour, typeIndex, metres, seconds, climb, placeIndex, hasRoute]]}`.
- `strava-tracks.json`: `{tracks: [[activityId, encodedPolyline, …]]}` (Google polyline, precision 5,
  Douglas–Peucker at 15 m), read only when the console's Map view first opens.

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
core Atlas; `null` skips it), `stravaUrl` (default `strava.ttl`, loaded third; `null` skips it and hides the
"activities" presets — the shell passes `null` while `window.STRAVA` is null), `tracksUrl` (default
`strava-tracks.json`, for the Map view), `codemirror: false` (plain textarea editor). The editor is CodeMirror 6 vendored
at `app/vendor/codemirror.js` (lazy-imported; the textarea is the fallback) with a Vim toggle
(`localStorage["yr-vim"]`; `:w` / `:run` run, `:q` leaves) and an autorun toggle (`localStorage["yr-autorun"]`,
on by default: a parsed query runs ~320 ms after the last edit under a 150 ms budget; SPARQL Update never
autoruns). Completion (Ctrl-Space or as you type): prefixes (the six above plus owl/foaf/dcterms/dc/skos/geo/prov/sh,
declared automatically when used), terms from the loaded store ranked by use and by position (classes after
`a`, properties after a subject or `;`, individuals/datatypes in object position), variables already in the
query, keywords and built-ins with signatures. Keys typed in the editor do not bubble out of it. `api.run()`
resolves to the result.

Result views: **Table**, **Graph**, **Chart** and **Map** (plus Vocabulary and Inspect). Chart draws a SELECT
as bars: a `year`/`hour`/`month` column (or a date) is an ordered x axis with gaps filled, else the first
non-numeric column becomes horizontal bars, largest first; a second non-numeric column stacks series (eight
hues in fixed order by name, the rest folded into "other"; palette validated for both themes); each numeric
column is a measure chip. Map draws the routes of the activities in a result (bright) over every other
route (faint), plus Atlas places with `schema:geo`, over OpenStreetMap's standard raster tiles (toned per theme with a
canvas filter, attribution shown, light use per the OSM tile policy; `tiles: null` turns them off); routes far apart
are grouped into regions (chips, busiest first). A preset may name its default `view`.

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
