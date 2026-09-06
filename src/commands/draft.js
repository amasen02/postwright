'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { draftDir, atomicJson, payloadHash } = require('../core/store');
const { createEditorial, slugify } = require('../model/editorial');
const { OPERATOR_LINKEDIN } = require('../core/lint');
const { resolvePath } = require('../core/config');
const { measureMindmapFill } = require('../analysis/mindmap-fill');

function ensureTrailingNewline(text) { return text.endsWith('\n') ? text : text + '\n'; }

function visualKind(options) { return options.visual === 'mindmap' ? 'mindmap' : 'diagram'; }

async function defaultMakeGif(topic, options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'postwright-diagif-'));
  const diagifBin = resolvePath('diagif');
  const visual = visualKind(options);
  const args = [visual === 'mindmap' ? 'mindmap' : 'make', topic, '--out', tmp, '--brain', options.gifBrain || 'mock'];
  // diagif discovers its own config relative to the spawning process's cwd, not its
  // script location, so an explicit --config is required to pick up its brand footer.
  const diagifConfig = path.join(path.dirname(diagifBin), '..', 'diagif.config.json');
  if (fs.existsSync(diagifConfig)) args.push('--config', diagifConfig);
  const spawnDiagif = options.spawnDiagif || spawnSync;
  const result = spawnDiagif(process.execPath, [diagifBin, ...args], { encoding: 'utf8', shell: false, timeout: 15 * 60 * 1000 });
  if (result.error) throw new Error('diagif could not be started');
  if (result.status !== 0) throw new Error('diagif exited with a non-zero status');
  const lines = (result.stdout || '').trim().split(/\r?\n/u).filter(Boolean);
  const lastLine = lines.at(-1) || '';
  const sep = lastLine.indexOf(': ');
  if (sep === -1) throw new Error('diagif produced no run directory');
  const runDir = lastLine.slice(sep + 2).trim();
  const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  if (!run.artifacts || !run.artifacts.gif) throw new Error('diagif run recorded no gif artifact');
  const outputPath = path.resolve(runDir, run.artifacts.gif);
  if (!fs.existsSync(outputPath)) throw new Error('diagif gif artifact is missing on disk');
  const failures = run.status === 'delivered' ? [] : [`diagif run status was "${run.status}"`];
  const footer = run.config?.brandStyle === 'url-footer' ? OPERATOR_LINKEDIN : '';
  let visualWarning;
  if (visual === 'mindmap') {
    const measure = options.measureMindmapFill || measureMindmapFill;
    const fill = measure(outputPath, options);
    if (fill && fill.emptyFraction > 0.25) {
      visualWarning = `mind map is under-filled: ${Math.round(fill.emptyFraction * 100)}% of frame height is empty at the top/bottom`;
    }
  }
  return { sourcePath: outputPath, outputPath, failures, footer, visual, visualWarning };
}

async function draft(topic, options = {}) {
  const editorial = createEditorial(topic, options);
  const slug = slugify(editorial.topic);
  const dir = draftDir(slug, options);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'post-x.md'), ensureTrailingNewline(editorial.x));
  fs.writeFileSync(path.join(dir, 'post-linkedin.md'), ensureTrailingNewline(editorial.linkedin));
  fs.writeFileSync(path.join(dir, 'article-devto.md'), ensureTrailingNewline(editorial.article));
  fs.writeFileSync(path.join(dir, 'first-comment.md'), '');

  let gif;
  if (options.noGif) {
    gif = { failures: [] };
  } else {
    const makeGif = options.makeGif || defaultMakeGif;
    try {
      const made = await makeGif(editorial.topic, options);
      const bytes = fs.readFileSync(made.outputPath);
      fs.writeFileSync(path.join(dir, 'asset.gif'), bytes);
      gif = {
        path: made.outputPath,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        footer: made.footer || '',
        failures: made.failures || [],
        ...(made.visualWarning ? { visualWarning: made.visualWarning } : {})
      };
    } catch {
      // The thrown error is untrusted diagnostic text from a subprocess and cannot be
      // surfaced even partially redacted: path-stripping alone cannot guarantee it holds
      // no other sensitive substring, and this manifest is scanned as publishable content.
      gif = { failures: ['diagif did not produce a verified GIF'] };
    }
  }

  const nowFn = typeof options.now === 'function' ? options.now : () => new Date();
  const createdAt = nowFn().toISOString();
  const channels = Object.fromEntries(['x', 'linkedin', 'devto'].map(channel => [channel, { state: 'draft', payload_hash: payloadHash(dir, channel) }]));
  const manifest = {
    slug, topic: editorial.topic, createdAt, noGif: !!options.noGif, visual: visualKind(options),
    // 'template' means the prose is deterministic filler with no information in it.
    editorial: { generated: editorial.generated || 'template', model: editorial.model || null },
    gif, channels
  };
  atomicJson(path.join(dir, 'manifest.json'), manifest);
  return { dir, manifest };
}

module.exports = { draft, defaultMakeGif };
