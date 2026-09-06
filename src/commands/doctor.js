'use strict';
const fs = require('node:fs');
const { resolvePath } = require('../core/config');

const CREDENTIAL_NAMES = ['DEVTO_API_KEY'];

function credentialNamesPresent(file) {
  if (!file || !fs.existsSync(file)) return [];
  const { loadSecrets } = require('../publish/secrets');
  return Object.keys(loadSecrets({ file, names: CREDENTIAL_NAMES }));
}

async function doctor(options = {}) {
  const secretFile = options.secretFile || resolvePath('secretFile');
  const browserPath = options.browserPath || resolvePath('browserHarness');
  const diagifPath = options.diagifPath || resolvePath('diagif');
  const names = credentialNamesPresent(secretFile);
  const checks = [
    { name: 'node', ok: Number(process.versions.node.split('.')[0]) >= 24 },
    { name: 'browser-harness', ok: fs.existsSync(browserPath) },
    { name: 'diagif', ok: fs.existsSync(diagifPath) },
    { name: 'credential source', ok: names.length > 0, names }
  ];
  return { local: true, checks };
}

module.exports = { doctor };
