'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { evidenceFor } = require('./evidence');
const crypto = require('node:crypto');

const OPERATOR_LINKEDIN = 'https://www.linkedin.com/in/ama-sen';
const GENERIC_TOPIC = new Set(['the','a','an','and','or','to','in','on','for','of','with','without','vs','versus','how','why','what','when','system','systems','solution','solutions','approach','approaches']);

function result(id, channel, pass, detail) {
  return { id, channel, pass, message: `${pass ? 'PASS' : 'FAIL'}: ${detail}. Evidence: ${evidenceFor(id)}.` };
}
function read(file, required = true) {
  try { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
  catch (error) { if (!required && error.code === 'ENOENT') return ''; throw error; }
}
function urls(text) {
  return text.match(/https?:\/\/[^\s<>\])}"']+/giu) || [];
}
function firstPost(text) { return text.split(/\r?\n---\r?\n/u)[0].trim(); }
function canonicalWord(word) {
  let value = word.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}+#.-]/gu, '');
  if (value.length > 4 && value.endsWith('ies')) value = value.slice(0, -3) + 'y';
  else if (value.length > 4 && value.endsWith('es')) value = value.slice(0, -2);
  else if (value.length > 3 && value.endsWith('s')) value = value.slice(0, -1);
  return value;
}
function words(text) { return [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu)].map(match => canonicalWord(match[0])); }
function hasConcreteTopicNoun(topic, post) {
  const candidates = new Set(words(topic).filter(word => word.length >= 3 && !GENERIC_TOPIC.has(word)));
  return words(post).some(word => candidates.has(word));
}
function isAllCapsHeader(line) {
  const stripped = line.trim().replace(/^#{1,6}\s*/u, '');
  const letters = stripped.match(/\p{L}/gu) || [];
  if (!letters.length || letters.join('') !== letters.join('').toLocaleUpperCase('en-US')) return false;
  const tokens = stripped.match(/[\p{L}\p{N}]+/gu) || [];
  const emojiLed = /^\p{Extended_Pictographic}/u.test(stripped);
  return emojiLed || tokens.length >= 2;
}
function openerPass(line) {
  const opener = line.trim();
  if (!opener || /^(?:here(?:'s| is)|a (?:guide|primer|post) (?:to|on)|understanding\b|how .+ works\b)/iu.test(opener)) return false;
  if (/\?\s*$/u.test(opener)) return true;
  return /\b(?:stop|avoid|replace|drop|skip)\b.+\b(?:use|start|choose|prefer|with|instead)\b/iu.test(opener)
    || /\b(?:instead of|rather than)\b/iu.test(opener)
    || /\b(?:mistake|bug|failure)\b.+\b(?:fix|replacement|replace|use)\b/iu.test(opener);
}
function countSentences(line) {
  const terminal = line.match(/[.!?]+(?=\s|$)/gu) || [];
  return terminal.length || (line.trim() ? 1 : 0);
}
function normalizeTitle(value) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}
function articleTitle(article) {
  const frontmatter = article.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/u)?.[1] || '';
  const raw = frontmatter.match(/^title:\s*(.+?)\s*$/imu)?.[1] || article.match(/^#\s+(.+)$/mu)?.[1] || '';
  return raw.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, '$1$2');
}
function duplicateTitle(dir, title, draftsRoot, privateRoot) {
  const wanted = normalizeTitle(title);
  if (!wanted) return 'current article has no title';
  if (fs.existsSync(draftsRoot)) {
    for (const entry of fs.readdirSync(draftsRoot, { withFileTypes: true })) {
      const candidateDir = path.join(draftsRoot, entry.name);
      if (!entry.isDirectory() || path.resolve(candidateDir) === path.resolve(dir)) continue;
      const file = path.join(candidateDir, 'article-devto.md');
      if (fs.existsSync(file) && normalizeTitle(articleTitle(read(file))) === wanted) return `duplicate title in draft ${entry.name}`;
    }
  }
  const cache = path.join(privateRoot, 'devto-existing.json');
  if (fs.existsSync(cache)) {
    const parsed = JSON.parse(read(cache));
    const articles = Array.isArray(parsed) ? parsed : parsed.articles || [];
    const duplicate = articles.find(item => normalizeTitle(typeof item === 'string' ? item : item?.title || '') === wanted);
    if (duplicate) return 'duplicate title in cached dev.to article list';
  }
  return '';
}
function releasedWithinWindow(draftsRoot, currentDir, now) {
  if (!fs.existsSync(draftsRoot)) return [];
  const recent = [];
  for (const entry of fs.readdirSync(draftsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidateDir = path.join(draftsRoot, entry.name);
    if (path.resolve(candidateDir) === path.resolve(currentDir)) continue;
    const file = path.join(candidateDir, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    let manifest;
    try { manifest = JSON.parse(read(file)); } catch { continue; }
    for (const [channel, state] of Object.entries(manifest.channels || {})) {
      if (!state?.releasedAt) continue;
      const age = now.getTime() - new Date(state.releasedAt).getTime();
      if (Number.isFinite(age) && age >= 0 && age < 60 * 60 * 1000) recent.push(`${entry.name}:${channel}`);
    }
  }
  return recent;
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function privateFinding(namedTexts) {
  const identity = [os.hostname(), os.userInfo().username].filter(value => value && value.length >= 3);
  const identityPattern = identity.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(?:${identity.map(escapeRegExp).join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu') : null;
  const checks = [
    ['an absolute Windows path', /(?:^|[\s("'])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\[^\\\s]+)/u],
    ['an email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
    ['a private key marker', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
    ['a bearer credential', /\bBearer\s+[A-Za-z0-9._~-]{12,}/iu],
    ['an assigned credential', /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+~-]{8,}/iu],
    ['a credential-shaped token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/u]
  ];
  for (const [name, text] of namedTexts) {
    for (const [finding, pattern] of checks) if (pattern.test(text)) return `${name} contains ${finding}`;
    if (identityPattern?.test(text)) return `${name} contains the local host or user name`;
  }
  return '';
}

async function lintDraft(dir, options = {}) {
  dir = path.resolve(dir);
  const draftsRoot = path.resolve(options.draftsRoot || path.dirname(dir));
  const privateRoot = path.resolve(options.privateRoot || path.join(draftsRoot, '../../postwright-private'));
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const manifest = JSON.parse(read(path.join(dir, 'manifest.json')));
  const x = read(path.join(dir, 'post-x.md'));
  const linkedin = read(path.join(dir, 'post-linkedin.md'));
  const devto = read(path.join(dir, 'article-devto.md'));
  const firstCommentPath = path.join(dir, 'first-comment.md');
  const first = firstPost(x);
  const firstLine = first.split(/\r?\n/u)[0] || '';
  const thread = x.split(/\r?\n---\r?\n/u);
  const foundLinks = urls(x);
  const linkedinLinks = [...new Set(urls(linkedin))];
  if (linkedinLinks.length) fs.writeFileSync(firstCommentPath, linkedinLinks.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  const firstComment = read(firstCommentPath, false);
  const rules = [];

  rules.push(result('R1', 'x', openerPass(firstLine), openerPass(firstLine) ? 'opener is a question or concrete mistake/replacement claim' : 'opener is a topic announcement or lacks a question/specific mistake and replacement'));
  const capsLine = x.split(/\r?\n/u).find(isAllCapsHeader);
  rules.push(result('R2', 'x', !capsLine, capsLine ? `all-caps header rejected (${JSON.stringify(capsLine.trim())})` : 'no all-caps newsletter header'));
  const r3 = [...first].length <= 280 && (first.match(/\?/gu) || []).length <= 1 && countSentences(firstLine) <= 2;
  rules.push(result('R3', 'x', r3, r3 ? 'first post stays within 280 characters, one question, and two opener sentences' : 'first post exceeds 280 characters, has multiple questions, or has more than two opener sentences'));
  const r4 = foundLinks.length <= 1 && !(thread.length > 1 && urls(thread[0]).length);
  rules.push(result('R4', 'x', r4, r4 ? 'link count and thread-opener placement are valid' : 'X content has more than one link or places a link in the first post of a thread'));
  const r5 = hasConcreteTopicNoun(manifest.topic || '', x);
  rules.push(result('R5', 'x', r5, r5 ? 'post names a concrete term from the topic domain' : 'post contains no concrete non-generic term from its topic'));

  rules.push(result('R6', 'linkedin', linkedinLinks.length === 0, linkedinLinks.length ? `removed placement is required; ${linkedinLinks.length} outbound link(s) copied to first-comment.md` : 'LinkedIn body has no outbound link'));
  const noGif = manifest.noGif === true;
  const asset = path.join(dir, 'asset.gif');
  const visualPass = noGif || (fs.existsSync(asset) && fs.statSync(asset).isFile() && !fs.lstatSync(asset).isSymbolicLink());
  rules.push(result('R7', 'linkedin', visualPass, visualPass ? (noGif ? 'native visual explicitly waived by --no-gif' : 'native GIF is present') : 'native GIF is missing without an explicit --no-gif waiver'));
  let brandPass = noGif;
  let brandDetail = 'GIF footer check explicitly waived by --no-gif';
  if (!noGif && visualPass) {
    const bytes = fs.readFileSync(asset);
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const footer = String(manifest.gif?.footer || '').replace(/\/$/u, '');
    brandPass = footer === OPERATOR_LINKEDIN && /^[a-f0-9]{64}$/iu.test(manifest.gif?.sha256 || '') && actualHash === manifest.gif.sha256.toLowerCase();
    brandDetail = brandPass ? 'manifest pins the GIF bytes and renderer footer to the operator LinkedIn URL only' : 'GIF hash/footer provenance is absent, mismatched, or contains a footer other than the operator LinkedIn URL';
  } else if (!noGif) brandDetail = 'GIF footer provenance cannot be verified because asset.gif is missing';
  rules.push(result('R8', 'linkedin', brandPass, brandDetail));

  const evidence = manifest.xEvidence;
  const sameTopic = evidence && normalizeTitle(evidence.topic || manifest.topic || '') === normalizeTitle(manifest.topic || '');
  const engaged = evidence && /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//iu.test(evidence.url || '') && (Number(evidence.replies) > 0 || Number(evidence.bookmarks) > 0) && sameTopic;
  const forced = typeof manifest.forceReason === 'string' && manifest.forceReason.trim().length > 0;
  rules.push(result('R9', 'devto', Boolean(engaged || forced), engaged ? 'same-topic X replies/bookmarks demonstrate pull' : forced ? 'stored force reason overrides the X evidence gate' : 'article is held: add same-topic X evidence with replies/bookmarks or a stored force reason'));
  const duplicate = duplicateTitle(dir, articleTitle(devto), draftsRoot, privateRoot);
  rules.push(result('R10', 'devto', !duplicate, duplicate || 'normalised article title is unique across drafts and cached account articles'));

  const recent = releasedWithinWindow(draftsRoot, dir, now);
  rules.push(result('R11', 'cross', recent.length < 2, recent.length < 2 ? `${recent.length} other release(s) recorded in the preceding 60 minutes` : `${recent.length} other releases recorded in the preceding 60 minutes (${recent.join(', ')})`));
  const finding = privateFinding([['post-x.md', x], ['post-linkedin.md', linkedin], ['article-devto.md', devto], ['first-comment.md', firstComment]]);
  rules.push(result('R12', 'cross', !finding, finding || 'draft content contains no private path, local identity, email, or credential-shaped value'));

  const crossPass = rules.filter(rule => rule.channel === 'cross').every(rule => rule.pass);
  const channels = Object.fromEntries(['x', 'linkedin', 'devto'].map(channel => [channel, crossPass && rules.filter(rule => rule.channel === channel).every(rule => rule.pass)]));
  return { rules, channels, pass: Object.values(channels).every(Boolean) };
}

module.exports = { lintDraft, OPERATOR_LINKEDIN, normalizeTitle };
