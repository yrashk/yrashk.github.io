# Content dossier — yrashk.com redesign

Every prototype must use this REAL content. Do not invent projects, employers, numbers or quotes.
Where a design wants "live" data that we don't have (e.g. "now playing"), label it plainly as a
placeholder feed, or derive it honestly in JS (local clock in Comox, BC; days since a date, etc.).

## Who

- **Yurii Rashkovskii** — technologist, mostly software. Founder of **Inferal** (inferal.com).
- 30+ years of professional experience. Ukrainian-born; lives in **Redwood City, CA** and **Comox, BC** (Vancouver Island). Both are home. Timezones America/Los_Angeles + America/Vancouver.
- Husband and father (copy: "his wife and children" — no number, no names). Running, skiing, cycling, outdoors; "trying to figure out sailing".
- Starting to have gray hair. (Do NOT use the label "thoughtful oddball" anywhere.)
- Belief (paraphrase, can be used as a manifesto line): computers evolve better when we stop doing
  dreadful things to them and do inspired work instead. Keen interest in **reducing complexity**.
- Languages these days: C/C++, PL/pgSQL, Ada, Rust; occasionally OCaml, Prolog/Logtalk. Also knows JS, Ruby, Zig, Java, Python, Erlang/Elixir.
  "I like languages that change or augment the way I think about programming."
- Stands with Ukraine (the old site had a banner; keep a small, dignified 🇺🇦 mark somewhere).

