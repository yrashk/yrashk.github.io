#!/usr/bin/env node
// Fetches GitHub activity for the site and writes it as data files.
//
//   node scripts/github-data.mjs [outDir]        (default outDir: site/data)
//
// Token: $GITHUB_TOKEN (set in GitHub Actions), else `gh auth token`.
// Writes:
//   github.json   full dataset (for the static generator)
//   github.js     same, as `window.GITHUB = …` (works over file://)
//   contrib.js    `window.CONTRIB = {total, days}` (last-year calendar, legacy shape)
//
// Dependency-free; needs Node 18+ (global fetch).

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOGIN = process.env.GITHUB_LOGIN || "yrashk";
// Repos to leave off the site entirely (owner/name, case-insensitive): forks
// tried once, experiments that don't represent the work.
const EXCLUDE = new Set(["ismatbabirli/pelmet", "yrashk/pelmet"]);
const FIRST_YEAR = 2008; // account created 2008-02-19
const outDir = process.argv[2] || "site/data";

const token =
  process.env.GITHUB_TOKEN ||
  (() => {
    try {
      return execSync("gh auth token", { encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  })();
if (!token) {
  console.error("github-data: no token (set GITHUB_TOKEN or log in with gh)");
  process.exit(1);
}

async function gh(path, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        authorization: `bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "yrashk.com-build",
        ...init.headers,
      },
    });
    if (res.ok) return res;
    if (attempt < 3 && (res.status >= 500 || res.status === 403)) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    throw new Error(`GitHub ${res.status} on ${path}: ${await res.text()}`);
  }
}

async function graphql(query, variables = {}) {
  const res = await gh("/graphql", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  // Items GitHub withholds (e.g. an org enforcing SSO/2FA policies on the token)
  // come back as null with FORBIDDEN errors; skip those rather than fail.
  const fatal = (body.errors ?? []).filter((e) => e.type !== "FORBIDDEN" || !body.data);
  if (fatal.length) throw new Error(JSON.stringify(fatal));
  if (body.errors) console.warn(`github-data: ${body.errors.length} item(s) withheld by GitHub (${body.errors[0].message.slice(0, 80)}…)`);
  return body.data;
}

async function restAll(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = await (await gh(`${path}${sep}per_page=100&page=${page}`)).json();
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

// ── profile + last-year calendar ────────────────────────────────────────────
const { user } = await graphql(
  `query($login: String!) {
    user(login: $login) {
      createdAt
      followers { totalCount }
      repositories(ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount }
      contributionsCollection {
        totalCommitContributions
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }`,
  { login: LOGIN },
);
const cal = user.contributionsCollection.contributionCalendar;
const days = cal.weeks.flatMap((w) => w.contributionDays.map((d) => [d.date, d.contributionCount]));

// ── per-year activity by repository ─────────────────────────────────────────
// Commits and pull requests per repo per year. Commits to one of our forks are
// credited to the fork's parent: that is where the work was aimed.
const REPO = `repository { nameWithOwner url description stargazerCount isFork isArchived
  owner { login } primaryLanguage { name } parent { nameWithOwner url description stargazerCount owner { login } primaryLanguage { name } } }
  contributions { totalCount }`;

const repos = new Map(); // nameWithOwner -> record
const detail = new Map(); // nameWithOwner -> { days: {date: commits}, prs: [], issues: [] }
const detailOf = (key) => {
  let d = detail.get(key);
  if (!d) detail.set(key, (d = { days: {}, prs: [], issues: [] }));
  return d;
};
function credit(r, year, count) {
  const target = r.isFork && r.owner.login === LOGIN && r.parent ? r.parent : r;
  const key = target.nameWithOwner;
  if (EXCLUDE.has(key.toLowerCase()) || EXCLUDE.has(r.nameWithOwner.toLowerCase())) return null;
  let rec = repos.get(key);
  if (!rec) {
    rec = {
      name: key,
      url: target.url ?? `https://github.com/${key}`,
      description: target.description ?? null,
      stars: target.stargazerCount ?? 0,
      language: target.primaryLanguage?.name ?? null,
      owner: target.owner.login,
      years: {},
    };
    repos.set(key, rec);
  }
  rec.years[year] = (rec.years[year] || 0) + count;
  return key;
}

const thisYear = new Date().getUTCFullYear();
for (let year = FIRST_YEAR; year <= thisYear; year++) {
  const data = await graphql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          commitContributionsByRepository(maxRepositories: 100) {
            ${REPO}
            days: contributions(first: 100, orderBy: { field: OCCURRED_AT, direction: DESC }) { nodes { occurredAt commitCount } }
          }
          pullRequestContributionsByRepository(maxRepositories: 100) { ${REPO} }
        }
      }
    }`,
    { login: LOGIN, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
  );
  const cc = data.user.contributionsCollection;
  for (const { repository, contributions, days } of cc.commitContributionsByRepository) {
    const key = credit(repository, year, contributions.totalCount);
    // Commit days (at most 100 per repo per year; counts above stay exact).
    if (key) for (const d of days.nodes) {
      const date = d.occurredAt.slice(0, 10);
      const dd = detailOf(key).days;
      dd[date] = (dd[date] || 0) + d.commitCount;
    }
  }
  for (const { repository, contributions } of cc.pullRequestContributionsByRepository) {
    credit(repository, year, contributions.totalCount);
  }
}

// ── pull requests and issues he opened, anywhere ────────────────────────────
// Listed in the Atlas inspector per repository (loaded lazily from github-detail.json).
async function authoredItems(field, extra) {
  const out = [];
  for (let after = null; ; ) {
    const data = await graphql(
      `query($login: String!, $after: String) {
        user(login: $login) {
          ${field}(first: 100, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
            pageInfo { hasNextPage endCursor }
            nodes { number title url state createdAt ${extra} repository { nameWithOwner isFork owner { login } parent { nameWithOwner } } }
          }
        }
      }`,
      { login: LOGIN, after },
    );
    const page = data.user[field];
    out.push(...page.nodes.filter(Boolean));
    if (!page.pageInfo.hasNextPage) return out;
    after = page.pageInfo.endCursor;
  }
}
const itemKey = (r) => (r.isFork && r.owner.login === LOGIN && r.parent ? r.parent.nameWithOwner : r.nameWithOwner);
const STATE = { MERGED: "merged", OPEN: "open", CLOSED: "closed" };
for (const pr of await authoredItems("pullRequests", "merged")) {
  const key = itemKey(pr.repository);
  if (EXCLUDE.has(key.toLowerCase())) continue;
  detailOf(key).prs.push([pr.number, pr.title, pr.merged ? "merged" : STATE[pr.state], pr.createdAt.slice(0, 10)]);
}
for (const issue of await authoredItems("issues", "")) {
  const key = itemKey(issue.repository);
  if (EXCLUDE.has(key.toLowerCase())) continue;
  detailOf(key).issues.push([issue.number, issue.title, STATE[issue.state], issue.createdAt.slice(0, 10)]);
}

// ── authored repositories (owned, not forks) ────────────────────────────────
const owned = (await restAll(`/users/${LOGIN}/repos?type=owner&sort=created`)).filter(
  (r) => !r.fork && !EXCLUDE.has(r.full_name.toLowerCase()),
);

const authored = owned.map((r) => {
  const activity = repos.get(r.full_name);
  repos.delete(r.full_name);
  return {
    name: r.name,
    url: r.html_url,
    homepage: r.homepage || null,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    archived: r.archived,
    created: r.created_at.slice(0, 10),
    pushed: r.pushed_at.slice(0, 10),
    years: activity?.years ?? {},
  };
});

// Everything left lives under someone else's account or an organization.
const span = (years) => {
  const ys = Object.keys(years).map(Number).sort((a, b) => a - b);
  return { first: ys[0] ?? null, last: ys.at(-1) ?? null, total: ys.reduce((n, y) => n + years[y], 0) };
};
for (const a of authored) Object.assign(a, span(a.years));
const others = [...repos.values()].map((r) => ({ ...r, ...span(r.years) }));

// Organization repos where we are the top contributor are ours too (Omnigres,
// Flyology, PumpkinDB…). Only repos with real activity are worth an API call.
const MIN_LED_CHECK = 20;
for (const r of others) {
  if (r.total < MIN_LED_CHECK) continue;
  const res = await fetch(`https://api.github.com/repos/${r.name}/contributors?per_page=1`, {
    headers: { authorization: `bearer ${token}`, "user-agent": "yrashk.com-build" },
  });
  if (!res.ok) continue; // 204 for empty repos, 404 for gone ones
  const [top] = await res.json().catch(() => []);
  r.led = top?.login?.toLowerCase() === LOGIN.toLowerCase();
}

