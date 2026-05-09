import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTickRow, getTicks } from '../src/core/ticks.js';

describe('parseTickRow', () => {
  it('parses standard row with all fields', () => {
    const row = { time: '13:30:01.234', price: '93.45', size: '0.5', side: 'buy' };
    const ts = new Date('2026-05-10T00:00:00.000Z').getTime();
    const r = parseTickRow(row, ts);
    assert.equal(r.price, 93.45);
    assert.equal(r.size, 0.5);
    assert.equal(r.side, 'buy');
    assert.match(r.time, /^2026-05-10T13:30:01\.234Z$/);
  });

  it('infers side from coloring class when not provided', () => {
    const row = { time: '13:30:00', price: '93.40', size: '1.0', sideClass: 'tv-sell-color' };
    const ts = new Date('2026-05-10T00:00:00.000Z').getTime();
    const r = parseTickRow(row, ts);
    assert.equal(r.side, 'sell');
  });

  it('returns null for malformed rows', () => {
    assert.equal(parseTickRow({}, Date.now()), null);
    assert.equal(parseTickRow({ price: 'NaN' }, Date.now()), null);
  });
});

describe('getTicks', () => {
  it('returns ticks within limit', async () => {
    const fakeRows = [
      { time: '13:30:03', price: '93.45', size: '0.5', side: 'buy' },
      { time: '13:30:02', price: '93.44', size: '1.0', side: 'sell' },
      { time: '13:30:01', price: '93.43', size: '0.3', side: 'buy' },
    ];
    const r = await getTicks({
      limit: 2,
      _deps: {
        ensurePanelOpen: async () => true,
        readRawRows: async () => fakeRows,
        sessionDateMs: () => new Date('2026-05-10T00:00:00.000Z').getTime(),
      },
    });
    assert.equal(r.success, true);
    assert.equal(r.tick_count, 2);
    assert.equal(r.ticks.length, 2);
    assert.equal(r.ticks[0].price, 93.45);
  });

  it('filters by since timestamp', async () => {
    const fakeRows = [
      { time: '13:30:05', price: '100', size: '1', side: 'buy' },
      { time: '13:30:00', price: '99', size: '1', side: 'sell' },
    ];
    const r = await getTicks({
      limit: 10,
      since: '2026-05-10T13:30:03.000Z',
      _deps: {
        ensurePanelOpen: async () => true,
        readRawRows: async () => fakeRows,
        sessionDateMs: () => new Date('2026-05-10T00:00:00.000Z').getTime(),
      },
    });
    assert.equal(r.tick_count, 1);
    assert.equal(r.ticks[0].price, 100);
  });

  it('errors clearly when panel cannot open', async () => {
    const r = await getTicks({
      _deps: {
        ensurePanelOpen: async () => false,
        readRawRows: async () => [],
        sessionDateMs: () => Date.now(),
      },
    });
    assert.equal(r.success, false);
    assert.match(r.error, /Time & Sales panel/i);
  });
});
