'use strict';

// Drives the operator's already-authorized browser session through browser-harness.
// This is the only place in postwright that can cause something to become public, so it
// verifies the composed text before publishing and reads the result back afterwards.
// A click is not evidence; only the post found on the profile is.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AgentUsageError } = require('../core/errors');
const { resolvePath } = require('../core/config');

const DRIVERS = { x: path.join(__dirname, 'x_publish.py'), linkedin: path.join(__dirname, 'linkedin_publish.py') };
const JOB_ENV = { x: 'POSTWRIGHT_X_JOB', linkedin: 'POSTWRIGHT_LINKEDIN_JOB' };

function runDriver(channel, job, options = {}) {
  const harness = options.browserHarness || resolvePath('browserHarness');
  if (!fs.existsSync(harness)) throw new AgentUsageError('browser-harness is not installed at the configured path');
  const driver = DRIVERS[channel];
  if (!driver) throw new AgentUsageError(`no browser driver for channel "${channel}"`);

  const jobFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'postwright-' + channel + '-')), 'job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job), { mode: 0o600 });
  try {
    const result = spawnSync(harness, [], {
      input: fs.readFileSync(driver, 'utf8'),
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: options.timeoutMs || 300000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, BH_RECORD: '0', [JOB_ENV[channel]]: jobFile }
    });
    if (result.error) throw new AgentUsageError('browser-harness could not be started');
    const line = String(result.stdout || '').split(/\r?\n/u).find(l => l.startsWith('RESULT:'));
    if (!line) {
      // No verdict at all. The post may or may not have gone out, so this must be
      // reported as uncertain rather than as a failure the caller may safely retry.
      throw new AgentUsageError('Browser driver returned no verdict; verify the account manually before any retry');
    }
    return JSON.parse(line.slice('RESULT:'.length));
  } finally {
    fs.rmSync(path.dirname(jobFile), { recursive: true, force: true });
  }
}

/**
 * Publish a single X post. `posts` may hold a thread, but only a single post is supported
 * here: publishing part of a thread and failing midway leaves the account in a state this
 * cannot reconcile, so it refuses rather than half-publishing.
 */
function createBrowserSession(options = {}) {
  const handle = options.handle || 'amasen02';
  const linkedinProfile = options.linkedinProfile || '/in/ama-sen/';
  const drive = options.runDriver || runDriver;
  return {
    async postX(posts) {
      if (!Array.isArray(posts) || posts.length !== 1) {
        throw new AgentUsageError('This session publishes exactly one X post; threads are not supported yet');
      }
      const verdict = drive('x', { text: posts[0], handle, media: options.media || null }, options);
      if (!verdict.ok) {
        const stage = verdict.stage || 'unknown';
        if (stage === 'readback') {
          throw new AgentUsageError(`Release outcome is uncertain at readback: ${verdict.error}`);
        }
        throw new AgentUsageError(`X release refused at ${stage}: ${verdict.error}`);
      }
      // Shape matches what release.verifyReadback expects.
      return { owner: verdict.owner, texts: [verdict.text], url: verdict.url, id: verdict.url };
    },
    /**
     * Publish one LinkedIn post and, if `firstComment` is non-empty, attempt to post it as
     * the first comment. The post itself is irreversible once published: a first-comment
     * failure never makes this reject, so a caller can never mistake it for a reason to
     * retry the post. `payload` may be a string (post text only) for callers that never
     * need a first comment.
     */
    async postLinkedin(payload) {
      const text = typeof payload === 'string' ? payload : payload.text;
      const firstComment = typeof payload === 'string' ? '' : (payload.firstComment || '');
      if (typeof text !== 'string' || !text.trim()) {
        throw new AgentUsageError('LinkedIn release requires non-empty post text');
      }
      const verdict = drive('linkedin', { text, firstComment, profile: linkedinProfile, media: options.media || null }, options);
      if (!verdict.ok) {
        const stage = verdict.stage || 'unknown';
        if (stage === 'readback') {
          throw new AgentUsageError(`Release outcome is uncertain at readback: ${verdict.error}`);
        }
        throw new AgentUsageError(`LinkedIn release refused at ${stage}: ${verdict.error}`);
      }
      // Shape matches what release.verifyReadback expects, plus a first-comment status
      // that never affects whether this call resolves or rejects.
      return { owner: verdict.owner, text: verdict.text, url: verdict.url, id: verdict.url, commentStatus: verdict.commentStatus, commentError: verdict.commentError };
    }
  };
}

module.exports = { createBrowserSession, runDriver };
