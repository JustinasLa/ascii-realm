import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SIZES, TEST_EXCLUDES, effectiveLines, github, localGit, main, measure, sizeLabel, sumNumstat, syncLabel }
  from '../.github/actions/pr-size/pr-size.mjs';

const temp = t => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-size-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// A fake GitHub API: `routes` maps "METHOD path" to a status and JSON body; every call is recorded.
function fakeApi(routes = {}) {
  const calls = [];
  const request = async (url, { method, body }) => {
    const path = url.replace('https://api.github.com/repos/owner/repo', '');
    calls.push({ method, path, body: body === undefined ? undefined : JSON.parse(body) });
    const [status, json] = routes[`${method} ${path}`] ?? [200, undefined];
    return { ok: status < 300, status, text: async () => (json === undefined ? '' : JSON.stringify(json)) };
  };
  return { calls, request, api: github('owner/repo', 'secret', request) };
}

test('size thresholds and descriptions match the labelling rules', () => {
  assert.deepEqual(SIZES.map(([name, minimum]) => [name, minimum]),
    [['size:XS', 0], ['size:S', 10], ['size:M', 30], ['size:L', 100], ['size:XL', 500], ['size:XXL', 1000]]);
  assert.equal(SIZES[5][3], '1,000+ effective changed lines (tests excluded in mixed PRs).');
  for (const [lines, label] of [[0, 'size:XS'], [9, 'size:XS'], [10, 'size:S'], [29, 'size:S'], [30, 'size:M'],
    [99, 'size:M'], [100, 'size:L'], [499, 'size:L'], [500, 'size:XL'], [999, 'size:XL'], [1000, 'size:XXL']]) {
    assert.equal(sizeLabel(lines), label, `${lines} lines`);
  }
  assert.ok(TEST_EXCLUDES.includes(':(glob,exclude)**/*.test.*'));
});

test('numstat sums insertions and deletions, counting binary files as zero', () => {
  assert.equal(sumNumstat('3\t2\tsrc/a.js\n-\t-\tassets/a.png\n\n10\t0\tdocs/b.md\n'), 15);
  assert.equal(sumNumstat(''), 0);
  assert.equal(effectiveLines(40, 12), 12, 'tests are excluded in mixed pull requests');
  assert.equal(effectiveLines(40, 0), 40, 'a tests-only pull request counts its tests');
});

test('measure fetches missing commits and separates test lines from the rest', t => {
  const dir = temp(t), origin = join(dir, 'origin'), clone = join(dir, 'clone');
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com',
    '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();
  mkdirSync(join(origin, 'src'), { recursive: true });
  mkdirSync(join(origin, 'test'));
  git(origin, 'init', '-q', '-b', 'main');
  writeFileSync(join(origin, 'src/a.js'), 'one\ntwo\n');
  git(origin, 'add', '.'); git(origin, 'commit', '-q', '-m', 'base');
  const base = git(origin, 'rev-parse', 'HEAD');
  execFileSync('git', ['clone', '-q', origin, clone]);
  writeFileSync(join(origin, 'src/a.js'), 'one\nTWO\nthree\n\n');
  writeFileSync(join(origin, 'test/a.test.js'), 'a\nb\nc\nd\n');
  writeFileSync(join(origin, 'icon.png'), Buffer.from([0, 1, 2, 0, 255]));
  git(origin, 'add', '.'); git(origin, 'commit', '-q', '-m', 'head');
  const head = git(origin, 'rev-parse', 'HEAD');

  const local = localGit(clone);
  assert.equal(local.has(head), false, 'the clone starts without the head commit');
  assert.deepEqual(measure(base, head, local), { total: 8, nonTest: 4 });
  assert.equal(local.has(head), true, 'the head commit was fetched from origin');
});