const led = others.filter((r) => r.led).map(({ led, ...r }) => ({ ...r, org: r.owner }));
const contributed = others
  .filter((r) => !r.led)
  .map(({ led, ...r }) => r)
  .sort((a, b) => a.first - b.first || b.total - a.total);
authored.push(
  ...led.map((r) => ({
    name: r.name,
    url: r.url,
    homepage: null,
    description: r.description,
    language: r.language,
    stars: r.stars,
    archived: false,
    created: null,
    pushed: null,
    org: r.org,
    years: r.years,
    first: r.first,
    last: r.last,
    total: r.total,
  })),
);

const dataset = {
  generated: new Date().toISOString(),
  login: LOGIN,
  profile: {
    since: user.createdAt.slice(0, 10),
    followers: user.followers.totalCount,
    publicRepos: user.repositories.totalCount,
  },
  lastYear: {
    total: cal.totalContributions,
    commits: user.contributionsCollection.totalCommitContributions,
    days,
  },
  authored,
  contributed,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "github.json"), JSON.stringify(dataset, null, 1) + "\n");
writeFileSync(
  join(outDir, "github.js"),
  `// Generated by scripts/github-data.mjs on ${dataset.generated}. Do not edit.\nwindow.GITHUB = ${JSON.stringify(dataset)};\n`,
);
// Per-repository contribution detail, keyed by "owner/name". Compact rows:
//   days:   [[date, commits], …] newest first; link: <repo>/commits?author=<login>&since=<date>&until=<date+1>
//   prs:    [[number, title, merged|open|closed, date], …] newest first; link: <repo>/pull/<number>
//   issues: [[number, title, open|closed, date], …];                      link: <repo>/issues/<number>
const detailOut = { generated: dataset.generated, login: LOGIN, repos: {} };
for (const [key, d] of [...detail].sort(([a], [b]) => a.localeCompare(b))) {
  detailOut.repos[key] = {
    days: Object.entries(d.days).sort(([a], [b]) => b.localeCompare(a)),
    prs: d.prs,
    issues: d.issues,
  };
}
writeFileSync(join(outDir, "github-detail.json"), JSON.stringify(detailOut) + "\n");

writeFileSync(
  join(outDir, "contrib.js"),
  `// Generated by scripts/github-data.mjs on ${dataset.generated}. Do not edit.\nwindow.CONTRIB = ${JSON.stringify({ total: cal.totalContributions, days })};\n`,
);

console.log(
  `github-data: ${authored.length} authored, ${contributed.length} contributed, ` +
    `${cal.totalContributions} contributions in the last year → ${outDir}`,
);
