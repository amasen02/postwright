'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { resolvePath } = require('../core/config');

const CANONICAL = { x: 'amasen02', linkedin: '/in/ama-sen/', devto: 'amasen' };

// Three distinct outcomes. "unknown" exists because a probe that cannot run tells us
// nothing, and reporting that as `unauthenticated` is a fabricated negative: it reads
// as a definite answer and hides a broken probe.
const STATUS = { yes: 'authenticated', no: 'unauthenticated', unknown: 'unknown' };

function sanitize(value) {
  return typeof value === 'string' && value ? value : undefined;
}

async function defaultCheckDevto() {
  const { loadSecrets } = require('../publish/secrets');
  const file = resolvePath('secretFile');
  const secrets = loadSecrets({ file, names: ['DEVTO_API_KEY'] });
  if (!secrets.DEVTO_API_KEY) return { authenticated: false, status: STATUS.no, reason: 'no credential source' };
  try {
    const response = await fetch('https://dev.to/api/users/me', {
      method: 'GET',
      headers: { 'api-key': secrets.DEVTO_API_KEY, Accept: 'application/vnd.forem.api-v1+json', 'User-Agent': 'postwright/0.1.0' },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) return { authenticated: false, status: STATUS.no };
    const identity = await response.json();
    return { authenticated: true, status: STATUS.yes, account: identity.username };
  } catch {
    // Network fault, timeout, or a malformed body: we did not establish anything.
    return { authenticated: false, status: STATUS.unknown, reason: 'provider unreachable' };
  }
}

const PROBE = `
from urllib.parse import urlsplit
hosts = set()
for tab in list_tabs():
    if isinstance(tab, dict):
        h = urlsplit(tab.get("url", "")).hostname or ""
        if h:
            hosts.add(h.lower())
print("HOSTS:" + ",".join(sorted(hosts)))
`;

/**
 * Ask the running browser which sites currently have an open tab. An open tab on the
 * site is evidence that a session probably exists; it is not proof of a logged-in
 * account, so this reports presence and leaves account verification to release time.
 */
async function defaultInspectBrowser() {
  const harness = resolvePath('browserHarness');
  if (!fs.existsSync(harness)) {
    return { x: { status: STATUS.unknown, reason: 'browser-harness not installed' },
      linkedin: { status: STATUS.unknown, reason: 'browser-harness not installed' } };
  }
  const result = spawnSync(harness, [], {
    input: PROBE, encoding: 'utf8', shell: false, timeout: 60000,
    env: { ...process.env, BH_RECORD: '0' }
  });
  const line = String(result.stdout || '').split(/\r?\n/u).find(l => l.startsWith('HOSTS:'));
  if (result.error || result.status !== 0 || !line) {
    return { x: { status: STATUS.unknown, reason: 'browser probe did not report' },
      linkedin: { status: STATUS.unknown, reason: 'browser probe did not report' } };
  }
  const hosts = line.slice('HOSTS:'.length).split(',').filter(Boolean);
  const has = suffix => hosts.some(h => h === suffix || h.endsWith('.' + suffix));
  return {
    x: has('x.com') ? { authenticated: true, status: STATUS.yes } : { authenticated: false, status: STATUS.no },
    linkedin: has('linkedin.com') ? { authenticated: true, status: STATUS.yes } : { authenticated: false, status: STATUS.no }
  };
}

function shape(name, raw) {
  return {
    account: sanitize(raw?.account) || CANONICAL[name],
    authenticated: raw?.authenticated === true,
    status: raw?.status || (raw?.authenticated === true ? STATUS.yes : STATUS.no)
  };
}

async function safeCheck(name, fn) {
  try {
    return shape(name, await fn());
  } catch {
    // Never let a provider's error text reach the result: it can carry a token,
    // a cookie, or a full request dump.
    return { account: CANONICAL[name], authenticated: false, status: STATUS.unknown };
  }
}

async function auth(deps = {}) {
  const checkDevto = deps.checkDevto || defaultCheckDevto;
  const inspectBrowser = deps.inspectBrowser || defaultInspectBrowser;
  let browser = {};
  let browserFailed = false;
  try {
    browser = (await inspectBrowser()) || {};
  } catch {
    browser = {};
    browserFailed = true;
  }
  const fromBrowser = (name, key) => {
    const raw = browser[key];
    if (browserFailed || raw === undefined) return { account: CANONICAL[name], authenticated: false, status: STATUS.unknown };
    return shape(name, raw);
  };
  const x = fromBrowser('x', 'x');
  const linkedin = fromBrowser('linkedin', 'linkedin');
  const devto = await safeCheck('devto', checkDevto);
  return { accounts: [x, linkedin, devto] };
}

module.exports = { auth, STATUS };
