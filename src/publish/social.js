'use strict';
const { AgentUsageError } = require('../core/errors');

// Both paths exist so `release --confirm` can reach a real publish call, but neither
// fires without an operator-provided browserSession: this execution never wires one in.

async function publishX(payload, { browserSession } = {}) {
  if (!browserSession || typeof browserSession.postX !== 'function') {
    throw new AgentUsageError('X release requires an authorized browser-harness session; none was provided');
  }
  return browserSession.postX(payload.posts);
}

async function publishLinkedin(payload, { browserSession } = {}) {
  if (!browserSession || typeof browserSession.postLinkedin !== 'function') {
    throw new AgentUsageError('LinkedIn release requires an authorized browser-harness session; none was provided');
  }
  return browserSession.postLinkedin({ text: payload.text, firstComment: payload.firstComment || '' });
}

module.exports = { publishX, publishLinkedin };
