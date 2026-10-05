// Generates assets/activity-plate-{dark,light}.svg — the §05 pattern-of-life plate.
// Redraws the hand-authored geometry with live numbers; nothing here is hardcoded
// except the layout itself. Run by .github/workflows/profile-3d.yml.

import { writeFileSync, mkdirSync } from "node:fs";

const USER = process.env.PROFILE_USER || process.env.GITHUB_REPOSITORY_OWNER;
if (!USER) throw new Error("PROFILE_USER or GITHUB_REPOSITORY_OWNER is required");
// PROFILE_TOKEN (a PAT) wins when present: the default GITHUB_TOKEN is scoped to
// this repository and may not be able to read commit history from the others.
const TOKEN = process.env.PROFILE_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("PROFILE_TOKEN or GITHUB_TOKEN is required");

const TZ = 1; // Africa/Tunis is UTC+1 year-round, no DST
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const THEME = {
  dark: {
    bg: "#0D1117", frame: "#30363D", grid: "#21262D",
    body: "#E6EDF3", muted: "#8B949E", faint: "#6E7681", accent: "#7C6CFF",
  },
  light: {
    bg: "#FFFFFF", frame: "#D0D7DE", grid: "#D8DEE4",
    body: "#1F2328", muted: "#656D76", faint: "#8C959F", accent: "#6A57F5",
  },
};

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-activity-plate",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const r2 = (n) => Math.round(n * 100) / 100;
const hh = (h) => String(h).padStart(2, "0");

