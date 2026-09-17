// Generates assets/streak-{dark,light}.svg — the §05 continuity plate.
// Matches the hand-authored dossier design tokens; no third-party widgets.
// Run by .github/workflows/profile-3d.yml with GITHUB_TOKEN in env.

import { writeFileSync, mkdirSync } from "node:fs";

// Deliberately not USERNAME: that collides with a built-in on Windows shells.
const USER = process.env.PROFILE_USER || process.env.GITHUB_REPOSITORY_OWNER;
if (!USER) throw new Error("PROFILE_USER or GITHUB_REPOSITORY_OWNER is required");
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

const THEME = {
  dark: {
    bg: "#0D1117", frame: "#30363D", hair: "#21262D",
    body: "#E6EDF3", muted: "#8B949E", faint: "#6E7681", accent: "#7C6CFF",
  },
  light: {
    bg: "#FFFFFF", frame: "#D0D7DE", hair: "#D8DEE4",
    body: "#1F2328", muted: "#656D76", faint: "#8C959F", accent: "#6A57F5",
  },
};

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-streak-plate",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const iso = (d) => d.toISOString().slice(0, 10);

async function collectDays() {
  const { user } = await gql(
    `query($login:String!){user(login:$login){createdAt}}`,
    { login: USER }
  );
  // Floor to midnight: starting at the creation timestamp would drop any
  // contributions made earlier on the account's first day.
  const start = new Date(`${user.createdAt.slice(0, 10)}T00:00:00Z`);
  const now = new Date();
  const days = new Map();

  // The contributions calendar caps at one year per query, so walk it in windows.
  for (let from = new Date(start); from < now; from.setUTCFullYear(from.getUTCFullYear() + 1)) {
    const to = new Date(from);
    to.setUTCFullYear(to.getUTCFullYear() + 1);
    to.setUTCSeconds(to.getUTCSeconds() - 1);
    const data = await gql(
      `query($login:String!,$from:DateTime!,$to:DateTime!){
         user(login:$login){contributionsCollection(from:$from,to:$to){
           contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`,
      { login: USER, from: from.toISOString(), to: (to > now ? now : to).toISOString() }
    );
    for (const w of data.user.contributionsCollection.contributionCalendar.weeks)
      for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
  }
  return days;
}

function computeStats(days) {
  const dates = [...days.keys()].sort();
  const total = [...days.values()].reduce((a, b) => a + b, 0);
  const activeDays = [...days.values()].filter((n) => n > 0).length;

  let longest = 0, run = 0, runStart = null, longestStart = null, longestEnd = null;
  for (const d of dates) {
    if (days.get(d) > 0) {
      if (run === 0) runStart = d;
      run++;
      if (run > longest) { longest = run; longestStart = runStart; longestEnd = d; }
    } else run = 0;
  }

  // Current streak: today having no commits yet does not break it.
  const today = iso(new Date());
  let current = 0, currentStart = null, first = true;
  for (const d of [...dates].reverse()) {
    if (d > today) continue;
    if (days.get(d) > 0) { current++; currentStart = d; }
    else if (!(first && d === today)) break;
    first = false;
  }

  return { total, activeDays, longest, longestStart, longestEnd, current, currentStart,
           since: dates[0], asOf: today };
}

// Outlined flame with a solid core, drawn in the accent colour. Stroke weight
// matches the header's corner brackets so it reads as dossier line-work.
function flame(x, y, scale, accent) {
  return `  <g transform="translate(${x},${y}) scale(${scale})">
    <path d="M12 22c-3.3 0-6-2.7-6-6 0-2.2 1.2-4.1 2.3-5.6C9.6 8.6 10.5 7.2 10.5 5.5c0-.5.6-.8 1-.5C14 6.7 18 10.3 18 16c0 3.3-2.7 6-6 6z" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linejoin="round"></path>
    <path d="M12 22c-1.7 0-3-1.3-3-3 0-1.3.8-2.3 1.5-3.1.4-.5.8-1 .8-1.6 0-.4.5-.6.8-.3 1 .9 2.9 2.7 2.9 5 0 1.7-1.3 3-3 3z" fill="${accent}" opacity="0.85"></path>
  </g>`;
}

function plate(s, t) {
  const cells = [
    { x: 32, label: "CURRENT STREAK", value: s.current, unit: "DAYS",
      sub: s.current ? `SINCE ${s.currentStart}` : "NO ACTIVE RUN", accent: true },
    { x: 344, label: "LONGEST UNBROKEN RUN", value: s.longest, unit: "DAYS",
      sub: s.longest ? `${s.longestStart} &#8594; ${s.longestEnd}` : "&#8212;", accent: false },
    { x: 656, label: "TOTAL LOGGED", value: s.total, unit: "",
      sub: `ACROSS ${s.activeDays} ACTIVE DAYS`, accent: false },
  ];

  const body = cells.map((c) => {
    const lx = c.x + 34;
    const numFill = c.accent ? t.accent : t.body;
    const unit = c.unit
      ? `<tspan dx="8" font-size="11" letter-spacing="2" fill="${t.muted}">${c.unit}</tspan>`
      : "";
    return `  <text x="${lx}" y="80" font-family="${MONO}" font-size="10" letter-spacing="2.4" fill="${t.faint}">${c.label}</text>
  <text x="${lx}" y="120" font-family="${MONO}" font-size="34" font-weight="700" fill="${numFill}">${c.value}${unit}</text>
  <text x="${lx}" y="140" font-family="${MONO}" font-size="9" letter-spacing="1.6" fill="${t.faint}">${c.sub}</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="190" viewBox="0 0 1000 190" role="img" aria-label="Continuity plate: current streak ${s.current} days, longest ${s.longest} days, ${s.total} total contributions">
  <rect x="1" y="1" width="998" height="188" rx="8" fill="${t.bg}" stroke="${t.frame}"></rect>
  <g font-family="${MONO}" font-size="11" letter-spacing="2.2" fill="${t.muted}">
    <text x="32" y="36">CONTINUITY OF ACTIVITY // SINCE ${s.since}</text>
    <text x="968" y="36" text-anchor="end">AS OF ${s.asOf}</text>
  </g>
  <line x1="32" y1="50" x2="968" y2="50" stroke="${t.frame}"></line>
${body}
${s.current > 0 ? flame(160, 92, 1.35, t.accent) : ""}
  <line x1="344" y1="66" x2="344" y2="150" stroke="${t.hair}"></line>
  <line x1="656" y1="66" x2="656" y2="150" stroke="${t.hair}"></line>
  <line x1="32" y1="156" x2="968" y2="156" stroke="${t.frame}"></line>
  <text x="32" y="176" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${t.muted}">CONTINUITY REASSESSED NIGHTLY &#183; SUBJECT REMAINS UNDER OBSERVATION</text>
</svg>
`;
}

const stats = computeStats(await collectDays());
mkdirSync("assets", { recursive: true });
writeFileSync("assets/streak-dark.svg", plate(stats, THEME.dark));
writeFileSync("assets/streak-light.svg", plate(stats, THEME.light));
console.log(
  `streak plate: current=${stats.current} longest=${stats.longest} total=${stats.total} active=${stats.activeDays}`
);
