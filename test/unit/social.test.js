'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { publishX, publishLinkedin } = require('../../src/publish/social');

test('publishX refuses without an authorized browser session', async () => {
  await assert.rejects(() => publishX({ posts: ['text'] }, {}), /authorized browser-harness session/u);
});

test('publishX forwards the post array to the browser session', async () => {
  let seen;
  const browserSession = { postX: async posts => { seen = posts; return { owner: 'amasen02', texts: posts, url: 'https://x.com/amasen02/status/1', id: '1' }; } };
  const outcome = await publishX({ posts: ['one post'] }, { browserSession });
  assert.deepEqual(seen, ['one post']);
  assert.equal(outcome.owner, 'amasen02');
});

test('publishLinkedin refuses without an authorized browser session', async () => {
  await assert.rejects(() => publishLinkedin({ text: 'text' }, {}), /authorized browser-harness session/u);
});

test('publishLinkedin forwards the post text and first-comment content to the browser session', async () => {
  let seen;
  const browserSession = { postLinkedin: async payload => { seen = payload; return { owner: '/in/ama-sen/', text: payload.text, url: 'https://www.linkedin.com/feed/update/urn:li:activity:1', id: 'urn:li:activity:1' }; } };
  await publishLinkedin({ text: 'An idempotency key prevents a duplicate charge.', firstComment: 'https://example.invalid/detail' }, { browserSession });
  assert.deepEqual(seen, { text: 'An idempotency key prevents a duplicate charge.', firstComment: 'https://example.invalid/detail' });
});

test('publishLinkedin defaults a missing first comment to an empty string rather than undefined', async () => {
  let seen;
  const browserSession = { postLinkedin: async payload => { seen = payload; return { owner: '/in/ama-sen/', text: payload.text, url: 'https://www.linkedin.com/feed/update/urn:li:activity:1', id: 'urn:li:activity:1' }; } };
  await publishLinkedin({ text: 'No links here.' }, { browserSession });
  assert.equal(seen.firstComment, '');
});