test('the API client sends authenticated JSON, pages labels and reports HTTP errors with their status', async () => {
  const labels = Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` }));
  const { api, calls } = fakeApi({
    'GET /issues/1/labels?per_page=100&page=1': [200, labels],
    'GET /issues/1/labels?per_page=100&page=2': [200, [{ name: 'last' }]],
    'GET /missing': [404, { message: 'Not Found' }],
  });
  assert.equal((await api.paged('/issues/1/labels')).length, 101);
  assert.equal(await api.request('DELETE', '/labels/x'), null, 'an empty response is null');
  await assert.rejects(api.request('GET', '/missing'), { status: 404, message: 'GET /missing: HTTP 404' });
  assert.equal(calls.length, 4);

  let sent;
  await github('owner/repo', 'secret', async (url, options) => {
    sent = { url, ...options };
    return { ok: true, status: 201, text: async () => '{"id":1}' };
  }).request('POST', '/labels', { name: 'size:S' });
  assert.equal(sent.url, 'https://api.github.com/repos/owner/repo/labels');
  assert.equal(sent.body, '{"name":"size:S"}');
  assert.equal(sent.headers.Authorization, 'Bearer secret');
  assert.equal(sent.headers.Accept, 'application/vnd.github+json');
});

test('syncing creates a missing label, swaps stale size labels and keeps other labels', async () => {
  const { api, calls } = fakeApi({ 'GET /labels/size%3AM': [404, { message: 'Not Found' }] });
  await syncLabel(api, 7, 'size:M', ['bug', 'size:XS', 'size:XL']);
  assert.deepEqual(calls.map(c => `${c.method} ${c.path}`), ['GET /labels/size%3AM', 'POST /labels',
    'DELETE /issues/7/labels/size%3AXS', 'DELETE /issues/7/labels/size%3AXL', 'POST /issues/7/labels']);
  assert.deepEqual(calls[1].body, { name: 'size:M', color: 'fbca04', description: SIZES[2][3] });
  assert.deepEqual(calls[4].body, { labels: ['size:M'] });
});

test('syncing repairs a changed label colour or description and leaves a correct one alone', async () => {
  const [, , color, description] = SIZES[1];
  const changed = fakeApi({ 'GET /labels/size%3AS': [200, { color: 'ffffff', description }] });
  await syncLabel(changed.api, 7, 'size:S', ['size:S']);
  assert.deepEqual(changed.calls.map(c => c.method), ['GET', 'PATCH']);
  assert.deepEqual(changed.calls[1].body, { color, description });

  const undescribed = fakeApi({ 'GET /labels/size%3AS': [200, { color, description: null }] });
  await syncLabel(undescribed.api, 7, 'size:S', ['size:S']);
  assert.deepEqual(undescribed.calls.map(c => c.method), ['GET', 'PATCH']);

  const correct = fakeApi({ 'GET /labels/size%3AS': [200, { color, description }] });
  await syncLabel(correct.api, 7, 'size:S', ['size:S']);
  assert.deepEqual(correct.calls.map(c => c.method), ['GET'], 'nothing to change');

  const broken = fakeApi({ 'GET /labels/size%3AS': [500, {}] });
  await assert.rejects(syncLabel(broken.api, 7, 'size:S', []), { status: 500 });
});

function run(t, routes, { summary = true } = {}) {
  const dir = temp(t), event = join(dir, 'event.json'), summaryFile = join(dir, 'summary.md'), logs = [];
  writeFileSync(event, JSON.stringify({ pull_request: { number: 9, base: { sha: 'b' }, head: { sha: 'h' } } }));
  const git = { has: () => true,
    run: (...args) => (args.includes('--') ? '20\t5\tsrc/a.js\n' : '20\t5\tsrc/a.js\n300\t0\ttest/a.test.js\n') };
  const fake = fakeApi({ 'GET /issues/9/labels?per_page=100&page=1': [200, [{ name: 'size:XS' }]], ...routes });
  const env = { GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'secret',
    ...(summary ? { GITHUB_STEP_SUMMARY: summaryFile } : {}) };
  return { fake, logs, summaryFile, result: main({ env, request: fake.request, git, log: line => logs.push(line) }) };
}

test('a pull request run labels by non-test lines and writes the job summary', async t => {
  const { fake, logs, summaryFile, result } = run(t, { 'GET /labels/size%3AS': [200, { color: SIZES[1][2], description: SIZES[1][3] }] });
  assert.equal(await result, 0);
  assert.deepEqual(logs, ['PR #9: 25 non-test lines, 300 test lines -> size:S', '**size:S**: 25 effective changed lines.']);
  assert.equal(readFileSync(summaryFile, 'utf8'), '**size:S**: 25 effective changed lines.\n');
  assert.deepEqual(fake.calls.slice(-2).map(c => `${c.method} ${c.path}`),
    ['DELETE /issues/9/labels/size%3AXS', 'POST /issues/9/labels']);
});

test('without label permission the run warns and still reports the size', async t => {
  const { logs, result } = run(t, { 'GET /labels/size%3AS': [403, { message: 'Forbidden' }] }, { summary: false });
  assert.equal(await result, 0);
  assert.equal(logs[1], '::warning::No permission to label this pull request; the size is in the job summary.');
  assert.equal(logs[2], '**size:S**: 25 effective changed lines.');
});

test('other API failures fail the run', async t => {
  await assert.rejects(run(t, { 'GET /labels/size%3AS': [502, {}] }).result, { status: 502 });
});
