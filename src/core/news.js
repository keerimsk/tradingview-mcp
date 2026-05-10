/**
 * TradingView News Feed — REST wrapper.
 *
 * Hits news-headlines.tradingview.com via in-page fetch (credentials:'include')
 * so the user's TV session is used for auth (same pattern as screener.js,
 * pine.js, alerts.js). No manual cookie management.
 *
 * Endpoints:
 *   GET /v2/headlines?client=overview&lang=en[&symbol=EXCH:SYM]  — list
 *   GET /v2/story?id=<news_id>&lang=en                          — full article
 */
import { evaluateAsync, safeString } from '../connection.js';

const BASE = 'https://news-headlines.tradingview.com';

// Valid client names observed live: 'web', 'overview'. Default 'overview' returns
// the same general feed as TV's right-panel news widget.
const VALID_CLIENTS = new Set(['web', 'overview']);

/**
 * Fetch news headlines.
 *
 * @param {Object} opts
 * @param {string} [opts.symbol]  e.g. "NASDAQ:AAPL" — limit to symbol-specific news
 * @param {string} [opts.client]  'web' or 'overview' (default 'overview')
 * @param {string} [opts.lang]    BCP-47 language tag (default 'en')
 * @param {number} [opts.limit]   max items (default 50, max 200)
 */
export async function getHeadlines({ symbol, client = 'overview', lang = 'en', limit = 50 } = {}) {
  if (!VALID_CLIENTS.has(client)) {
    throw new Error(`Invalid client "${client}". Use one of: ${[...VALID_CLIENTS].join(', ')}`);
  }
  const max = Math.min(Math.max(1, Math.floor(Number(limit) || 50)), 200);

  let url = `${BASE}/v2/headlines?client=${encodeURIComponent(client)}&lang=${encodeURIComponent(lang)}`;
  if (symbol) url += `&symbol=${encodeURIComponent(symbol)}`;

  const expr = `
    (function() {
      return fetch(${safeString(url)}, { credentials: 'include' })
        .then(function(r) {
          return r.text().then(function(t) {
            return { ok: r.ok, status: r.status, text: t };
          });
        })
        .catch(function(e) { return { ok: false, error: e.message }; });
    })()
  `;

  const resp = await evaluateAsync(expr);
  if (!resp || resp.error) throw new Error(`News fetch failed: ${resp?.error || 'no response'}`);
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(`News returned ${resp.status} — TV session not present. Make sure you're logged in.`);
  }
  if (!resp.ok) {
    throw new Error(`News returned ${resp.status}: ${(resp.text || '').slice(0, 300)}`);
  }

  let data;
  try { data = JSON.parse(resp.text); } catch (e) {
    throw new Error(`News returned non-JSON: ${(resp.text || '').slice(0, 200)}`);
  }

  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items = rawItems.slice(0, max).map(it => ({
    id: it.id,
    title: it.title,
    source: it.source || it.provider,
    provider: it.provider,
    published: it.published,
    published_iso: it.published ? new Date(it.published * 1000).toISOString() : null,
    urgency: it.urgency ?? null,
    link: it.link || null,
    permission: it.permission || null,
    related_symbols: (it.relatedSymbols || []).map(s => s.symbol),
    story_path: it.storyPath || null,
  }));

  return {
    success: true,
    symbol: symbol || null,
    client,
    lang,
    total_returned: items.length,
    total_available: rawItems.length,
    items,
  };
}

/**
 * Fetch the full content of a single news story by id.
 * Returns shortDescription + a flattened plaintext extracted from astDescription.
 *
 * @param {Object} opts
 * @param {string} opts.id   news id, e.g. "cnbctv:26a2bc84e094b:0"
 * @param {string} [opts.lang]
 */
export async function getStory({ id, lang = 'en' } = {}) {
  if (!id || typeof id !== 'string') {
    throw new Error('news_get_story requires an id (from news_headlines.items[].id)');
  }
  const url = `${BASE}/v2/story?id=${encodeURIComponent(id)}&lang=${encodeURIComponent(lang)}`;
  const expr = `
    (function() {
      return fetch(${safeString(url)}, { credentials: 'include' })
        .then(function(r) {
          return r.text().then(function(t) {
            return { ok: r.ok, status: r.status, text: t };
          });
        })
        .catch(function(e) { return { ok: false, error: e.message }; });
    })()
  `;
  const resp = await evaluateAsync(expr);
  if (!resp || resp.error) throw new Error(`Story fetch failed: ${resp?.error || 'no response'}`);
  if (!resp.ok) {
    throw new Error(`Story returned ${resp.status}: ${(resp.text || '').slice(0, 200)}`);
  }
  let data;
  try { data = JSON.parse(resp.text); } catch (e) {
    throw new Error(`Story returned non-JSON: ${(resp.text || '').slice(0, 200)}`);
  }

  // Flatten astDescription tree to plaintext
  function flatten(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(flatten).join('');
    if (typeof node === 'object') {
      const childText = node.children ? flatten(node.children) : '';
      if (node.type === 'p' || node.type === 'div') return childText + '\n\n';
      if (node.type === 'h1' || node.type === 'h2' || node.type === 'h3') return childText + '\n\n';
      if (node.type === 'br') return '\n';
      if (node.type === 'a') return childText;
      return childText;
    }
    return '';
  }

  const text = flatten(data?.astDescription).trim();

  return {
    success: true,
    id,
    short_description: data?.shortDescription || null,
    text,
    text_length: text.length,
    published: data?.published || null,
    published_iso: data?.published ? new Date(data.published * 1000).toISOString() : null,
    title: data?.title || null,
    related_symbols: (data?.relatedSymbols || []).map(s => s.symbol),
    link: data?.link || null,
  };
}
