'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { release } = require('../../src/commands/release');
const { payloadHash } = require('../../src/core/store');

function fixture(firstComment) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'postwright-release-linkedin-'));
  const draftsRoot = path.join(root, 'drafts');
  const privateRoot = path.join(root, 'private');
  const dir = path.join(draftsRoot, 'demo');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'post-x.md'), 'Which retry prevents a duplicate charge?\n\nUse an idempotency key.\n');
  fs.writeFileSync(path.join(dir, 'post-linkedin.md'), 'An idempotency key prevents a duplicate charge.\n');
  if (firstComment !== undefined) fs.writeFileSync(path.join(dir, 'first-comment.md'), firstComment);
  fs.writeFileSync(path.join(dir, 'article-devto.md'), '---\ntitle: Idempotency keys\ntags: [api, rest]\npublished: false\n---\n\nUse an idempotency key.\n');
  // payload_hash is computed against whatever is on disk right now, so the recorded hash
  // always matches what release() will see: a fixture that skips writing first-comment.md
  // is exercising the "no first comment" state, not a stale hash.
  const channels = {};
  for (const channel of ['x', 'linkedin', 'devto']) channels[channel] = { state: 'linted', payload_hash: payloadHash(dir, channel) };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ slug: 'demo', topic: 'idempotency keys', channels }, null, 2));
  return { root, draftsRoot, privateRoot, dir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const passLint = async () => ({ pass: true, channels: { x: true, linkedin: true, devto: true }, rules: [] });

test('a LinkedIn release payload carries the first-comment content for the publisher to post', async t => {
  const f = fixture('https://example.invalid/detail\n');
  t.after(f.cleanup);
  let seenPayload;
  await release('demo', {
    channel: 'linkedin', confirm: true, draftsRoot: f.draftsRoot, privateRoot: f.privateRoot, lintDraft: passLint,
    publisher: async payload => {
      seenPayload = payload;
      return { owner: '/in/ama-sen/', text: payload.text, id: 'urn:li:activity:1', url: 'https://www.linkedin.com/feed/update/urn:li:activity:1' };
    }
  });
  assert.equal(seenPayload.text, 'An idempotency key prevents a duplicate charge.');
  assert.equal(seenPayload.firstComment, 'https://example.invalid/detail');
});

test('a LinkedIn release payload defaults an absent first-comment file to an empty string', async t => {
  const f = fixture();
  t.after(f.cleanup);
  let seenPayload;
  await release('demo', {
    channel: 'linkedin', confirm: true, draftsRoot: f.draftsRoot, privateRoot: f.privateRoot, lintDraft: passLint,
    publisher: async payload => {
      seenPayload = payload;
      return { owner: '/in/ama-sen/', text: payload.text, id: 'urn:li:activity:1', url: 'https://www.linkedin.com/feed/update/urn:li:activity:1' };
    }
  });
  assert.equal(seenPayload.firstComment, '');
});
