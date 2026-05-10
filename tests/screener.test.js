/**
 * Unit tests for Classic Screener — payload shape, defaults, validation.
 * Pure logic: no real CDP / scanner.tradingview.com calls.
 *
 * Run: node --test tests/screener.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScanRequest,
  listColumns,
  listOperations,
  DEFAULT_COLUMNS,
  SCREENER_OPERATIONS,
  SCREENER_COLUMNS,
} from '../src/core/screener.js';

describe('buildScanRequest() — payload shape and defaults', () => {
  it('uses default market "america" when not specified', () => {
    const r = buildScanRequest({});
    assert.equal(r.url, 'https://scanner.tradingview.com/america/scan');
    assert.deepEqual(r.payload.markets, ['america']);
  });

  it('honors a non-default market', () => {
    const r = buildScanRequest({ market: 'crypto' });
    assert.equal(r.url, 'https://scanner.tradingview.com/crypto/scan');
    assert.deepEqual(r.payload.markets, ['crypto']);
  });

  it('rejects unknown markets', () => {
    assert.throws(() => buildScanRequest({ market: 'mars' }), /Unknown market/);
  });

  it('uses DEFAULT_COLUMNS when columns not provided', () => {
    const r = buildScanRequest({});
    assert.deepEqual(r.payload.columns, DEFAULT_COLUMNS);
    // Sanity: the default should include both fundamentals and technicals
    assert.ok(DEFAULT_COLUMNS.includes('market_cap_basic'));
    assert.ok(DEFAULT_COLUMNS.includes('RSI'));
    assert.ok(DEFAULT_COLUMNS.includes('price_earnings_ttm'));
  });

  it('uses caller columns when provided', () => {
    const r = buildScanRequest({ columns: ['name', 'close'] });
    assert.deepEqual(r.payload.columns, ['name', 'close']);
  });

  it('default range is [0, 50]', () => {
    const r = buildScanRequest({});
    assert.deepEqual(r.payload.range, [0, 50]);
  });

  it('range span is clamped to MAX 500', () => {
    const r = buildScanRequest({ range: [0, 1000] });
    assert.equal(r.payload.range[1] - r.payload.range[0], 500);
    assert.deepEqual(r.payload.range, [0, 500]);
  });

  it('range with offset is clamped at span 500 too', () => {
    const r = buildScanRequest({ range: [100, 800] });
    assert.deepEqual(r.payload.range, [100, 600]);
  });

  it('default sort is market_cap_basic desc', () => {
    const r = buildScanRequest({});
    assert.deepEqual(r.payload.sort, { sortBy: 'market_cap_basic', sortOrder: 'desc' });
  });

  it('sort order asc is honored', () => {
    const r = buildScanRequest({ sort: { by: 'volume', order: 'asc' } });
    assert.deepEqual(r.payload.sort, { sortBy: 'volume', sortOrder: 'asc' });
  });

  it('non-asc/desc order coerces to desc', () => {
    const r = buildScanRequest({ sort: { by: 'volume', order: 'random' } });
    assert.equal(r.payload.sort.sortOrder, 'desc');
  });
});

describe('buildScanRequest() — filter validation', () => {
  it('passes through valid filters with field/operation/value', () => {
    const r = buildScanRequest({
      filters: [{ field: 'RSI', operation: 'less', value: 30 }],
    });
    assert.deepEqual(r.payload.filter, [
      { left: 'RSI', operation: 'less', right: 30 },
    ]);
  });

  it('accepts the legacy left/op/right shape too', () => {
    const r = buildScanRequest({
      filters: [{ left: 'close', op: 'greater', right: 100 }],
    });
    assert.deepEqual(r.payload.filter, [
      { left: 'close', operation: 'greater', right: 100 },
    ]);
  });

  it('throws on unknown operation', () => {
    assert.throws(
      () => buildScanRequest({ filters: [{ field: 'RSI', operation: 'fnord', value: 30 }] }),
      /Unknown screener operation/,
    );
  });

  it('drops filters missing field or operation', () => {
    const r = buildScanRequest({
      filters: [
        { field: 'RSI', operation: 'less', value: 30 },
        { field: '', operation: 'less', value: 30 },
        { field: 'close', operation: '', value: 100 },
        null,
      ],
    });
    assert.equal(r.payload.filter.length, 1);
  });

  it('supports in_range with array value', () => {
    const r = buildScanRequest({
      filters: [{ field: 'close', operation: 'in_range', value: [10, 100] }],
    });
    assert.deepEqual(r.payload.filter[0].right, [10, 100]);
  });

  it('supports string match values (sector etc.)', () => {
    const r = buildScanRequest({
      filters: [{ field: 'sector', operation: 'match', value: 'Technology Services' }],
    });
    assert.equal(r.payload.filter[0].right, 'Technology Services');
  });
});

describe('buildScanRequest() — tickers and lang', () => {
  it('default tickers is empty array', () => {
    const r = buildScanRequest({});
    assert.deepEqual(r.payload.symbols.tickers, []);
  });

  it('honors caller tickers list', () => {
    const r = buildScanRequest({ tickers: ['NASDAQ:AAPL', 'NYSE:GE'] });
    assert.deepEqual(r.payload.symbols.tickers, ['NASDAQ:AAPL', 'NYSE:GE']);
  });

  it('default lang is en', () => {
    const r = buildScanRequest({});
    assert.equal(r.payload.options.lang, 'en');
  });

  it('lang can be overridden', () => {
    const r = buildScanRequest({ lang: 'tr' });
    assert.equal(r.payload.options.lang, 'tr');
  });
});

describe('listColumns()/listOperations() — static reference output', () => {
  it('listColumns returns SCREENER_COLUMNS with descriptions', () => {
    const r = listColumns();
    assert.equal(r.success, true);
    assert.equal(r.count, SCREENER_COLUMNS.length);
    assert.ok(r.columns.length >= 30, 'should expose at least 30 common columns');
    for (const c of r.columns) {
      assert.equal(typeof c.name, 'string');
      assert.equal(typeof c.desc, 'string');
    }
  });

  it('listOperations returns operations with examples', () => {
    const r = listOperations();
    assert.equal(r.success, true);
    assert.equal(r.count, SCREENER_OPERATIONS.length);
    assert.ok(r.examples.length > 0, 'should include example filters');
    // Sanity: greater/less/in_range must be present
    const ops = r.operations.map(o => o.op);
    for (const required of ['greater', 'less', 'in_range', 'match', 'crosses_above']) {
      assert.ok(ops.includes(required), `missing operation: ${required}`);
    }
  });
});
