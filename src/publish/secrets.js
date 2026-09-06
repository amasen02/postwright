'use strict';
const fs = require('node:fs');

function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function loadSecrets({ file, names } = {}) {
  if (!Array.isArray(names) || !names.length) throw new Error('loadSecrets requires an allowlist of names');
  if (!file || !fs.existsSync(file)) return {};
  const parsed = parseEnvFile(fs.readFileSync(file, 'utf8'));
  const result = {};
  for (const name of names) if (Object.hasOwn(parsed, name)) result[name] = parsed[name];
  return result;
}

module.exports = { loadSecrets };
