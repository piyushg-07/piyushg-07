// Builds languages.svg: every language you've committed in, weighted by commit count.
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
const pct = (p) => (p < 0.1 ? "<0.1%" : `${p.toFixed(1)}%`);

export function render(langs) {
  const W = 800, PAD = 25, COLS = 3, ROW = 28, LIST_Y = 108;
  const total = langs.reduce((n, l) => n + l.count, 0) || 1;
  const rows = Math.ceil(langs.length / COLS);
  const H = LIST_Y + rows * ROW + 6;
  const colW = (W - PAD * 2) / COLS;
  const barW = W - PAD * 2;

  let x = PAD;
  const bar = langs
    .map((l) => {
      const w = (l.count / total) * barW;
      const seg = `<rect x="${x.toFixed(2)}" y="64" width="${w.toFixed(2)}" height="10" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("");

  const items = langs
    .map((l, i) => {
      const cx = PAD + (i % COLS) * colW;
      const cy = LIST_Y + Math.floor(i / COLS) * ROW;
      return `<g transform="translate(${cx.toFixed(2)} ${cy})"><circle cx="6" cy="-5" r="6" fill="${l.color}"/><text x="20" y="0" class="n">${esc(l.name)}</text><text x="${(colW - 20).toFixed(2)}" y="0" class="p" text-anchor="end">${esc(pct((l.count / total) * 100))}</text></g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Languages by commit">
<style>
  text { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; }
  .t { font-size: 18px; font-weight: 600; fill: #70A5FD; }
  .s { font-size: 13px; fill: #787C99; }
  .n { font-size: 14px; fill: #A9B1D6; }
  .p { font-size: 13px; fill: #787C99; }
</style>
<rect width="${W}" height="${H}" rx="8" fill="#1A1B27"/>
<text x="${PAD}" y="40" class="t">Languages by Commit</text>
<text x="${W - PAD}" y="40" class="s" text-anchor="end">${langs.length} languages · ${total.toLocaleString("en-US")} commits</text>
<clipPath id="bar"><rect x="${PAD}" y="64" width="${barW}" height="10" rx="5"/></clipPath>
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
