'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrowserSession } = require('../../src/publish/browser-session');

const OK = {
  ok: true,
  owner: 'amasen02',
  text: 'Why does retrying a failed POST double-charge?',
  url: 'https://x.com/amasen02/status/123',
  when: '2026-09-06T00:00:00.000Z'
};

test('a thread is refused rather than half-published', async () => {
  const session = createBrowserSession({ runDriver: () => OK });
  await assert.rejects(() => session.postX(['one', 'two']), /exactly one X post/u);
  await assert.rejects(() => session.postX([]), /exactly one X post/u);
});

test('a successful publish returns the shape release verifies against', async () => {
  const session = createBrowserSession({ runDriver: () => OK });
  const outcome = await session.postX([OK.text]);
  assert.equal(outcome.owner, 'amasen02');
  assert.deepEqual(outcome.texts, [OK.text]);
  assert.equal(outcome.url, OK.url);
});

test('a readback failure is reported as uncertain, never as a clean failure', async () => {
  // This distinction matters: a clean failure invites a retry, and retrying after the
  // post may already be live would double-post to a real account.
  const session = createBrowserSession({
    runDriver: () => ({ ok: false, stage: 'readback', error: 'post not found on the profile' })
  });
  await assert.rejects(() => session.postX(['text']), /outcome is uncertain/u);
});

test('a pre-publish refusal is reported as a refusal with its stage', async () => {
  for (const stage of ['identity', 'compose', 'media', 'verify-before-publish']) {
    const session = createBrowserSession({ runDriver: () => ({ ok: false, stage, error: 'nope' }) });
    await assert.rejects(() => session.postX(['text']), new RegExp(`refused at ${stage}`, 'u'));
  }
});

test('the driver is not invoked at all for an invalid post set', async () => {
  let called = false;
  const session = createBrowserSession({ runDriver: () => { called = true; return OK; } });
  await assert.rejects(() => session.postX(['a', 'b']));
  assert.equal(called, false, 'the browser must not be driven when the input is already invalid');
});

const LINKEDIN_OK = {
  ok: true,
  owner: '/in/ama-sen/',
  text: 'An idempotency key turns a retried write into one durable operation.',
  url: 'https://www.linkedin.com/feed/update/urn:li:activity:123',
  id: 'urn:li:activity:123',
  commentStatus: 'not-requested'
};

test('a successful LinkedIn publish returns the shape release verifies against', async () => {
  const session = createBrowserSession({ runDriver: () => LINKEDIN_OK });
  const outcome = await session.postLinkedin(LINKEDIN_OK.text);
  assert.equal(outcome.owner, '/in/ama-sen/');
  assert.equal(outcome.text, LINKEDIN_OK.text);
  assert.equal(outcome.url, LINKEDIN_OK.url);
  assert.equal(outcome.commentStatus, 'not-requested');
});

test('a LinkedIn readback failure is reported as uncertain, never as a clean failure', async () => {
  const session = createBrowserSession({
    runDriver: () => ({ ok: false, stage: 'readback', error: 'post not found on the profile' })
  });
  await assert.rejects(() => session.postLinkedin('text'), /outcome is uncertain/u);
});

test('a pre-publish LinkedIn refusal is reported as a refusal with its stage', async () => {
  for (const stage of ['identity', 'compose', 'media', 'verify-before-publish', 'audience', 'publish']) {
    const session = createBrowserSession({ runDriver: () => ({ ok: false, stage, error: 'nope' }) });
    await assert.rejects(() => session.postLinkedin('text'), new RegExp(`refused at ${stage}`, 'u'));
  }
});

test('empty LinkedIn post text is refused before the driver runs', async () => {
  let called = false;
  const session = createBrowserSession({ runDriver: () => { called = true; return LINKEDIN_OK; } });
  await assert.rejects(() => session.postLinkedin('   '), /non-empty post text/u);
  assert.equal(called, false);
});

test('a first-comment failure never fails the post outcome, only its own status', async () => {
  const session = createBrowserSession({
    runDriver: () => ({ ...LINKEDIN_OK, commentStatus: 'failed', commentError: 'first comment could not be verified as posted' })
  });
  const outcome = await session.postLinkedin({ text: LINKEDIN_OK.text, firstComment: 'https://example.invalid/detail' });
  assert.equal(outcome.commentStatus, 'failed');
  assert.equal(outcome.commentError, 'first comment could not be verified as posted');
});

test('the intended first comment reaches the driver job and a plain string payload is still accepted', async () => {
  let job;
  const session = createBrowserSession({ runDriver: (channel, submittedJob) => { job = submittedJob; return LINKEDIN_OK; } });
  await session.postLinkedin({ text: LINKEDIN_OK.text, firstComment: 'https://example.invalid/detail' });
  assert.equal(job.firstComment, 'https://example.invalid/detail');
  await session.postLinkedin(LINKEDIN_OK.text);
  assert.equal(job.firstComment, '');
});
