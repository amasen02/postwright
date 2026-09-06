'use strict';

// Measures how much of a rendered mind-map GIF's frame height is empty at the top or
// bottom, so a caller can warn on the known diagif under-fill issue at low branch counts
// without failing the draft over it. Decodes the actual last frame rather than trusting
// the pre-render scene layout, since halos, labels and the brand footer can all extend
// past a node's nominal bounding box.
//
// Python + Pillow is already a hard prerequisite of the sibling diagif tool, so this adds
// no new dependency. Best-effort only: any failure (no Python, no Pillow, decode error)
// returns null rather than throwing, so a draft is never failed over a missing prerequisite
// for a supplementary metric.

const { spawnSync } = require('node:child_process');

const SCRIPT = `
import json, sys
from PIL import Image, ImageSequence
path = sys.argv[1]
img = Image.open(path)
frames = [f.convert('RGB') for f in ImageSequence.Iterator(img)]
frame = frames[-1]
w, h = frame.size
px = frame.load()
def corner_avg():
    pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    vals = [px[x, y] for x, y in pts]
    return tuple(sum(c[i] for c in vals) // len(vals) for i in range(3))
bg = corner_avg()
TOL = 12
def row_empty(y):
    for x in range(0, w, 2):
        p = px[x, y]
        if any(abs(p[i] - bg[i]) > TOL for i in range(3)):
            return False
    return True
top = 0
while top < h and row_empty(top):
    top += 1
bottom = 0
while bottom < h - top and row_empty(h - 1 - bottom):
    bottom += 1
print(json.dumps({"width": w, "height": h, "topEmptyRows": top, "bottomEmptyRows": bottom, "emptyFraction": (top + bottom) / h}))
`;

function pythonCandidates(platform) {
  return platform === 'win32'
    ? [{ command: 'py', args: ['-3'] }, { command: 'python', args: [] }]
    : [{ command: 'python3', args: [] }];
}

/**
 * Measure top/bottom empty-row fraction of a mind-map GIF's final frame.
 * Returns { width, height, topEmptyRows, bottomEmptyRows, emptyFraction } or null if the
 * measurement could not be made (no Python/Pillow available, or decode failed).
 */
function measureMindmapFill(gifPath, options = {}) {
  const run = options.spawnSync || spawnSync;
  for (const candidate of pythonCandidates(options.platform || process.platform)) {
    let result;
    try {
      result = run(candidate.command, [...candidate.args, '-c', SCRIPT, gifPath], {
        encoding: 'utf8', shell: false, timeout: options.timeoutMs || 30000
      });
    } catch {
      continue;
    }
    if (!result || result.error || result.status !== 0) continue;
    try {
      return JSON.parse(String(result.stdout).trim());
    } catch {
      return null;
    }
  }
  return null;
}

module.exports = { measureMindmapFill };
