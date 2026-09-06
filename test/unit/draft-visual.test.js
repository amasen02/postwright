'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');
const assert = require('node:assert/strict');
const { draft, defaultMakeGif } = require('../../src/commands/draft');

function fakeDiagifRun(t, bytes = Buffer.from('GIF89a-fake-mindmap')) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postwright-diagif-run-'));
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(runDir, 'asset.gif'), bytes);
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ status: 'delivered', artifacts: { gif: 'asset.gif' } }));
  return runDir;
}

test('defaultMakeGif calls diagif "mindmap" for --visual mindmap and "make" for the default', async t => {
  let seenArgs;
  const spawnDiagif = (exe, args) => {
    seenArgs = args;
    return { status: 0, stdout: `done: ${fakeDiagifRun(t)}\n` };
  };
  const mindmap = await defaultMakeGif('topic', { visual: 'mindmap', spawnDiagif });
  assert.equal(seenArgs[1], 'mindmap');
  assert.equal(mindmap.visual, 'mindmap');

  const diagram = await defaultMakeGif('topic', { spawnDiagif });
  assert.equal(seenArgs[1], 'make');
  assert.equal(diagram.visual, 'diagram');
});

test('an under-filled mindmap frame is recorded as a visualWarning without failing the draft', async t => {
  const spawnDiagif = () => ({ status: 0, stdout: `done: ${fakeDiagifRun(t)}\n` });
  const measureMindmapFill = () => ({ width: 800, height: 1100, topEmptyRows: 200, bottomEmptyRows: 200, emptyFraction: 0.4 });
  const made = await defaultMakeGif('topic', { visual: 'mindmap', spawnDiagif, measureMindmapFill });
  assert.match(made.visualWarning, /under-filled/);
  assert.match(made.visualWarning, /40%/);
});

test('a well-filled mindmap frame or an unavailable measurement records no visualWarning', async t => {
  const spawnDiagif = () => ({ status: 0, stdout: `done: ${fakeDiagifRun(t)}\n` });
  const wellFilled = await defaultMakeGif('topic', { visual: 'mindmap', spawnDiagif, measureMindmapFill: () => ({ emptyFraction: 0.1 }) });
  assert.equal(wellFilled.visualWarning, undefined);
  const unavailable = await defaultMakeGif('topic', { visual: 'mindmap', spawnDiagif, measureMindmapFill: () => null });
  assert.equal(unavailable.visualWarning, undefined);
});

test('the diagram visual never measures mindmap fill', async t => {
  let called = false;
  const spawnDiagif = () => ({ status: 0, stdout: `done: ${fakeDiagifRun(t)}\n` });
  const measureMindmapFill = () => { called = true; return null; };
  await defaultMakeGif('topic', { spawnDiagif, measureMindmapFill });
  assert.equal(called, false);
});

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'postwright-draft-visual-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('draft records the chosen visual kind and any visualWarning in the manifest', async t => {
  const out = workspace(t);
  const withWarning = await draft('topic one', {
    out, visual: 'mindmap', makeGif: async () => ({ sourcePath: '', outputPath: (() => {
      const p = path.join(out, 'a.gif'); fs.writeFileSync(p, Buffer.from('GIF89a')); return p;
    })(), failures: [], footer: '', visual: 'mindmap', visualWarning: 'mind map is under-filled: 40% of frame height is empty at the top/bottom' })
  });
  assert.equal(withWarning.manifest.visual, 'mindmap');
  assert.equal(withWarning.manifest.gif.visualWarning, 'mind map is under-filled: 40% of frame height is empty at the top/bottom');

  const out2 = workspace(t);
  const defaultVisual = await draft('topic two', { out: out2, noGif: true });
  assert.equal(defaultVisual.manifest.visual, 'diagram');
  assert.equal(defaultVisual.manifest.gif.visualWarning, undefined);
});
