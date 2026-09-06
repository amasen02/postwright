'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolvePath, resetConfigCache, CONFIG_FILE, ENV_KEYS } = require('../../src/core/config');

// The config file sits at a fixed path in the tool root, so each test swaps its
// contents and restores the original afterwards.
function withConfigFile(contents, run) {
  const had = fs.existsSync(CONFIG_FILE);
  const original = had ? fs.readFileSync(CONFIG_FILE) : null;
  try {
    if (contents === null) {
      if (had) fs.rmSync(CONFIG_FILE);
    } else {
      fs.writeFileSync(CONFIG_FILE, contents);
    }
    resetConfigCache();
    run();
  } finally {
    if (original === null) {
      if (fs.existsSync(CONFIG_FILE)) fs.rmSync(CONFIG_FILE);
    } else {
      fs.writeFileSync(CONFIG_FILE, original);
    }
    resetConfigCache();
  }
}

test('a present but malformed config fails loudly instead of falling back', () => {
  withConfigFile('{ this is not json', () => {
    assert.throws(() => resolvePath('secretFile'), /is not valid JSON/u);
  });
});

test('a config whose paths is not an object fails loudly', () => {
  withConfigFile(JSON.stringify({ paths: 'C:/somewhere' }), () => {
    assert.throws(() => resolvePath('secretFile'), /"paths" value that is not an object/u);
  });
});

test('an absent config falls back to a generic default without throwing', () => {
  withConfigFile(null, () => {
    const resolved = resolvePath('secretFile');
    assert.equal(path.isAbsolute(resolved), true);
    assert.doesNotMatch(resolved, /twitter-autonomous-agent/u);
  });
});

test('config entries win over environment, and environment wins over the default', () => {
  const key = ENV_KEYS.secretFile;
  const previous = process.env[key];
  try {
    process.env[key] = path.join(path.sep, 'from-env', '.env');
    withConfigFile(JSON.stringify({ paths: { secretFile: '/from-config/.env' } }), () => {
      assert.match(resolvePath('secretFile'), /from-config/u);
    });
    withConfigFile(JSON.stringify({ paths: {} }), () => {
      assert.match(resolvePath('secretFile'), /from-env/u);
    });
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test('an unknown path key is rejected rather than silently resolved', () => {
  assert.throws(() => resolvePath('nope'), /unknown configured path/u);
});
