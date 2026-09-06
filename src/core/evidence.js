'use strict';

// Why the numbers are not in here.
//
// Each rule exists because something was actually measured on a real account. Those
// measurements are that account's private analytics — reach, follower count, how a
// particular post performed — and publishing them in a public repository exposes the
// operator's own performance data to anyone who clones it. So the committed strings
// state the SHAPE of each finding and omit the figures.
//
// An operator who wants their real numbers in the rule messages puts them in
// `postwright.evidence.json` at the repository root, which is gitignored. Nothing about
// the rules changes: only the sentence printed alongside a pass or fail.
//
// The file is a flat object of rule id to string:
//   { "R1": "one-line questions reached <N> views; the explainer reached <M>" }

const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE_FILE = path.resolve(__dirname, '..', '..', 'postwright.evidence.json');

// Qualitative defaults. Safe to publish: they describe the direction of each finding
// without disclosing anyone's account metrics.
const DEFAULT_EVIDENCE = {
  R1: 'on the measured account, one-line questions reached far more people than a topic announcement or a full explainer',
  R2: 'posts formatted as an emoji plus an all-caps newsletter header were barely distributed at all',
  R3: 'the highest-reach posts each expressed one idea in one sentence',
  R4: 'link competition suppresses reach, and a thread opener carrying a link performed worst',
  R5: 'the single most-bookmarked post named one specific action to stop and one to start',
  R6: 'LinkedIn posts carrying outbound links in the body reached a small fraction of the author\'s followers',
  R7: 'the lowest-reach LinkedIn posts had outbound links and no native visual',
  R8: 'the GIF brand contract permits only the operator\'s own profile URL in its footer',
  R9: 'long-form published without demonstrated pull accumulated views and reactions close to zero, so an article follows evidence of interest rather than preceding it',
  R10: 'a retry loop once created seven copies of a single article',
  R11: 'several posts released inside one hour competed with each other for the same audience',
  R12: 'publishable drafts must not disclose local identity, paths, email addresses, or credential-shaped values'
};

let cached = null;

function loadOverrides() {
  if (cached) return cached;
  let raw;
  try {
    raw = fs.readFileSync(EVIDENCE_FILE, 'utf8');
  } catch (error) {
    // Absent is the normal case and means "use the published defaults". Any other read
    // error is a real fault and must not be mistaken for absence.
    if (error.code === 'ENOENT') { cached = {}; return cached; }
    throw new Error(`postwright evidence file could not be read: ${error.code}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`postwright evidence file is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('postwright evidence file must contain a JSON object of rule id to string');
  }
  const overrides = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_EVIDENCE, id)) continue;
    overrides[id] = value.trim();
  }
  cached = overrides;
  return cached;
}

/** The sentence printed after a rule's pass or fail. */
function evidenceFor(id) {
  return loadOverrides()[id] || DEFAULT_EVIDENCE[id] || 'no evidence recorded for this rule';
}

/** Test seam: drop the memoised overrides so a fixture can rewrite the file. */
function resetEvidenceCache() { cached = null; }

module.exports = { evidenceFor, resetEvidenceCache, DEFAULT_EVIDENCE, EVIDENCE_FILE };
