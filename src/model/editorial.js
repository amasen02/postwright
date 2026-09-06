'use strict';
const { AgentUsageError } = require('../core/errors');
const { generateEditorial } = require('./brain');

const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via', 'with', 'without']);
const STOP_TAG_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via', 'with', 'without',
  'how', 'why', 'what', 'when', 'system', 'systems', 'solution', 'solutions', 'approach', 'approaches']);

function slugify(topic) {
  const DIACRITICS = new RegExp(String.fromCharCode(91) + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + String.fromCharCode(93), 'g');
  const slug = String(topic).normalize('NFKD').replace(DIACRITICS, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'topic';
}

function assertSafeTopic(topic) {
  if (typeof topic !== 'string') throw new AgentUsageError('Topic must be a non-empty string');
  const trimmed = topic.trim();
  if (!trimmed || trimmed.length > 180) throw new AgentUsageError('Topic must be 1-180 characters');
  if (/[\r\n]/.test(topic)) throw new AgentUsageError('Topic must not contain line breaks');
  if (/[A-Za-z]:[\\/]|\\\\[^\\/\s]+\\/.test(topic)) throw new AgentUsageError('Topic must not contain a filesystem path');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(topic)) throw new AgentUsageError('Topic must not contain an email address');
  if (/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*[A-Za-z0-9_./+~-]{8,}/i.test(topic)) throw new AgentUsageError('Topic must not contain a credential-shaped value');
  return trimmed;
}

function titleCase(topic) {
  return topic.trim().split(/\s+/u).map((word, index) => {
    if (word !== word.toLowerCase()) return word;
    if (index > 0 && MINOR_WORDS.has(word.toLowerCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

function shortTopic(topic, max) {
  if (topic.length <= max) return topic;
  const words = topic.split(/\s+/u);
  let out = '';
  for (const word of words) {
    const next = out ? out + ' ' + word : word;
    if (next.length > max) break;
    out = next;
  }
  return out || topic.slice(0, max);
}

function tagsFor(topic, fallbackTags) {
  const seen = new Set();
  const tags = [];
  for (const raw of topic.toLowerCase().split(/[^a-z0-9]+/u)) {
    if (!raw || raw.length < 3 || STOP_TAG_WORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    tags.push(raw);
    if (tags.length === 4) break;
  }
  return tags.length ? tags : fallbackTags;
}

const CURATED = {
  'idempotency keys in rest apis': () => ({
    x: 'Stop retrying REST writes blind; use an idempotency key instead.\n\nStore the key with the response, then replay it on the next retry.',
    linkedin: 'An idempotency key turns a retried REST write into one durable operation.\n\nStore the key with the response, then replay that stored response instead of repeating the write.',
    tags: ['rest', 'api', 'reliability', 'distributed-systems'],
    body: 'A client retry should never repeat a write. An idempotency key lets the server recognise the same logical request and return the original result instead of performing the write twice.\n\nStripe documents this pattern for its own API as a useful reference implementation.\n\nhttps://docs.stripe.com/api/idempotent_requests\n'
  }),
  'graphrag vs vector rag': () => ({
    x: 'Should your retriever traverse a knowledge graph or just rank vector chunks?\n\nGraphRAG links related facts together; vector search only ranks similar-looking text.',
    linkedin: 'GraphRAG retrieves connected facts instead of only similar-looking text chunks.\n\nAsk whether your queries need relationships between entities before adding graph infrastructure.',
    tags: ['rag', 'graphrag', 'knowledge-graphs', 'retrieval'],
    body: 'Vector search ranks chunks by embedding similarity; it has no notion of the relationships between entities mentioned across those chunks. GraphRAG builds an explicit graph of entities and relations, then retrieves along that graph before generation.\n\nMicrosoft publishes an open implementation and its design rationale.\n\nhttps://microsoft.github.io/graphrag/\n'
  })
};

function articleFrom(title, tags, body) {
  return `---
title: "${title}"
tags: [${tags.join(', ')}]
published: false
cover_image: asset.gif
---

# ${title}

${body}`;
}

/**
 * Build the three drafts for a topic.
 *
 * `options.brain` selects the source. 'template' produces deterministic filler that
 * satisfies the form rules but carries no information: it exists for offline tests and
 * must never be mistaken for publishable content, so the result is marked
 * `generated: 'template'` and the caller is expected to surface that.
 */
function createEditorial(topic, options = {}) {
  const trimmed = assertSafeTopic(topic);
  const brain = options.brain || 'template';
  if (brain !== 'template' && brain !== 'mock') {
    const written = generateEditorial(trimmed, options);
    return {
      topic: trimmed,
      x: written.x,
      linkedin: written.linkedin,
      article: articleFrom(titleCase(trimmed), written.tags, written.articleBody),
      generated: written.provider,
      model: written.model
    };
  }
  const title = titleCase(trimmed);
  const curated = CURATED[trimmed.toLowerCase()];
  if (curated) {
    const content = curated();
    return {
      topic: trimmed,
      x: content.x,
      linkedin: content.linkedin,
      article: articleFrom(title, content.tags, content.body),
      generated: 'curated'
    };
  }
  const short = shortTopic(trimmed, 90);
  const x = `Where does "${short}" quietly break under real load?\n\nProfile the slowest real path before you optimise anything else.`;
  const linkedin = `${title} is easy to discuss in the abstract and hard to verify in production.\n\nName one concrete claim about it, measure whether it holds under your real traffic, and only then decide what to change.`;
  const tags = tagsFor(trimmed, ['engineering']);
  const body = `Treat "${trimmed}" as a hypothesis, not a settled fact. Write down the one behaviour you expect, measure it against real traffic, and only keep the parts that hold up.\n\nThis draft intentionally avoids inventing sources; add a same-topic reference before publishing.\n`;
  return {
    topic: trimmed,
    x, linkedin,
    article: articleFrom(title, tags, body),
    generated: 'template'
  };
}

module.exports = { createEditorial, slugify, assertSafeTopic };
