#!/usr/bin/env node
/**
 * fetch-github-data.mjs
 * Fetches GitHub stats for Johann-Cardenas and writes data/github.json.
 *
 * Usage:  node scripts/fetch-github-data.mjs
 *
 * Authentication:
 *   1. GITHUB_TOKEN env var (preferred — survives credential-manager hiccups).
 *   2. Fallback: git credential manager (GitHub Desktop).
 *   3. Last resort: unauthenticated (60 req/hr rate limit).
 *
 * Design note:
 *   Uses synchronous REST + GraphQL endpoints only. The async /stats/commit_activity
 *   and /stats/contributors endpoints were abandoned — they frequently return 202
 *   for hours at a time, leaving the heatmap and contributors list empty. Weekly
 *   activity is now derived client-side by bucketing /commits?since=<52w>, and
 *   contributors come from the synchronous /contributors endpoint.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'data', 'github.json');
const USER = 'Johann-Cardenas';

/* ── Helpers ────────────────────────────────────────────── */

function getToken() {
  // Prefer explicit env var so CI / ad-hoc runs don't depend on credential manager state.
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    const out = execSync(
      "printf 'protocol=https\\nhost=github.com\\n' | git credential fill",
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const m = out.match(/password=(.+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

const TOKEN = getToken();
const headers = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'Johann-GitHub-Fetch/1.0',
  ...(TOKEN ? { 'Authorization': `Bearer ${TOKEN}` } : {})
};

async function api(path) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

/**
 * Paginate a GitHub REST endpoint via Link header. Accumulates all pages.
 * 409 (empty repo) returns []. Other errors throw.
 */
async function apiPaginated(path) {
  const out = [];
  let url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  while (url) {
    const res = await fetch(url, { headers });
    if (res.status === 409) return out; // empty / no default branch
    if (res.status === 204) return out; // no content (e.g. contributors on empty repo)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
    const json = await res.json();
    if (Array.isArray(json)) out.push(...json);
    const link = res.headers.get('link') || '';
    const next = link.split(',').find(p => /rel="next"/.test(p));
    const m = next && next.match(/<([^>]+)>/);
    url = m ? m[1] : null;
  }
  return out;
}

/**
 * Bucket commits into 52 weekly slots. Week 0 starts `weekStartMs` and each
 * subsequent week is +7 days. Matches the layout the UI expects (52-cell grid
 * ending at "now").
 */
function bucketWeekly(commits, weekStartMs) {
  const weekly = new Array(52).fill(0);
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  for (const c of commits) {
    const dateStr = c.commit?.author?.date || c.commit?.committer?.date;
    if (!dateStr) continue;
    const t = new Date(dateStr).getTime();
    const idx = Math.floor((t - weekStartMs) / WEEK_MS);
    if (idx >= 0 && idx < 52) weekly[idx]++;
  }
  return weekly;
}

/** GitHub language color map (top languages) */
const LANG_COLORS = {
  'JavaScript': '#f1e05a', 'TypeScript': '#3178c6', 'Python': '#3572A5',
  'Jupyter Notebook': '#DA5B0B', 'HTML': '#e34c26', 'CSS': '#563d7c',
  'SCSS': '#c6538c', 'Shell': '#89e051', 'Visual Basic .NET': '#945db7',
  'Makefile': '#427819', 'Dockerfile': '#384d54', 'TeX': '#3D6117',
  'R': '#198CE7', 'C++': '#f34b7d', 'C': '#555555', 'Java': '#b07219',
  'Go': '#00ADD8', 'Rust': '#dea584', 'Ruby': '#701516', 'Other': '#8b8b8b'
};

/* ── GraphQL: total commit counts ──────────────────────── */

async function fetchCommitCounts(repoNames) {
  if (!TOKEN) {
    console.log('  ℹ No token — skipping GraphQL commit counts');
    return {};
  }
  // Build a GraphQL query with one alias per repo
  const fragments = repoNames.map((name, i) => {
    return `r${i}: repository(owner:"${USER}", name:"${name}") {
      defaultBranchRef { target { ... on Commit {
        history { totalCount }
      }}}
    }`;
  }).join('\n');

  const query = `query { ${fragments} }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  if (!res.ok) {
    console.warn('  ⚠ GraphQL failed:', res.status);
    return {};
  }
  const json = await res.json();
  const counts = {};
  repoNames.forEach((name, i) => {
    const node = json.data?.[`r${i}`];
    counts[name] = node?.defaultBranchRef?.target?.history?.totalCount ?? 0;
  });
  return counts;
}

/* ── Main pipeline ─────────────────────────────────────── */

async function main() {
  console.log(`Fetching GitHub data for ${USER}...`);
  console.log(`Auth: ${TOKEN ? 'authenticated' : 'unauthenticated (rate-limited)'}`);

  // 1. List repos
  const rawRepos = await api(`/users/${USER}/repos?per_page=100&sort=updated`);
  const repoNames = rawRepos.map(r => r.name);
  console.log(`Found ${repoNames.length} repos`);

  // 2. GraphQL commit counts
  console.log('Fetching commit counts (GraphQL)...');
  const commitCounts = await fetchCommitCounts(repoNames);

  // 3. Per-repo: languages, weekly activity, contributors, recent commits
  console.log('Fetching per-repo stats...');
  const repos = [];
  const allLangs = {};
  const weeklyOrgCommits = new Array(52).fill(0);
  const contributorMap = new Map();
  const recentCommitsAll = [];

  // Week 0 for the 52-cell heatmap starts 52 weeks ago; indices 0..51 correspond
  // to week-of-year positions in the UI grid.
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const weekStartMs = Date.now() - 52 * WEEK_MS;
  const sinceIso = new Date(weekStartMs).toISOString();

  for (const raw of rawRepos) {
    const name = raw.name;
    process.stdout.write(`  ${name}...`);

    // Languages
    let langs = {};
    try { langs = await api(`/repos/${USER}/${name}/languages`); }
    catch { console.warn(' langs failed'); }

    for (const [lang, bytes] of Object.entries(langs)) {
      allLangs[lang] = (allLangs[lang] || 0) + bytes;
    }

    // Commits in the last 52 weeks — one paginated fetch powers both the
    // heatmap (bucketed weekly) and the recent-activity feed (top 5 by date).
    let last52wCommits = [];
    try {
      last52wCommits = await apiPaginated(
        `/repos/${USER}/${name}/commits?per_page=100&since=${encodeURIComponent(sinceIso)}`
      );
    } catch (e) {
      console.warn(` commits failed: ${e.message}`);
    }

    const sparkline = bucketWeekly(last52wCommits, weekStartMs);
    sparkline.forEach((v, i) => { weeklyOrgCommits[i] += v; });

    // Most recent 5 commits for the global feed (commits are returned newest-first).
    for (const c of last52wCommits.slice(0, 5)) {
      recentCommitsAll.push({
        repo: name,
        sha: c.sha.slice(0, 7),
        message: (c.commit?.message || '').split('\n')[0].slice(0, 80),
        author: c.author?.login || c.commit?.author?.name || 'unknown',
        avatar: c.author?.avatar_url || '',
        date: c.commit?.author?.date || ''
      });
    }

    // Contributors — synchronous endpoint, returns all-time commit counts.
    const repoContribs = [];
    try {
      const contribs = await apiPaginated(`/repos/${USER}/${name}/contributors?per_page=100`);
      for (const c of contribs) {
        const login = c.login || 'unknown';
        const avatar = c.avatar_url || '';
        const total = c.contributions || 0;
        repoContribs.push({ login, avatar, commits: total });

        if (contributorMap.has(login)) {
          contributorMap.get(login).commits += total;
        } else {
          contributorMap.set(login, { login, avatar, commits: total });
        }
      }
    } catch (e) {
      console.warn(` contributors failed: ${e.message}`);
    }

    // Enrich languages with colors
    const langEntries = Object.entries(langs).map(([lang, bytes]) => ({
      name: lang,
      bytes,
      color: LANG_COLORS[lang] || LANG_COLORS['Other']
    }));

    repos.push({
      name,
      fullName: raw.full_name,
      description: raw.description || '',
      url: raw.html_url,
      language: raw.language,
      stars: raw.stargazers_count,
      forks: raw.forks_count,
      size: raw.size,
      updatedAt: raw.updated_at,
      commitCount: commitCounts[name] || 0,
      languages: langEntries,
      sparkline,
      contributors: repoContribs
    });

    console.log(' ✓');
  }

  // 4. Aggregate totals
  const totalCommits = repos.reduce((s, r) => s + r.commitCount, 0);
  const uniqueContributors = [...contributorMap.values()]
    .sort((a, b) => b.commits - a.commits);
  const uniqueLangs = Object.keys(allLangs).length;

  // Top 8 languages + Other
  const sortedLangs = Object.entries(allLangs).sort((a, b) => b[1] - a[1]);
  const totalBytes = sortedLangs.reduce((s, [, b]) => s + b, 0);
  const top8 = sortedLangs.slice(0, 8).map(([name, bytes]) => ({
    name,
    bytes,
    pct: +(bytes / totalBytes * 100).toFixed(1),
    color: LANG_COLORS[name] || LANG_COLORS['Other']
  }));
  const otherBytes = sortedLangs.slice(8).reduce((s, [, b]) => s + b, 0);
  if (otherBytes > 0) {
    top8.push({
      name: 'Other',
      bytes: otherBytes,
      pct: +(otherBytes / totalBytes * 100).toFixed(1),
      color: LANG_COLORS['Other']
    });
  }

  // Recent commits: sort by date, take 8
  const recentCommits = recentCommitsAll
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 8);

  // 5. Build output
  const data = {
    user: USER,
    fetchedAt: new Date().toISOString(),
    totals: {
      repos: repos.length,
      commits: totalCommits,
      languages: uniqueLangs,
      contributors: uniqueContributors.length
    },
    repos,
    weeklyCommits: weeklyOrgCommits,
    recentCommits,
    languages: top8,
    contributors: uniqueContributors.slice(0, 20)
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(`\n✅ Written to ${OUT}`);
  console.log(`   ${repos.length} repos | ${totalCommits} commits | ${uniqueLangs} languages | ${uniqueContributors.length} contributors`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
