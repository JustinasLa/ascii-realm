// Labels a pull request size:XS…size:XXL by its effective changed lines and
// writes the size to the job summary. Run by action.yml; informational only.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RANGE = 'effective changed lines (tests excluded in mixed PRs).';
// [name, smallest effective line count, colour, description]
export const SIZES = [
  ['size:XS', 0, '0e8a16', `0-9 ${RANGE}`],
  ['size:S', 10, '5ebd3e', `10-29 ${RANGE}`],
  ['size:M', 30, 'fbca04', `30-99 ${RANGE}`],
  ['size:L', 100, 'fe7d37', `100-499 ${RANGE}`],
  ['size:XL', 500, 'd93f0b', `500-999 ${RANGE}`],
  ['size:XXL', 1000, 'b60205', `1,000+ ${RANGE}`],
];
const SIZE_NAMES = new Set(SIZES.map(([name]) => name));
export const TEST_EXCLUDES = ['**/src/test/**', '**/test/**', '**/tests/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*']
  .map(glob => `:(glob,exclude)${glob}`);

// Adds insertions and deletions from `git diff --numstat`; binary files count as zero.
export function sumNumstat(text) {
  let total = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const [added, deleted] = line.split('\t');
    total += (added === '-' ? 0 : Number(added)) + (deleted === '-' ? 0 : Number(deleted));
  }
  return total;
}

// Tests count only when the pull request changes nothing else.
export const effectiveLines = (total, nonTest) => nonTest || total;
export const sizeLabel = lines => SIZES.filter(([, minimum]) => lines >= minimum).at(-1)[0];

export function localGit(cwd = process.cwd()) {
  return {
    has: sha => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: 'ignore' }).status === 0,
    run: (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  };
}

export function measure(base, head, git = localGit()) {
  for (const sha of [base, head]) if (!git.has(sha)) git.run('fetch', '--no-tags', 'origin', sha);
  const diff = ['diff', '--numstat', '--ignore-all-space', '--ignore-blank-lines', `${base}...${head}`];
  return { total: sumNumstat(git.run(...diff)), nonTest: sumNumstat(git.run(...diff, '--', '.', ...TEST_EXCLUDES)) };
}

export function github(repository, token, request = fetch) {
  const base = `https://api.github.com/repos/${repository}`;
  const api = {
    async request(method, path, body) {
      const response = await request(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
      if (!response.ok) throw Object.assign(new Error(`${method} ${path}: HTTP ${response.status}`), { status: response.status });
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    },
    async paged(path) {
      const items = [];
      for (let page = 1; ; page++) {
        const batch = await api.request('GET', `${path}?per_page=100&page=${page}`);
        items.push(...batch);
        if (batch.length < 100) return items;
      }
    },
  };
  return api;
}

export async function syncLabel(api, number, label, current) {
  const [name, , color, description] = SIZES.find(([size]) => size === label);
  const quoted = encodeURIComponent(name);
  try {
    const existing = await api.request('GET', `/labels/${quoted}`);
    if (existing.color !== color || (existing.description ?? '') !== description) {
      await api.request('PATCH', `/labels/${quoted}`, { color, description });
    }
  } catch (error) {
    if (error.status !== 404) throw error;
    await api.request('POST', '/labels', { name, color, description });
  }
  for (const stale of current) {
    if (stale !== name && SIZE_NAMES.has(stale)) await api.request('DELETE', `/issues/${number}/labels/${encodeURIComponent(stale)}`);
  }
  if (!current.includes(name)) await api.request('POST', `/issues/${number}/labels`, { labels: [name] });
}

export async function main({ env = process.env, request = fetch, git = localGit(), log = console.log } = {}) {
  const pull = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).pull_request;
  const api = github(env.GITHUB_REPOSITORY, env.GH_TOKEN, request);
  const { total, nonTest } = measure(pull.base.sha, pull.head.sha, git);
  const lines = effectiveLines(total, nonTest), label = sizeLabel(lines);
  log(`PR #${pull.number}: ${nonTest} non-test lines, ${total - nonTest} test lines -> ${label}`);

  const current = (await api.paged(`/issues/${pull.number}/labels`)).map(item => item.name);
  try {
    await syncLabel(api, pull.number, label, current);
  } catch (error) {
    if (error.status !== 403) throw error;
    log('::warning::No permission to label this pull request; the size is in the job summary.');
  }

  const text = `**${label}**: ${lines} effective changed lines.`;
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  log(text);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
