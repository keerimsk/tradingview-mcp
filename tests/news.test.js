/**
 * Unit tests for news module — input validation, response shape.
 * Pure logic only (no live REST calls).
 *
 * Run: node --test tests/news.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('core/news.js exports', () => {
  it('exports getHeadlines + getStory', async () => {
    const m = await import('../src/core/news.js');
    assert.equal(typeof m.getHeadlines, 'function');
    assert.equal(typeof m.getStory, 'function');
  });
});

describe('getHeadlines input validation', () => {
  it('throws on invalid client', async () => {
    const { getHeadlines } = await import('../src/core/news.js');
    await assert.rejects(
      () => getHeadlines({ client: 'invalid' }),
      /Invalid client "invalid"/,
    );
  });
});

describe('getStory input validation', () => {
  it('throws when id is missing', async () => {
    const { getStory } = await import('../src/core/news.js');
    await assert.rejects(
      () => getStory({}),
      /requires an id/,
    );
  });

  it('throws when id is non-string', async () => {
    const { getStory } = await import('../src/core/news.js');
    await assert.rejects(
      () => getStory({ id: 123 }),
      /requires an id/,
    );
  });
});

describe('tools/news.js exports registerNewsTools', () => {
  it('module loads + exports register function', async () => {
    const m = await import('../src/tools/news.js');
    assert.equal(typeof m.registerNewsTools, 'function');
  });
});
