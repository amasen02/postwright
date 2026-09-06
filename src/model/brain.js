'use strict';

// A real editorial brain. Without one, `createEditorial` falls back to a template that
// slots the topic into fixed sentences: it satisfies the form rules while carrying no
// information, which is worse than no draft because it looks finished.
//
// The prompt below states the account's own measured constraints so the model writes
// something that passes R1-R12 on substance rather than being patched afterwards.

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { AgentProviderUnavailable, AgentProviderError, AgentSchemaError } = require('../core/errors');
const { resolvePath } = require('../core/config');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'linkedin', 'article_body', 'tags'],
  properties: {
    x: {
      type: 'string',
      description: 'The X post. First line MUST be a question, or a claim naming one concrete mistake and its replacement. At most 280 characters. No links. No emoji header. No all-caps header.'
    },
    linkedin: {
      type: 'string',
      description: 'The LinkedIn post. No URLs anywhere in the body. Plain sentences, no emoji header, no all-caps header.'
    },
    article_body: {
      type: 'string',
      description: 'The dev.to article body in Markdown, without front matter and without a top-level H1. 400-900 words. Use ## subheadings and at least one fenced code block where it genuinely helps.'
    },
    tags: {
      type: 'array', minItems: 2, maxItems: 4,
      items: { type: 'string', pattern: '^[a-z0-9]+$' },
      description: 'dev.to tags, lowercase alphanumeric, no punctuation.'
    }
  }
};

function buildPrompt(topic) {
  return [
    'You are drafting developer content for one engineer\'s own accounts. Write in their voice:',
    'direct, specific, no marketing tone, no hype, no emoji.',
    '',
    `TOPIC: ${topic}`,
    '',
    'These constraints come from measured performance of this exact account. They are not style',
    'preferences, they are what did and did not get distribution:',
    '',
    '- One-line questions reached far more people than a full explainer post did.',
    '  So the X post opens with a question, or with a claim naming one concrete mistake and its',
    '  replacement. Never open with a topic announcement such as "Here is how X works".',
    '- Posts formatted as an emoji plus an ALL-CAPS header were barely distributed at all.',
    '  Never use that format. No leading emoji. No all-caps header line.',
    '- The single most-bookmarked post named a specific action to stop and a specific action to',
    '  start. Name concrete, checkable things: a header, a flag, a function, a failure mode.',
    '  Avoid the words system, solution and approach as stand-ins for something specific.',
    '- LinkedIn posts carrying outbound links in the body reached only a small fraction of',
    '  the followers they should have. Put NO URL in the LinkedIn body at all.',
    '- Each post carries exactly one idea. The X post stays under 280 characters and asks at',
    '  most one question.',
    '',
    'Hard shape for the X post, checked automatically before anything can be published:',
    '- Under 280 characters in total.',
    '- Exactly one question mark, or none.',
    '- Write it as a hook line, then a blank line, then the payoff. AT MOST TWO SENTENCES may',
    '  appear before that blank line. Put any further sentence after it. A third sentence in',
    '  the opening block is rejected outright, so prefer one short opening sentence.',
    '- STRONGLY PREFER making that first line a question. Questions are what actually reached',
    '  this account\'s audience. A first line that only states a symptom is rejected: if you do',
    '  not use a question, the first line must name BOTH the specific mistake AND its',
    '  replacement, in that one line.',
    '',
    'Accuracy rules:',
    '- State only what you are confident is true of this topic. Do not invent benchmarks,',
    '  version numbers, study results, company names or quotations.',
    '- If a number would need a source you do not have, describe the effect qualitatively',
    '  instead of inventing a figure.',
    '- Never mention file paths, usernames, email addresses or credentials.',
    '',
    'The article explains the same idea as the posts, in depth, for a working engineer who',
    'already knows the surrounding technology. Lead with the failure the reader recognises.',
    'Return only the structured object.'
  ].join('\n');
}

function resolveClaudeExecutable(options = {}) {
  const configured = options.executable || resolvePath('claudeCli');
  // The shim guard applies to every resolved path, injected ones included: routing an
  // injected path around it is exactly how a .cmd would reach spawn in production.
  // Node 24 raises EINVAL spawning a .cmd with shell:false, and enabling the shell
  // would make these arguments injectable.
  if (/\.(cmd|bat|ps1)$/iu.test(configured)) {
    throw new AgentProviderUnavailable('Claude CLI path must be a native executable, not a shell shim');
  }
  if (!fs.existsSync(configured)) {
    throw new AgentProviderUnavailable('Claude CLI not found; configure paths.claudeCli or pass --brain template');
  }
  return configured;
}

/**
 * Generate editorial content for one topic using the Claude CLI.
 * Throws rather than returning degraded content: the caller decides whether to fall back.
 */
function generateEditorial(topic, options = {}) {
  const executable = resolveClaudeExecutable(options);
  const model = options.model || 'claude-sonnet-5';
  const args = [
    '-p', '--output-format', 'json',
    '--json-schema', JSON.stringify(SCHEMA),
    '--tools', '',
    // --json-schema returns the object through a tool call, so the run needs the tool-use
    // turn plus a wrap-up turn. With --max-turns 1 it intermittently ends as
    // error_max_turns with stop_reason "tool_use" after the content was already produced.
    '--max-turns', '4',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--model', model
  ];
  const result = spawnSync(executable, args, {
    input: buildPrompt(topic),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeoutMs || 300000,
    maxBuffer: 8 * 1024 * 1024,
    // Never inherit a redirected endpoint: a stale gateway variable would silently send
    // this prompt somewhere other than the operator's own subscription.
    env: { ...process.env, ANTHROPIC_BASE_URL: undefined, ANTHROPIC_AUTH_TOKEN: undefined }
  });
  if (result.error) throw new AgentProviderUnavailable('Claude CLI could not be started');
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw new AgentProviderError('Claude CLI did not return a JSON envelope');
  }
  // Parse the envelope structurally. The exit code alone is not a verdict: a quota or
  // overload turn can still exit 0.
  if (envelope.is_error !== false || !(envelope.num_turns >= 1)) {
    throw new AgentProviderError('Claude CLI reported a failed turn');
  }
  let value = envelope.structured_output;
  if (value === undefined || value === null) {
    if (typeof envelope.result !== 'string') throw new AgentProviderError('Claude CLI produced no structured output');
    const match = /\{[\s\S]*\}/u.exec(envelope.result);
    if (!match) throw new AgentSchemaError('Claude CLI output contained no JSON object');
    try { value = JSON.parse(match[0]); } catch { throw new AgentSchemaError('Claude CLI output was not parseable JSON'); }
  }
  for (const key of SCHEMA.required) {
    if (value[key] === undefined || value[key] === null) throw new AgentSchemaError(`Claude CLI output is missing "${key}"`);
  }
  if (typeof value.x !== 'string' || typeof value.linkedin !== 'string' || typeof value.article_body !== 'string') {
    throw new AgentSchemaError('Claude CLI output has a non-string field');
  }
  if (!Array.isArray(value.tags) || !value.tags.every(t => typeof t === 'string' && /^[a-z0-9]+$/u.test(t))) {
    throw new AgentSchemaError('Claude CLI output has malformed tags');
  }
  return {
    x: value.x.trim(),
    linkedin: value.linkedin.trim(),
    articleBody: value.article_body.trim(),
    tags: value.tags.slice(0, 4),
    provider: 'claude-cli',
    model
  };
}

module.exports = { generateEditorial, SCHEMA, buildPrompt };
