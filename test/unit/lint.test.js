'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const { lintDraft, OPERATOR_LINKEDIN } = require('../../src/core/lint');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'postwright-lint-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const draftsRoot = path.join(root, 'drafts');
  const privateRoot = path.join(root, 'private');
  const dir = path.join(draftsRoot, 'idempotency-keys');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(privateRoot, { recursive: true });
  const asset = Buffer.from('GIF89a-safe-test-asset');
  fs.writeFileSync(path.join(dir, 'asset.gif'), asset);
  const manifest = {
    slug: 'idempotency-keys', topic: 'idempotency keys in REST APIs', noGif: false,
    gif: { path: 'asset.gif', failures: [], footer: OPERATOR_LINKEDIN, sha256: crypto.createHash('sha256').update(asset).digest('hex') },
    channels: { x: { state: 'draft' }, linkedin: { state: 'draft' }, devto: { state: 'draft' } },
    xEvidence: { url: 'https://x.com/example/status/123', replies: 1, bookmarks: 0, topic: 'idempotency keys in REST APIs' }
  };
  Object.assign(manifest, overrides.manifest || {});
  const files = {
    'post-x.md': 'Stop retrying POST requests without an idempotency key; use an Idempotency-Key header.\n',
    'post-linkedin.md': 'An idempotency key turns a retried REST API request into one durable operation.\n\nStore the key with the response, then replay that response when the client retries.\n',
    'article-devto.md': '---\ntitle: "Idempotency Keys in REST APIs"\ntags: api, reliability\npublished: false\ncover_image: ./asset.gif\n---\n\n# Idempotency Keys in REST APIs\n\nRetries need a stable operation identity.\n',
    ...(overrides.files || {})
  };
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), value);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { root, draftsRoot, privateRoot, dir, manifest };
}
function writeManifest(f) { fs.writeFileSync(path.join(f.dir, 'manifest.json'), JSON.stringify(f.manifest, null, 2)); }
async function run(f, extra = {}) { return lintDraft(f.dir, { draftsRoot: f.draftsRoot, privateRoot: f.privateRoot, now: new Date('2026-09-06T12:00:00Z'), ...extra }); }
function rule(output, id) { return output.rules.find(item => item.id === id); }

test('clean draft passes all twelve evidence gates and exposes per-channel readiness', async t => {
  const f = fixture(t);
  const output = await run(f);
  assert.equal(output.rules.length, 12);
  assert.ok(output.rules.every(item => item.pass));
  assert.deepEqual(output.channels, { x: true, linkedin: true, devto: true });
  assert.equal(output.pass, true);
  for (const item of output.rules) assert.match(item.message, /Evidence:/);
});

test('R1 accepts a question or mistake/replacement claim and rejects topic announcements', async t => {
  const f = fixture(t, { files: { 'post-x.md': 'Here is how idempotency keys work.\n' } });
  assert.equal(rule(await run(f), 'R1').pass, false);
  fs.writeFileSync(path.join(f.dir, 'post-x.md'), 'Do idempotency keys make REST retries safe?\n');
  assert.equal(rule(await run(f), 'R1').pass, true);
  fs.writeFileSync(path.join(f.dir, 'post-x.md'), 'Skip blind REST retries; use an idempotency key instead.\n');
  assert.equal(rule(await run(f), 'R1').pass, true);
});

test('R2 rejects emoji-led and ordinary all-caps newsletter headers', async t => {
  const f = fixture(t, { files: { 'post-x.md': '\u{1F4E2} REST API UPDATE\nUse an idempotency key for retries.\n' } });
  let output = await run(f);
  assert.equal(rule(output, 'R2').pass, false);
  // The evidence sentence is operator-configurable and its default carries no figures,
  // so assert the verdict rather than prose that only exists in a local override.
  assert.equal(rule(output, 'R2').pass, false);
  fs.writeFileSync(path.join(f.dir, 'post-x.md'), 'Do idempotency keys make REST retries safe?\n\nBREAKING UPDATE\n');
  output = await run(f);
  assert.equal(rule(output, 'R2').pass, false);
});

test('R3 enforces 280 characters, one question, and at most two opener sentences', async t => {
  const f = fixture(t, { files: { 'post-x.md': `Does an idempotency key help? ${'x'.repeat(260)}\n` } });
  assert.equal(rule(await run(f), 'R3').pass, false);
  fs.writeFileSync(path.join(f.dir, 'post-x.md'), 'Does an idempotency key help? Does a REST retry stay safe?\n');
  assert.equal(rule(await run(f), 'R3').pass, false);
  fs.writeFileSync(path.join(f.dir, 'post-x.md'), 'Use an idempotency key. Keep the REST response. Retry it.\n');
  assert.equal(rule(await run(f), 'R3').pass, false);
});

test('R4 allows one link in a single post but rejects two links and a linked thread opener', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'post-x.md'), 'Do idempotency keys make REST retries safe?\nhttps://example.invalid/one\n');
  assert.equal(rule(await run(f), 'R4').pass, true);
  fs.appendFileSync(path.join(f.dir, 'post-x.md'), 'https://example.invalid/two\n');
  assert.equal(rule(await run(f), 'R4').pass, false);
  fs.writeFileSync(path.join(f.dir, 'post-x.md'), 'Do idempotency keys make REST retries safe? https://example.invalid/one\n---\nStore the REST response.\n');
  assert.equal(rule(await run(f), 'R4').pass, false);
});