async function listRepos() {
  const out = [];
  let cursor = null;
  do {
    const d = await gql(
      `query($login:String!,$cursor:String){user(login:$login){
         repositories(first:100,after:$cursor,ownerAffiliations:[OWNER],isFork:false){
           pageInfo{hasNextPage endCursor}
           nodes{name stargazerCount defaultBranchRef{name}}}}}`,
      { login: USER, cursor }
    );
    const page = d.user.repositories;
    out.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

async function commitsByHour(authorId, since, until, repos) {
  const hours = new Array(24).fill(0);
  for (const repo of repos) {
    if (!repo.defaultBranchRef) continue;
    let cursor = null;
    do {
      const d = await gql(
        `query($owner:String!,$name:String!,$since:GitTimestamp!,$until:GitTimestamp!,$id:ID!,$cursor:String){
           repository(owner:$owner,name:$name){defaultBranchRef{target{... on Commit{
             history(first:100,after:$cursor,since:$since,until:$until,author:{id:$id}){
               pageInfo{hasNextPage endCursor} nodes{committedDate}}}}}}}`,
        { owner: USER, name: repo.name, since, until, id: authorId, cursor }
      );
      const h = d.repository?.defaultBranchRef?.target?.history;
      if (!h) break;
      for (const c of h.nodes) {
        const d0 = new Date(c.committedDate);
        hours[(d0.getUTCHours() + TZ) % 24]++;
      }
      cursor = h.pageInfo.hasNextPage ? h.pageInfo.endCursor : null;
    } while (cursor);
  }
  return hours;
}

function niceStep(x) {
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) if (s >= x) return s;
  return 1000;
}

// Longest run of consecutive zero hours, allowing wrap past midnight.
function dormantWindow(hours) {
  let best = { len: 0, start: 0 };
  for (let s = 0; s < 24; s++) {
    if (hours[s] > 0) continue;
    let len = 0;
    while (len < 24 && hours[(s + len) % 24] === 0) len++;
    if (len > best.len) best = { len, start: s };
  }
  return best;
}

function plate(d, t) {
  const X0 = 66, SLOT = 22.75, BARW = 15, BASE = 262, MAXH = 156;
  const max = Math.max(...d.hours, 1);
  const scale = Math.min(6.5, MAXH / max);
  // Aim for three or four gridlines; max/4 reproduces the original 0/10/20.
  const step = niceStep(Math.max(1, Math.round(max / 4)));

  const grid = [];
  for (let v = 0; v * scale <= MAXH + 0.01; v += step) {
    const y = r2(BASE - v * scale);
    grid.push(
      `  <line x1="66" y1="${y}" x2="612" y2="${y}" stroke="${t.grid}"></line>
  <text x="56" y="${r2(y + 4)}" text-anchor="end" font-family="${MONO}" font-size="10" fill="${t.faint}">${v}</text>`
    );
  }

  const peak = d.hours.indexOf(max);
  const bars = d.hours.map((v, i) => {
    const x = r2(X0 + i * SLOT + (SLOT - BARW) / 2);
    if (v === 0)
      return `  <rect x="${x}" y="${BASE - 2}" width="${BARW}" height="2" fill="${t.grid}"></rect>`;
    const h = r2(v * scale);
    const y = r2(BASE - h);
    const isPeak = i === peak;
    const fill = isPeak
      ? `fill="${t.accent}"`
      : `fill="${t.accent}" opacity="0.72"`;
    const label = isPeak
      ? `\n  <text x="${r2(X0 + i * SLOT + SLOT / 2)}" y="${r2(y - 8)}" text-anchor="middle" font-family="${MONO}" font-size="10" font-weight="700" fill="${t.accent}">${v}</text>`
      : "";
    return `  <rect x="${x}" y="${y}" width="${BARW}" height="${h}" ${fill}></rect>${label}`;
  });

  const ticks = [0, 6, 12, 18, 23].map(
    (i) =>
      `  <text x="${r2(X0 + i * SLOT + SLOT / 2)}" y="282" text-anchor="middle" font-family="${MONO}" font-size="10" fill="${t.faint}">${hh(i)}</text>`
  );

  const rows = [
    { label: "PULL REQUESTS", value: d.prs },
    { label: "ISSUES", value: d.issues },
    { label: "STARS EARNED", value: d.stars },
    { label: "REPOS TOUCHED", value: d.repos },
  ].map((row, i) => {
    const y = 177 + i * 32.5;
    const rule = i < 3 ? `\n  <line x1="676" y1="${r2(y + 11.5)}" x2="952" y2="${r2(y + 11.5)}" stroke="${t.grid}"></line>` : "";
    return `  <text x="676" y="${r2(y)}" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${t.muted}">${row.label}</text>
  <text x="952" y="${r2(y + 2)}" text-anchor="end" font-family="${MONO}" font-size="19" font-weight="700" fill="${t.body}">${row.value}</text>${rule}`;
  });

  // A percentage off a handful of commits is noise, not signal — omit it.
  const delta = d.priorCommits >= 10
    ? Math.round(((d.commits - d.priorCommits) / d.priorCommits) * 100)
    : null;
  const deltaText = delta === null
    ? `PRIOR YEAR ${d.priorCommits}`
    : `PRIOR YEAR ${d.priorCommits} &#183; <tspan fill="${t.accent}">${delta >= 0 ? "+" : ""}${delta}%</tspan>`;

  const dw = dormantWindow(d.hours);
  const dormant = dw.len > 0
    ? `DORMANT ${hh(dw.start)}:00&#8211;${hh((dw.start + dw.len) % 24)}:00 &#183; `
    : "";
  const habit = peak >= 18 || peak <= 4
    ? "SUBJECT OPERATES AFTER DARK"
    : peak <= 11
      ? "SUBJECT OPERATES BEFORE NOON"
      : "SUBJECT OPERATES IN DAYLIGHT";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="340" viewBox="0 0 1000 340" role="img" aria-label="Activity plate: commits per hour of day and twelve-month totals">
  <rect x="1" y="1" width="998" height="338" rx="8" fill="${t.bg}" stroke="${t.frame}"></rect>
  <g font-family="${MONO}" font-size="11" letter-spacing="2.2" fill="${t.muted}">
    <text x="32" y="36">PATTERN OF LIFE // TRAILING 12 MONTHS &#183; UTC +01:00</text>
    <text x="968" y="36" text-anchor="end">AS OF ${d.asOf}</text>
  </g>
  <line x1="32" y1="50" x2="968" y2="50" stroke="${t.frame}"></line>
  <g font-family="${MONO}" font-size="10" letter-spacing="2.4" fill="${t.faint}">
    <text x="66" y="80">COMMITS PER HOUR</text>
    <text x="676" y="80">FIELD TOTALS</text>
  </g>
${grid.join("\n")}
${bars.join("\n")}
${ticks.join("\n")}
  <line x1="66" y1="262" x2="612" y2="262" stroke="${t.frame}"></line>
  <line x1="648" y1="66" x2="648" y2="286" stroke="${t.grid}"></line>
  <text x="676" y="126" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${t.muted}">COMMITS</text>
  <text x="952" y="128" text-anchor="end" font-family="${MONO}" font-size="26" font-weight="700" fill="${t.body}">${d.commits}</text>
  <text x="952" y="144" text-anchor="end" font-family="${MONO}" font-size="9" letter-spacing="1.6" fill="${t.faint}">${deltaText}</text>
  <line x1="676" y1="156" x2="952" y2="156" stroke="${t.grid}"></line>
${rows.join("\n")}
  <line x1="32" y1="306" x2="968" y2="306" stroke="${t.frame}"></line>
  <text x="32" y="326" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${t.muted}">${dormant}PEAK AT ${hh(peak)}:00 &#183; ${habit}</text>
</svg>
`;
}

const now = new Date();
const from = new Date(now);
from.setUTCFullYear(from.getUTCFullYear() - 1);
const priorFrom = new Date(from);
priorFrom.setUTCFullYear(priorFrom.getUTCFullYear() - 1);

const totals = await gql(
  `query($login:String!,$from:DateTime!,$to:DateTime!,$pFrom:DateTime!){user(login:$login){
     id
     current:contributionsCollection(from:$from,to:$to){
       totalCommitContributions totalPullRequestContributions
       totalIssueContributions totalRepositoriesWithContributedCommits}
     prior:contributionsCollection(from:$pFrom,to:$from){totalCommitContributions}}}`,
  { login: USER, from: from.toISOString(), to: now.toISOString(), pFrom: priorFrom.toISOString() }
);

const repos = await listRepos();
const hours = await commitsByHour(totals.user.id, from.toISOString(), now.toISOString(), repos);

const data = {
  hours,
  commits: totals.user.current.totalCommitContributions,
  priorCommits: totals.user.prior.totalCommitContributions,
  prs: totals.user.current.totalPullRequestContributions,
  issues: totals.user.current.totalIssueContributions,
  repos: totals.user.current.totalRepositoriesWithContributedCommits,
  stars: repos.reduce((a, r) => a + r.stargazerCount, 0),
  asOf: now.toISOString().slice(0, 10),
};

// The histogram reads other repositories, which a repo-scoped token may not see.
// Fail loudly rather than publish a flat chart that looks like genuine inactivity.
if (data.commits > 0 && hours.reduce((a, b) => a + b, 0) === 0)
  throw new Error(
    `contributionsCollection reports ${data.commits} commits but no commit history was readable. ` +
    `The token cannot see the repositories — set a PAT with repo read access as PROFILE_TOKEN.`
  );

mkdirSync("assets", { recursive: true });
writeFileSync("assets/activity-plate-dark.svg", plate(data, THEME.dark));
writeFileSync("assets/activity-plate-light.svg", plate(data, THEME.light));
console.log(
  `activity plate: commits=${data.commits} prior=${data.priorCommits} prs=${data.prs} issues=${data.issues} stars=${data.stars} repos=${data.repos} peak=${data.hours.indexOf(Math.max(...data.hours))}:00 hours=[${data.hours}]`
);
