'use strict';

// Machine-local paths must never be baked into this repository: it is destined to be
// published, and a committed "C:\Users\<name>\..." leaks the operator's local layout.
// Resolution order for every path is config file, then environment, then a generic
// platform default. The config file lives beside the tool root and is gitignored.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_FILE = path.join(ROOT, 'postwright.config.json');

let cached = null;

function readConfig() {
  if (cached) return cached;
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  } catch (err) {
    // No config file is the normal case on a fresh install: fall back to defaults.
    // Any other read error is a real fault and must not be mistaken for "absent".
    if (err.code === 'ENOENT') {
      cached = {};
      return cached;
    }
    throw new Error(`postwright config at ${CONFIG_FILE} could not be read: ${err.code}`);
  }
  // A present-but-broken config must fail loudly. Silently falling back to a default
  // path would send a credential lookup somewhere the operator never configured, and
  // report a clean "not found" instead of the actual misconfiguration.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`postwright config at ${CONFIG_FILE} is not valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`postwright config at ${CONFIG_FILE} must contain a JSON object`);
  }
  if (parsed.paths !== undefined && (typeof parsed.paths !== 'object' || parsed.paths === null)) {
    throw new Error(`postwright config at ${CONFIG_FILE} has a "paths" value that is not an object`);
  }
  cached = parsed.paths || {};
  return cached;
}

const GENERIC = {
  // A dotfile under the home directory is the portable default for a fresh install.
  secretFile: path.join(os.homedir(), '.postwright', '.env'),
  browserHarness: process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Roaming', 'Python', 'Python312', 'Scripts', 'browser-harness.exe')
    : path.join(os.homedir(), '.local', 'bin', 'browser-harness'),
  diagif: path.join(ROOT, '..', 'tech-gifs', 'bin', 'diagif.js'),
  claudeCli: process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    : path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude')
};

const ENV_KEYS = {
  secretFile: 'POSTWRIGHT_SECRET_FILE',
  browserHarness: 'POSTWRIGHT_BROWSER_HARNESS',
  diagif: 'POSTWRIGHT_DIAGIF',
  claudeCli: 'POSTWRIGHT_CLAUDE_CLI'
};

/**
 * Resolve one configured path. Never returns a value copied from another machine's
 * layout: an unset key falls back to a generic, platform-appropriate default.
 */
function resolvePath(key) {
  if (!Object.prototype.hasOwnProperty.call(GENERIC, key)) {
    throw new Error(`unknown configured path: ${key}`);
  }
  const fromConfig = readConfig()[key];
  if (typeof fromConfig === 'string' && fromConfig.trim()) return path.resolve(fromConfig.trim());
  const fromEnv = process.env[ENV_KEYS[key]];
  if (typeof fromEnv === 'string' && fromEnv.trim()) return path.resolve(fromEnv.trim());
  return path.resolve(GENERIC[key]);
}

/** Test seam: drop the memoised config so a fixture can rewrite it. */
function resetConfigCache() {
  cached = null;
}

module.exports = { resolvePath, resetConfigCache, CONFIG_FILE, ENV_KEYS };
