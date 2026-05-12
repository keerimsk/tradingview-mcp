/**
 * Unit tests for dom module — exports + input validation.
 * Pure logic only (no live CDP).
 *
 * Run: node --test tests/dom.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('core/dom.js exports', () => {
  it('exports read function', async () => {
    const m = await import('../src/core/dom.js');
    assert.equal(typeof m.read, 'function');
  });
});

describe('tools/dom.js exports', () => {
  it('exports registerDomTools function', async () => {
    const m = await import('../src/tools/dom.js');
    assert.equal(typeof m.registerDomTools, 'function');
  });
});

describe('dom.read function shape', () => {
  it('is async (returns Promise)', async () => {
    const { read } = await import('../src/core/dom.js');
    // Don't actually invoke — invocation would hit live CDP. Just verify
    // signature: it's an async function that takes an options object.
    assert.equal(read.constructor.name, 'AsyncFunction');
    assert.equal(read.length, 0);  // no required params (default = {})
  });
});
