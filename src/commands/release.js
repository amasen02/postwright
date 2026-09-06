'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { roots, draftDir, readJson, atomicJson, payloadHash } = require('../core/store');
const { AgentUsageError } = require('../core/errors');
const { lintDraft } = require('../core/lint');

const EXPECTED_OWNER = { x: 'amasen02', linkedin: '/in/ama-sen/', devto: 'amasen' };
const CADENCE_WINDOW_MS = 60 * 60 * 1000;
const CADENCE_LIMIT = 2;

const BOM = String.fromCharCode(0xfeff);
function read(file) { const text = fs.readFileSync(file, 'utf8'); return text.startsWith(BOM) ? text.slice(1) : text; }

function buildPayload(channel, dir) {
  if (channel === 'x') {
    const content = read(path.join(dir, 'post-x.md'));
    return { posts: content.split(/\r?\n---\r?\n/u).map(part => part.trim()).filter(Boolean) };
  }
  if (channel === 'linkedin') {
    const firstCommentPath = path.join(dir, 'first-comment.md');
    return {
      text: read(path.join(dir, 'post-linkedin.md')).trim(),
      firstComment: fs.existsSync(firstCommentPath) ? read(firstCommentPath).trim() : ''
    };
  }
  const { parseDevtoArticle } = require('../publish/devto');
  return parseDevtoArticle(read(path.join(dir, 'article-devto.md')));
}

function verifyReadback(channel, payload, outcome) {
  if (!outcome || outcome.owner !== EXPECTED_OWNER[channel]) return false;
  if (channel === 'x') {
    return Array.isArray(outcome.texts) && outcome.texts.length === payload.posts.length
      && outcome.texts.every((text, index) => String(text).trim() === payload.posts[index].trim());
  }
  if (channel === 'linkedin') return typeof outcome.text === 'string' && outcome.text.trim() === payload.text.trim();
  return typeof outcome.title === 'string' && outcome.title.trim() === payload.title.trim();
}

function defaultPublisher(channel, dir) {
  return async payload => {
    if (channel === 'devto') {
      const { publishDevto } = require('../publish/devto');
      const { loadSecrets } = require('../publish/secrets');
      const secrets = loadSecrets({ names: ['DEVTO_API_KEY'] });
      if (!secrets.DEVTO_API_KEY) throw new AgentUsageError('DEVTO_API_KEY is required in the machine secret store');
      return publishDevto(payload, { apiKey: secrets.DEVTO_API_KEY });
    }
    const { publishX, publishLinkedin } = require('../publish/social');
    // The browser session is constructed only inside a confirmed release, so no other
    // code path can reach a control that makes something public.
    const { createBrowserSession } = require('../publish/browser-session');
    const mediaPath = path.join(dir, 'asset.gif');
    const browserSession = createBrowserSession({ media: fs.existsSync(mediaPath) ? mediaPath : null });
    return channel === 'x' ? publishX(payload, { browserSession }) : publishLinkedin(payload, { browserSession });
  };
}

function recentReservationCount(receiptsDir, excludeFile) {
  if (!fs.existsSync(receiptsDir)) return 0;
  const now = Date.now();
  let count = 0;
  for (const name of fs.readdirSync(receiptsDir)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(receiptsDir, name);
    if (path.resolve(file) === path.resolve(excludeFile)) continue;
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    if (!['released', 'inflight'].includes(receipt.status)) continue;
    const age = now - fs.statSync(file).mtimeMs;
    if (age < CADENCE_WINDOW_MS) count++;
  }
  return count;
}

async function release(slug, options = {}) {
  if (!options.confirm) throw new AgentUsageError('Release refused: rerun with --confirm to authorize this publish');
  const channel = options.channel;
  const { draftsRoot, privateRoot } = roots(options);
  const dir = draftDir(slug, options);
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest = readJson(manifestFile);
  const receiptsDir = path.join(privateRoot, 'receipts');
  const receiptFile = path.join(receiptsDir, `${slug}-${channel}.json`);

  if (fs.existsSync(receiptFile)) throw new AgentUsageError(`Release refused: ${slug}/${channel} already has a durable release reservation`);
  if (recentReservationCount(receiptsDir, receiptFile) >= CADENCE_LIMIT) {
    throw new AgentUsageError('Release refused: two other releases or reservations were recorded in the preceding 60 minutes');
  }

  const lintDraftFn = options.lintDraft || lintDraft;
  const lintResult = await lintDraftFn(dir, { ...options, draftsRoot, privateRoot });
  if (!lintResult.channels[channel]) throw new AgentUsageError(`Release refused: ${channel} channel does not pass lint`);

  const currentHash = payloadHash(dir, channel);
  const recordedHash = manifest.channels?.[channel]?.payload_hash;
  if (recordedHash && recordedHash !== currentHash) throw new AgentUsageError(`Release refused: ${channel} content has changed since lint`);

  const payload = buildPayload(channel, dir);
  fs.mkdirSync(receiptsDir, { recursive: true });
  atomicJson(receiptFile, { account: EXPECTED_OWNER[channel], channel, payload_hash: currentHash, status: 'inflight' });

  const publisher = options.publisher || defaultPublisher(channel, dir);
  let outcome;
  try {
    outcome = await publisher(payload, { receiptFile, dir, manifestFile });
  } catch {
    throw new AgentUsageError('Release outcome is uncertain; verify manually before any retry');
  }
  if (!verifyReadback(channel, payload, outcome)) throw new AgentUsageError(`Release refused: readback verification failed for ${channel}`);

  atomicJson(receiptFile, { account: outcome.owner, channel, payload_hash: currentHash, status: 'released', id: String(outcome.id), url: outcome.url });
  manifest.channels[channel] = { ...manifest.channels[channel], state: 'released', releasedAt: new Date().toISOString(), payload_hash: currentHash };
  atomicJson(manifestFile, manifest);
  return { status: 'released', account: outcome.owner, id: String(outcome.id), url: outcome.url };
}

module.exports = { release };
