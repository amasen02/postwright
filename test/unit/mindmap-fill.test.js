'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { measureMindmapFill } = require('../../src/analysis/mindmap-fill');

test('parses the JSON result from the first working python candidate', () => {
  const calls = [];
  const spawnSync = (command, args) => {
    calls.push({ command, args });
    return { status: 0, stdout: JSON.stringify({ width: 800, height: 1100, topEmptyRows: 100, bottomEmptyRows: 50, emptyFraction: 0.136 }) };
  };
  const result = measureMindmapFill('/tmp/x.gif', { spawnSync, platform: 'linux' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'python3');
  assert.equal(calls[0].args.at(-1), '/tmp/x.gif');
  assert.deepEqual(result, { width: 800, height: 1100, topEmptyRows: 100, bottomEmptyRows: 50, emptyFraction: 0.136 });
});

test('falls back through windows candidates in order and returns null when all fail', () => {
  const calls = [];
  const spawnSync = command => { calls.push(command); return { status: 1, stdout: '', error: new Error('not found') }; };
  const result = measureMindmapFill('/tmp/x.gif', { spawnSync, platform: 'win32' });
  assert.deepEqual(calls, ['py', 'python']);
  assert.equal(result, null);
});

test('malformed stdout is treated as unavailable rather than thrown', () => {
  const spawnSync = () => ({ status: 0, stdout: 'not json' });
  assert.equal(measureMindmapFill('/tmp/x.gif', { spawnSync, platform: 'linux' }), null);
});

test('a throwing spawn implementation is treated as unavailable rather than propagated', () => {
  const spawnSync = () => { throw new Error('spawn EPERM'); };
  assert.equal(measureMindmapFill('/tmp/x.gif', { spawnSync, platform: 'linux' }), null);
});