test('R5 requires a non-generic noun drawn from the topic domain', async t => {
  const f = fixture(t, { files: { 'post-x.md': 'Should this system use a better approach?\n' } });
  assert.equal(rule(await run(f), 'R5').pass, false);
  fs.writeFileSync(path.join(f.dir, 'post-x.md'), 'Should every REST retry carry an idempotency key?\n');
  assert.equal(rule(await run(f), 'R5').pass, true);
});

test('R6 rejects LinkedIn body links and emits their unique destinations to first-comment.md', async t => {
  const body = 'Store the idempotency key before calling the REST service.\nhttps://example.invalid/detail\nhttps://example.invalid/detail\n';
  const f = fixture(t, { files: { 'post-linkedin.md': body } });
  const output = await run(f);
  assert.equal(rule(output, 'R6').pass, false);
  assert.equal(fs.readFileSync(path.join(f.dir, 'first-comment.md'), 'utf8'), 'https://example.invalid/detail\n');
  // The evidence sentence is operator-configurable, so assert the verdict, not its prose.
  assert.equal(rule(output, 'R6').pass, false);
});

test('R7 requires asset.gif unless noGif records an explicit waiver', async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.dir, 'asset.gif'));
  assert.equal(rule(await run(f), 'R7').pass, false);
  f.manifest.noGif = true;
  writeManifest(f);
  assert.equal(rule(await run(f), 'R7').pass, true);
});

test('R8 pins GIF bytes and the sole renderer footer to the operator LinkedIn URL', async t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.dir, 'asset.gif'), 'changed');
  assert.equal(rule(await run(f), 'R8').pass, false);
  const bytes = fs.readFileSync(path.join(f.dir, 'asset.gif'));
  f.manifest.gif.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  f.manifest.gif.footer = 'https://www.linkedin.com/in/someone-else';
  writeManifest(f);
  assert.equal(rule(await run(f), 'R8').pass, false);
  f.manifest.gif.footer = OPERATOR_LINKEDIN + '/';
  writeManifest(f);
  assert.equal(rule(await run(f), 'R8').pass, true);
});

test('R9 holds dev.to until same-topic X engagement exists or a reasoned force is stored', async t => {
  const f = fixture(t);
  delete f.manifest.xEvidence;
  writeManifest(f);
  assert.equal(rule(await run(f), 'R9').pass, false);
  f.manifest.xEvidence = { url: 'https://x.com/example/status/123', replies: 0, bookmarks: 1, topic: 'another topic' };
  writeManifest(f);
  assert.equal(rule(await run(f), 'R9').pass, false);
  f.manifest.forceReason = 'Operator approved this foundational reference article.';
  writeManifest(f);
  assert.equal(rule(await run(f), 'R9').pass, true);
});

test('R10 rejects normalized duplicate titles in drafts and cached dev.to articles', async t => {
  const f = fixture(t);
  const duplicateDir = path.join(f.draftsRoot, 'duplicate');
  fs.mkdirSync(duplicateDir);
  fs.writeFileSync(path.join(duplicateDir, 'article-devto.md'), '---\ntitle: Idempotency keys — in REST APIs!\n---\n');
  assert.equal(rule(await run(f), 'R10').pass, false);
  fs.rmSync(duplicateDir, { recursive: true });
  fs.writeFileSync(path.join(f.privateRoot, 'devto-existing.json'), JSON.stringify({ articles: [{ title: 'IDEMPOTENCY KEYS IN REST APIS' }] }));
  assert.equal(rule(await run(f), 'R10').pass, false);
});

test('R11 refuses when two other releases fall inside the preceding 60 minutes', async t => {
  const f = fixture(t);
  for (const [slug, releasedAt] of [['one', '2026-09-06T11:01:00Z'], ['two', '2026-09-06T11:59:59Z']]) {
    const dir = path.join(f.draftsRoot, slug);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ channels: { x: { state: 'released', releasedAt } } }));
  }
  assert.equal(rule(await run(f), 'R11').pass, false);
  assert.equal(rule(await run(f, { now: new Date('2026-09-06T12:02:00Z') }), 'R11').pass, true);
});

test('R12 scans every publishable file for paths, email, local identity, and credential shapes', async t => {
  const samples = [
    ['post-x.md', 'Should a REST retry read D:\\work\\private.txt?\n'],
    ['post-linkedin.md', 'Write to person@example.invalid after the idempotency key is stored.\n'],
    ['article-devto.md', `---\ntitle: Idempotency Keys in REST APIs\n---\nHost ${os.hostname()} owns the retry.\n`],
    ['post-x.md', `Should a REST retry use ${'gh' + 'p_' + 'x'.repeat(24)}?\n`]
  ];
  for (const [name, content] of samples) {
    const f = fixture(t, { files: { [name]: content } });
    assert.equal(rule(await run(f), 'R12').pass, false, name);
  }
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'first-comment.md'), 'Contact editor@example.invalid\n');
  assert.equal(rule(await run(f), 'R12').pass, false);
});
