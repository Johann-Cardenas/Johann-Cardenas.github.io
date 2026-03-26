#!/usr/bin/env node
/**
 * fetch-github-data.mjs
 * Fetches GitHub stats for Johann-Cardenas and writes data/github.json.
 *
 * Usage:  node scripts/fetch-github-data.mjs
 *
 * Authentication: reads token from git credential manager (GitHub Desktop).
 * Falls back to unauthenticated (60 req/hr rate limit).
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

async function apiRetry(path, attempts = 8, delay = 5000) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(
      path.startsWith('http') ? path : `https://api.github.com${path}`,
      { headers }
    );
    if (res.status === 202) {
      console.log(`  ⏳ 202 Accepted, retrying in ${delay / 1000}s... (${path})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`);
    return res.json();
  }
  console.warn(`  ⚠ Gave up after ${attempts} attempts: ${path}`);
  return null;
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

  // 3. Per-repo: languages, weekly activity, contributors
  console.log('Fetching per-repo stats...');
  const repos = [];
  const allLangs = {};
  const weeklyOrgCommits = new Array(52).fill(0);
  const contributorMap = new Map();
  const recentCommitsAll = [];

  for (const raw of rawRepos) {
    const name = raw.name;
    process.stdout.write(`  ${name}...`);

    // Languages
    let langs = {};
    try { langs = await api(`/repos/${USER}/${name}/languages`); }
    catch (e) { console.warn(' langs failed'); }

    // Accumulate org-wide
    for (const [lang, bytes] of Object.entries(langs)) {
      allLangs[lang] = (allLangs[lang] || 0) + bytes;
    }

    // Weekly commit activity (52 weeks)
    let weeklyCommits = [];
    const activity = await apiRetry(`/repos/${USER}/${name}/stats/commit_activity`);
    if (Array.isArray(activity)) {
      weeklyCommits = activity.map(w => ({ week: w.week, total: w.total }));
      activity.forEach((w, i) => { weeklyOrgCommits[i] += w.total; });
    }

    // Sparkline (just the totals array)
    const sparkline = weeklyCommits.map(w => w.total);

    // Contributors
    const contribs = await apiRetry(`/repos/${USER}/${name}/stats/contributors`);
    const repoContribs = [];
    if (Array.isArray(contribs)) {
      for (const c of contribs) {
        const login = c.author?.login || 'unknown';
        const avatar = c.author?.avatar_url || '';
        const total = c.total || 0;
        repoContribs.push({ login, avatar, commits: total });

        if (contributorMap.has(login)) {
          contributorMap.get(login).commits += total;
        } else {
          contributorMap.set(login, { login, avatar, commits: total });
        }
      }
    }

    // Recent commits (last 5 per repo)
    try {
      const commits = await api(`/repos/${USER}/${name}/commits?per_page=5`);
      for (const c of commits) {
        recentCommitsAll.push({
          repo: name,
          sha: c.sha.slice(0, 7),
          message: (c.commit?.message || '').split('\n')[0].slice(0, 80),
          author: c.author?.login || c.commit?.author?.name || 'unknown',
          avatar: c.author?.avatar_url || '',
          date: c.commit?.author?.date || ''
        });
      }
    } catch {}

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
