'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../src/commands/run');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'postwright-run-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const draftsRoot = path.join(root, 'drafts');
  const privateRoot = path.join(root, 'private');
  fs.mkdirSync(draftsRoot, { recursive: true });
  return { draftsRoot, privateRoot };
}

function writeManifest(draftsRoot, slug, channels) {
  const dir = path.join(draftsRoot, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ slug, topic: 'demo topic', channels }, null, 2));
}

function stubs(f, { lintChannels = { x: true, linkedin: true, devto: false } } = {}) {
  const calls = { draft: 0, lint: 0, release: [] };
  const draftFn = async (topic, options) => {
    calls.draft++;
    writeManifest(options.draftsRoot, 'demo', { x: { state: 'draft' }, linkedin: { state: 'draft' }, devto: { state: 'draft' } });
    return { dir: path.join(options.draftsRoot, 'demo'), manifest: { slug: 'demo', topic: 'demo topic' } };
  };
  const lintFn = async (slug, options) => {
    calls.lint++;
    const state = channel => (lintChannels[channel] ? 'linted' : 'draft');
    writeManifest(options.draftsRoot, slug, { x: { state: state('x') }, linkedin: { state: state('linkedin') }, devto: { state: state('devto') } });
    return { pass: Object.values(lintChannels).every(Boolean), results: [{ slug, pass: true, channels: lintChannels, rules: [] }] };
  };
  return { calls, draftFn, lintFn, draftsRoot: f.draftsRoot, privateRoot: f.privateRoot };
}

test('without --release, run stages a draft and lint pass and never calls a releaser', async t => {
  const f = fixture(t);
  const s = stubs(f);
  const releaseFn = async () => assert.fail('release must not run without --release --confirm');
  const result = await run('demo topic', { ...s, releaseFn });
  assert.equal(s.calls.draft, 1);
  assert.equal(s.calls.lint, 1);
  assert.deepEqual(result.channels, { x: true, linkedin: true, devto: false });
  assert.equal(result.release, undefined);
});

test('--release --confirm releases requested channels in sequence, stopping at the first refusal', async t => {
  const f = fixture(t);
  const s = stubs(f);
  const attempted = [];
  const releaseFn = async (slug, options) => {
    attempted.push(options.channel);
    if (options.channel === 'x') return { owner: 'amasen02', id: '1', url: 'https://x.com/amasen02/status/1' };
    const error = new Error(`Release refused: ${options.channel} channel does not pass lint`);
    error.safe = true;
    throw error;
  };
  const result = await run('demo topic', { ...s, releaseFn, release: true, confirm: true, channels: 'x,linkedin,devto' });
  assert.deepEqual(attempted, ['x', 'linkedin']);
  assert.equal(result.release.length, 2);
  assert.equal(result.release[0].status, 'released');
  assert.equal(result.release[1].status, 'refused');
  assert.match(result.release[1].error, /does not pass lint/);
});

test('an uncertain release outcome halts the sequence and is reported distinctly from a refusal', async t => {
  const f = fixture(t);
  const s = stubs(f);
  const attempted = [];
  const releaseFn = async (slug, options) => {
    attempted.push(options.channel);
    const error = new Error('Release outcome is uncertain; verify manually before any retry');
    error.safe = true;
    throw error;
  };
  const result = await run('demo topic', { ...s, releaseFn, release: true, confirm: true, channels: 'x,linkedin' });
  assert.deepEqual(attempted, ['x']);
  assert.equal(result.release[0].status, 'uncertain');
});

test('--confirm without --release and --release without --confirm are both refused before draft runs', async t => {
  const f = fixture(t);
  for (const options of [{ confirm: true }, { release: true }]) {
    const s = stubs(f);
    await assert.rejects(run('demo topic', { ...s, ...options }));
    assert.equal(s.calls.draft, 0);
  }
});

test('an invalid --channels list is refused before draft runs', async t => {
  const f = fixture(t);
  for (const channels of ['bogus', 'x,x', 'x,bogus']) {
    const s = stubs(f);
    await assert.rejects(run('demo topic', { ...s, channels }), { code: 'USAGE' });
    assert.equal(s.calls.draft, 0);
  }
});
