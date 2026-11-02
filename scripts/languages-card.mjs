// Builds languages.svg: top languages you've committed in, weighted by commit count.
// Runs in GitHub Actions (see .github/workflows/languages.yml). Needs GITHUB_TOKEN.
import { writeFileSync } from "node:fs";

const token = process.env.GITHUB_TOKEN;
const login = process.env.GH_USER || "piyushg-07";
const out = process.env.OUT || "languages.svg";
if (!token) throw new Error("GITHUB_TOKEN is required");

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const YEAR_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      commitContributionsByRepository(maxRepositories: 100) {
        repository { primaryLanguage { name color } }
        contributions { totalCount }
      }
    }
  }
}`;

export async function collect() {
  const { user } = await gql(`query($login: String!) { user(login: $login) { createdAt } }`, { login });
  const totals = new Map();
  const now = Date.now();
  // contributionsCollection spans at most one year per query
  for (let from = new Date(user.createdAt).getTime(); from < now; ) {
    const to = Math.min(from + 365 * 864e5 - 1000, now);
    const data = await gql(YEAR_QUERY, {
      login,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    });
    for (const { repository, contributions } of data.user.contributionsCollection.commitContributionsByRepository) {
      const lang = repository.primaryLanguage;
      if (!lang) continue;
      const prev = totals.get(lang.name) ?? { name: lang.name, color: lang.color ?? "#8b949e", count: 0 };
      prev.count += contributions.totalCount;
      totals.set(lang.name, prev);
    }
    from = to + 1000;
  }
  return [...totals.values()].sort((a, b) => b.count - a.count);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (n) => (n === "Jupyter Notebook" ? "Jupyter" : n.length > 10 ? n.slice(0, 9) + "…" : n);
const pct = (p) => (p < 0.1 ? "<0.1%" : `${p.toFixed(1)}%`);

export function render(all) {
  // Narrow card, same height as the summary-cards stats card (200) so they sit side by side.
  const W = 270, H = 200, PAD = 18, COLS = 2, ROW = 26, LIST_Y = 96, MAX = 8;
  const total = all.reduce((n, l) => n + l.count, 0) || 1;
  let langs = all.slice(0, MAX);
  if (all.length > MAX) {
    const rest = all.slice(MAX - 1).reduce((n, l) => n + l.count, 0);
    langs = [...all.slice(0, MAX - 1), { name: "Other", color: "#565f89", count: rest }];
  }
  const colW = (W - PAD * 2) / COLS;
  const barW = W - PAD * 2;

  let x = PAD;
  const bar = langs
    .map((l) => {
      const w = (l.count / total) * barW;
      const seg = `<rect x="${x.toFixed(2)}" y="54" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("");

  const items = langs
    .map((l, i) => {
      const cx = PAD + (i % COLS) * colW;
      const cy = LIST_Y + Math.floor(i / COLS) * ROW;
      return `<g transform="translate(${cx.toFixed(2)} ${cy})"><circle cx="4" cy="-4" r="4" fill="${l.color}"/><text x="13" y="0" class="n">${esc(short(l.name))}</text><text x="${(colW - 10).toFixed(2)}" y="0" class="p" text-anchor="end">${esc(pct((l.count / total) * 100))}</text></g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Top languages">
<style>
  text { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; }
  .t { font-size: 15px; font-weight: 600; fill: #70A5FD; }
  .n { font-size: 11px; fill: #A9B1D6; }
  .p { font-size: 11px; fill: #787C99; }
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="#1A1B27"/>
<text x="${PAD}" y="34" class="t">Top Languages</text>
<clipPath id="bar"><rect x="${PAD}" y="54" width="${barW}" height="8" rx="4"/></clipPath>
<g clip-path="url(#bar)">${bar}</g>
${items}
</svg>
`;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("languages-card.mjs")) {
  const langs = await collect();
  writeFileSync(out, render(langs));
  console.log(`Wrote ${out}: ${langs.map((l) => `${l.name} ${l.count}`).join(", ")}`);
}
