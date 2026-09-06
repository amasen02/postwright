'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildPrompt, SCHEMA } = require('../../src/model/brain');
const { createEditorial } = require('../../src/model/editorial');

test('the prompt states the measured constraints the linter will enforce', () => {
  const prompt = buildPrompt('idempotency keys in REST APIs');
  // Each of these mirrors a lint rule. If a rule's threshold changes, the prompt has to
  // change with it, or the brain writes drafts that are rejected after the model call.
  assert.match(prompt, /questions reached far more people/u, 'R1 evidence');
  assert.match(prompt, /barely distributed at all/u, 'R2 evidence');
  assert.match(prompt, /280 characters/u, 'R3 character limit');
  assert.match(prompt, /AT MOST TWO SENTENCES/u, 'R3 opener sentence limit');
  assert.match(prompt, /NO URL in the LinkedIn body/u, 'R6 evidence');
  assert.match(prompt, /idempotency keys in REST APIs/u, 'topic is included');
});

test('the prompt forbids inventing figures and leaking local identity', () => {
  const prompt = buildPrompt('anything');
  assert.match(prompt, /Do not invent benchmarks/u);
  assert.match(prompt, /Never mention file paths, usernames, email addresses or credentials/u);
});

test('the schema constrains tags to safe dev.to tokens', () => {
  assert.equal(SCHEMA.properties.tags.items.pattern, '^[a-z0-9]+$');
  assert.equal(SCHEMA.additionalProperties, false);
  assert.deepEqual(SCHEMA.required, ['x', 'linkedin', 'article_body', 'tags']);
});

test('a shell shim is refused as the CLI path rather than spawned', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postwright-brain-'));
  const shim = path.join(dir, 'claude.cmd');
  try {
    fs.writeFileSync(shim, '@echo off\n');
    // Spawning a .cmd with shell:false raises EINVAL on Node 24, and enabling the shell
    // would make these arguments injectable. Refusing is the only safe outcome.
    const { generateEditorial } = require('../../src/model/brain');
    // Assert the specific guard, not merely "it threw": spawning the shim would also
    // throw, via EINVAL, and that would hide the guard being bypassed.
    assert.throws(() => generateEditorial('topic', { executable: shim }),
      /must be a native executable, not a shell shim/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('template mode is marked as template so filler is never mistaken for real content', () => {
  const result = createEditorial('some unfamiliar topic', { brain: 'template' });
  assert.equal(result.generated, 'template');
  assert.equal(typeof result.x, 'string');
});

test('createEditorial defaults to template and never calls a provider implicitly', () => {
  const result = createEditorial('another unfamiliar topic');
  assert.equal(result.generated, 'template');
});
