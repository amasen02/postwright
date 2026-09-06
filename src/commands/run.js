'use strict';
const path = require('node:path');
const { AgentUsageError } = require('../core/errors');
const { draftDir, readJson } = require('../core/store');

const CANONICAL_ORDER = ['x', 'linkedin', 'devto'];

function parseChannels(raw) {
  if (!raw) return CANONICAL_ORDER;
  const list = String(raw).split(',');
  if (!list.every(channel => CANONICAL_ORDER.includes(channel)) || new Set(list).size !== list.length) {
    throw new AgentUsageError('--channels must be a comma-separated, non-repeating list of x, linkedin, devto');
  }
  return list;
}

/**
 * Run the whole pipeline for one topic: draft, then lint, then report exactly what is
 * publishable. Nothing outward happens unless both --release and --confirm are set, and
 * even then each requested channel is released one at a time, stopping at the first
 * refusal or uncertain outcome so a later channel is never attempted past a failure that
 * has not been reconciled.
 */
async function run(topic, options = {}) {
  const channels = parseChannels(options.channels);
  if (options.confirm && !options.release) throw new AgentUsageError('--confirm requires --release');
  if (options.release && !options.confirm) throw new AgentUsageError('Release refused: rerun with --release --confirm to authorize this publish');

  const draftFn = options.draftFn || require('./draft').draft;
  const lintFn = options.lintFn || require('./lint').lint;
  const releaseFn = options.releaseFn || require('./release').release;

  const draftResult = await draftFn(topic, options);
  const slug = draftResult.manifest.slug;
  const lintResult = await lintFn(slug, options);
  const readiness = lintResult.results[0].channels;

  const dir = draftDir(slug, options);
  const manifestAfterLint = readJson(path.join(dir, 'manifest.json'));

  console.log('\nChannel readiness');
  console.log('Channel | Ready | State');
  for (const channel of channels) {
    console.log(`${channel} | ${readiness[channel] ? 'READY' : 'HELD'} | ${manifestAfterLint.channels[channel].state}`);
  }

  let release;
  if (options.release && options.confirm) {
    release = [];
    for (const channel of channels) {
      try {
        const outcome = await releaseFn(slug, { ...options, channel, confirm: true });
        release.push({ channel, status: 'released', ...outcome });
        console.log(`${channel}: released (${outcome.url})`);
      } catch (error) {
        const uncertain = /uncertain/i.test(error.message || '');
        const message = error.safe ? error.message : 'Operation refused or failed; inspect local prerequisites and draft gates.';
        release.push({ channel, status: uncertain ? 'uncertain' : 'refused', error: message });
        console.log(`${channel}: ${uncertain ? 'UNCERTAIN' : 'REFUSED'} - ${message}`);
        break;
      }
    }
  }

  return { slug, dir, topic: draftResult.manifest.topic, channels: readiness, ...(release ? { release } : {}) };
}

module.exports = { run };