Links: github.com/yrashk · twitter.com/yrashk · linkedin.com/in/yrashk · mailto:yrashk@gmail.com · GitHub Sponsors: github.com/sponsors/yrashk
Photo: `data/yrashk.jpeg` (square headshot on a magenta/pink wall — the old brand pink was #D63964; you may keep or drop it).

## Now (2026) — projects

| Project | URL | One-liner | Notes |
|---|---|---|---|
| **Inferal** | https://inferal.com | "Software is eating your business." Data infrastructure that replaces custom glue software with live, governed decision logic. | Founder. Products: Relay (data movement), Data Platform, Operational Models (ontologies), Ontosome (catalog of ontology modules). Line: "Data should summon agents — not the other way around." Team: Yurii (founder), Jeremy Tregunna, Mehdi Akiki. |
| **Strata** | https://yrashk.com/strata | A prototype 64-bit ISA where **memory is explicit I/O**. | RTL, C emulator with JITs, StrataOS microkernel (written in Strata asm), Strata Forth, browser playground. Local Stores not caches (64 KiB per core), transfers with completion tags (`tget`/`tput`/`tany`), linear capabilities, no interrupts. "The machine shows through instead of being hidden." Status: active, pushed today. |
| **libycxx** | https://libycxx.org | An independent C++26 standard library. | v0.1.0. Freestanding core + hosted lib, `import std;`. 2,824 spec-derived tests + 17,098 external libc++/libstdc++ tests run unmodified; 19 real-world projects built against it. "There is no list of tolerated failures." Implemented by AI agents directed by the author. |
| **Flyology** | https://flyology.org | Systems foundations for Ada. | Name from Ada Lovelace's planned book *Flyology*: "A study of flight, revisited." Two task lanes (native + lightweight). Libraries: HTTP, Postgres, QUIC, JSON, RDF, SIMD, TUI, NUMA, Cachelines, Allocators. |
| **Shutters** | https://shutte.rs | "A quiet place for your photographs." | A private, invite-only photo archive built for his family and now ready for friends. (Don't mention EXIF or themes/views.) |
| **abtop** | github.com/yrashk/abtop | Like htop, but for AI coding agents. | Monitors Claude Code & Codex CLI sessions, tokens, context window, rate limits. |
| **uplpgsql** | github.com/yrashk/uplpgsql | WIP JIT-compiled PL/pgSQL. | |
| **pgext.day** | https://pgext.day | Postgres Extensions Day. | Organized; first edition Montreal, May 12 2025. |

## Previously

- **Omnigres** (2022–2025, continued as **Inferal**) — "Postgres as a Platform": Postgres as a complete application runtime (HTTP server inside Postgres, etc.). github.com/omnigres/omnigres, ~1.6k ★.
- **HackerIntro** (2021–2023) — Resume Search: crawled & indexed developer resumes 24/7. Shut down.
- **Trustatom / Streamline.vc** (2014–2015) — Bitcoin-based smart contracts; later startup data assurance for investors.
- **Bex.io** (2013–2014) — Bitcoin exchange as a service.
- **Spawngrid** (2011–2013, continued as **Bex.io**) — "A cloud for complex Erlang systems. Also built Test.io, a property testing solution, and ultimately became Bex.io" (verbatim).
- **Issues Done** (2007–2008) — web-based Getting Things Done app.
- Open source past: early **Elixir** contributor; **erlzmq2** (ZeroMQ for Erlang); conceived **graphql-java-annotations**; **wasm.rs**; Ruby on Rails & Turbo Rails contributions; **pgrx**, **pg_graphql**, Supabase **wrappers**, **libfyaml**; two small **Postgres** patches; git-paravendor.
- Ideas shelf: "Spicy" (a better C that is still 100% C), ParaOS (an application operating system), shell-scripting language compiled to Bash/Dockerfile, in-memory Postgres access method, libcrun VM shim, hands-free writing.

## Signal (real data)

- `data/contrib.js` sets `window.CONTRIB = {total: 18559, days: [["2025-11-09",3], ...]}` — 368 days of real GitHub
  contributions ending 2026-11-11 (max 597/day). 18,559 contributions in the last year; 8,630 commits.
  Load it with `<script src="data/contrib.js"></script>` (works over file://).
- GitHub: 342 public repos, 826 followers, account since 2008-02-19.

## Blog — MUST keep these exact URLs (paths are relative to site root)

| Date | Title | URL | Tags | Excerpt |
|---|---|---|---|---|
| 2025-02-26 | Postgres Extensions Day 2025 Montreal: Registration and Call for Speakers | /blog/2025/02/26/postgres-extensions-day-2025-montreal-registration-and-call-for-speakers/ | Postgres | On May 12th, 2025, the Postgres Extension Developers Coalition hosts a one-day, in-person event in Montreal. |
| 2023-07-20 | Omnigres Developer Experience | /blog/2023/07/20/omnigres-developer-experience/ | Omnigres, D3X | The most successful developer tools are usually the ones with an amazing developer experience. |
| 2023-04-23 | Structured Postgres Regression Tests | /blog/2023/04/23/structured-postgres-regression-tests/ | Postgres, Omnigres | As my tests became larger, I started getting lost in them. |
| 2023-04-10 | Avoiding Postgres Extensions Limitations | /blog/2023/04/10/avoiding-postgres-extensions-limitations/ | Postgres, tips | Postgres extensions are great, but there are edges in some of its features. |
| 2023-04-09 | Sum Types in Postgres | /blog/2023/04/09/sum-types-in-postgres/ | Postgres, Omnigres, types | A generalized mechanism for values that can be any of the given variants. |
| 2023-04-05 | PL/Rust Just Shipped: Easy Way to Try It Out | /blog/2023/04/05/plrust-just-shipped-easy-way-to-try-it-out/ | Postgres, Rust, Docker | PL/Rust 1.0.0 is out; here's a quick way to try it without the long setup. |
| 2023-04-04 | Make Postgres an Application Server, Gamified | /blog/2023/04/04/make-postgres-an-application-server-gamified/ | Postgres, Omnigres, contest | Can Postgres be a fully self-sufficient platform for your application? |
| 2023-02-16 | What happens if you put HTTP server inside Postgres? | /blog/2023/02/16/what-happens-if-you-put-http-server-inside-postgres/ | Postgres, Omnigres, performance | Benchmarks are attention-grabbers, but that's not what drew me to Omnigres. |
| 2023-01-07 | Why not Rust for Omnigres? | /blog/2023/01/07/why-not-rust-for-omnigres/ | Postgres, Omnigres, Rust, C | Reflecting on the complexity and inefficiencies plaguing business software. |
| 2017-09-04 | Solving Problems, One Commit at a Time | /blog/2017/09/04/solving-problems-one-commit-at-a-time/ | Git, C4, practices | My commit messages changed considerably — they no longer look typical. |
| 2014-04-21 | Team Uncommunication | /blog/2014/04/21/team-uncommunication/ | practices, teamwork | The art of silence — two friends, a canoe, a lake on Vancouver Island. |

Note: the git history of this very site uses "Problem: …" commit messages (C4 style) — a nice
oddball detail (e.g. "Problem: blog menu is rendered as Index", "Problem: CI build fails").

## Sample article for the article template

Use the opening of "What happens if you put HTTP server inside Postgres?" (2023-02-16):

> Benchmarks and performance claims are attention-grabbers, but that's not what drew me to work on
> Omnigres. When I first built a prototype of its HTTP server, I didn't foresee the desire to share
> the numbers. As we all know, getting benchmarks right is hard, and everybody's mileage may vary. But
> I'll show you some numbers here anyway. It'll be great to validate or invalidate my findings!
>
> But first, what's Omnigres? The shortest definition I came up with is "Postgres as a Platform."
>
> What do I mean by this? Well, this comes from the idea that much of your application and its
> infrastructure can live inside or next to Postgres. Your business logic, deployment orchestration,
> caching, job queues, API endpoints, form handlers, HTTP server, you name it. Instead of building a
> system composed of multiple services, you only need one server that takes care of it.

```sql
select omni_httpd.http_response(headers => array[omni_httpd.http_header('content-type', 'text/html')],
       body => 'Hello, <b>' || users.name || '</b>!'), 1 as priority
  from request
  inner join users on string_to_array(request.path,'/', '') = array[NULL, 'users', users.handle]
union
select omni_httpd.http_response(status => 404, body => json_build_object('method', request.method,
       'path', request.path, 'query_string', request.query_string)), 0 as priority
  from request
order by priority desc
```

Include an "Outdated API" admonition (the article has one) — the template must handle admonitions,
code blocks, inline code, links, headings, and footnotes gracefully.

## Notes (new section — seed entries, short, clearly sample)

The new site should have a "notes" stream (short-form, digital-garden style). Seed with a few
plausible short notes drawn ONLY from facts above, e.g. "Strata: timers are just reads that complete
at a deadline", "libycxx: tests derived from the draft, never weakened to fit", "Shutters: building
software for an audience of four", "Learning to sail: the boat is a state machine with weather as input".
Mark them as sample copy in an HTML comment.

---

## Persona & curation (added after first review — takes precedence over the lists above)

Yurii's direction: **don't list everything.** The site must show he is not "just a programmer" but a
**founder/business person, a thinker and writer, and someone who loves branding and marketing.**
Curate hard: fewer items, chosen and framed, over exhaustive catalogs.

Four facets (use them as the organizing idea of About/Now, not as a cheesy "I wear many hats" list):

1. **Founder / operator** — founded and ran companies since 2007: Issues Done, Spawngrid (NRC IRAP funded),
   Bex.io (raised seed), Trustatom → Streamline.vc (raised money, pivoted), HackerIntro, Omnigres, now **Inferal**.
   Organizer of Postgres Extensions Day (pgext.day, Montreal 2025) — community building.
   Inferal's thesis is a business thesis, not a tech one: "Software is eating your business." /
   "Your systems know what happened. Inferal determines what happens next." / "Data should summon agents —
   not the other way around." / "Models that run your business." Inferal blog: "Time Is Part of the Business Logic".
   His own words on why he does startups (real, from the old site):
   > "It's very raw, in a sense. You get what you put in, multiplied by the luck factor. Generally, no safety net.
   > You're responsible for what happens."
   Honest about failure (the old site candidly lists shut-down ventures and the price tags their domains now sell for) —
   that candor is a brand trait worth keeping, lightly.
2. **Thinker / writer** — essays on how people and systems work, not only Postgres how-tos:
   - "Team Uncommunication" (2014): two friends in a canoe on Vancouver Island; what fixed it was a *steering
     agreement*, not more communication — "we didn't need to communicate our paddling at all!"
   - "Solving Problems, One Commit at a Time" (2017): every commit is a Problem/Solution statement (C4);
     this very site's history still reads "Problem: …".
   - "Why not Rust for Omnigres?" (2023): reflecting on "the complexity and inefficiencies plaguing modern business software".
   - Ideas shelf as thinking-in-public: ParaOS ("what if we built an operating system for these applications?"),
     Spicy ("a Better C that is still 100% C").
   The writing archive is small; present it as a curated set of essays + a notes stream, not a blog dump.
   Feature 3–4 essays; the rest stays reachable (all 11 URLs must still resolve) but needn't be on the front.
3. **Brand & marketing** — he loves naming, identity and positioning, and his projects show it:
   names (Shutters at shutte.rs;
   Flyology from Ada Lovelace's planned book; Strata; Inferal; Ontosome), copy ("A quiet place for your photographs.",
   "Memory is explicit I/O.", "There is no list of tolerated failures."),
   and each project site has its own distinct identity (libycxx is a "spec sheet"). He also collects good domains (wasm.rs, saveonkids.com/.ca).
   The site itself should feel like brand work: projects presented as brands (name, one-line positioning, voice),
   not repos.
4. **Builder** — the technical depth is real (Strata ISA, libycxx, Flyology, Omnigres, early Elixir), but it is one facet.

Curation guidance: lead with Inferal + 4–5 signature projects; past ventures as a compact founder track record;
OSS contributions collapse to a single line or a few highlights (Elixir early contributor, Omnigres, pgrx) —
drop the long list. Also from the old site: he built PumpkinDB (2017, referenced in the commit essay).

**Archive policy (latest):** most old-site information is being removed. Old blog posts keep resolving at their
URLs but are *unlisted by default*; Yurii will pick which, if any, to list. Prototypes show only a small curated
"listed" set plus notes. The rest is reachable by URL (and at most via a quiet launcher/terminal "archive").

**Born 1981** (Ukraine). The Atlas spans 1981 → now: the birth year is the outer rim.

**Excluded:** Pelmet (a fork he tried; not his project). Never show it.
**Life events:** first job in 1999 (he wrote software before that; "Thirty-odd years" stays); moved to Canada in 2008; lived in Bangkok 2014–2019; working in San Francisco in 2026.

**Archive policy (supersedes the above):** posts are LISTED by default; Yurii unlists individual posts with `listed: false`. Posts are Markdown (raw HTML allowed), converted at build time.

**Branding facet (verbatim, Now window):** "Naming is one of the hardest and most fascinating pastimes. I am proud of some names I found – even though my taste has changed over time."
**Builder facet (verbatim):** "Relentlessly experimenting at work. Recent open source: Strata, an ISA where memory is explicit I/O; libycxx, a C++26 standard library; Flyology for Ada."
**Manifesto (verbatim, replaces the old one):** "Technology is most fascinating when you get it to do new things, unlocking all this _raw potential_, instead of fixing up something that has stopped working long ago."
**Founder facet (verbatim):** "Built a few companies since 2007; now Inferal. Learned a lot – some things change and some never do."
**Startup quote (verbatim, replaces the old one):** "It's my way of converting a calling into a lifelong job – I want to see a change come through digested glass." — on why startups
**No Mastodon** link anywhere (he does not use it).
