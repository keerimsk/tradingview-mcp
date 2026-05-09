import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _loadHistoryUntil } from '../src/core/data.js';

describe('_loadHistoryUntil', () => {
  it('returns immediately when bar count already meets target', async () => {
    let polls = 0;
    const r = await _loadHistoryUntil(100, {
      _deps: {
        getBarCount: async () => { polls++; return 200; },
        requestMore: async () => {},
        timeoutMs: 1000,
        pollIntervalMs: 10,
      },
    });
    assert.equal(r.reached, true);
    assert.equal(r.final, 200);
    assert.equal(polls, 1);
  });

  it('polls until target reached', async () => {
    let count = 100;
    const r = await _loadHistoryUntil(150, {
      _deps: {
        getBarCount: async () => { count += 30; return count; },
        requestMore: async () => {},
        timeoutMs: 1000,
        pollIntervalMs: 5,
      },
    });
    assert.equal(r.reached, true);
    assert.ok(r.final >= 150);
  });

  it('returns partial when timeout reached', async () => {
    const r = await _loadHistoryUntil(10000, {
      _deps: {
        getBarCount: async () => 500,
        requestMore: async () => {},
        timeoutMs: 50,
        pollIntervalMs: 10,
      },
    });
    assert.equal(r.reached, false);
    assert.equal(r.final, 500);
  });
});
