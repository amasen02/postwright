'use strict';

const BASE = 'https://dev.to/api';
const USER_AGENT = 'postwright/0.1.0 (+local release tool)';

function parseDevtoArticle(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);
  if (!match) throw new Error('Article is missing front matter');
  const [, frontmatter, rest] = match;
  const rawTitle = (frontmatter.match(/^title:\s*(.+?)\s*$/mu)?.[1] || '');
  const title = rawTitle.replace(/^"([\s\S]*)"$|^'([\s\S]*)'$/u, '$1$2');
  const tagsRaw = frontmatter.match(/^tags:\s*\[(.*)\]\s*$/mu)?.[1] || '';
  const tags = tagsRaw.split(',').map(tag => tag.trim()).filter(Boolean);
  const coverImage = (frontmatter.match(/^cover_image:\s*(.+?)\s*$/mu)?.[1] || '').trim();
  return { title, tags, body: rest.trim(), coverImage };
}

async function safeError(response) {
  await response.text().catch(() => '');
  return Object.assign(new Error('dev.to request failed; inspect the article and API key manually'), { safe: true });
}

async function publishDevto(article, { apiKey, fetch: fetchImpl = fetch, userAgent = USER_AGENT } = {}) {
  if (!apiKey) throw Object.assign(new Error('DEVTO_API_KEY is required'), { safe: true, code: 'USAGE' });
  const headers = { 'api-key': apiKey, 'User-Agent': userAgent, 'Content-Type': 'application/json' };

  const identityResponse = await fetchImpl(`${BASE}/users/me`, { method: 'GET', headers });
  if (!identityResponse.ok) throw await safeError(identityResponse);
  const identity = await identityResponse.json();

  const createResponse = await fetchImpl(`${BASE}/articles`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      article: {
        title: article.title, tags: article.tags, body_markdown: article.body,
        published: false, ...(article.coverImage ? { main_image: article.coverImage } : {})
      }
    })
  });
  if (!createResponse.ok) throw await safeError(createResponse);
  const created = await createResponse.json();

  const readResponse = await fetchImpl(`${BASE}/articles/${created.id}`, { method: 'GET', headers });
  if (!readResponse.ok) throw await safeError(readResponse);
  const readBack = await readResponse.json();

  return {
    owner: readBack.user?.username || identity.username,
    id: String(readBack.id),
    url: readBack.url,
    title: readBack.title,
    body: readBack.body_markdown
  };
}

module.exports = { publishDevto, parseDevtoArticle };
