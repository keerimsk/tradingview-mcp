/**
 * Unit tests for tab management — multi-tab CDP target binding.
 *
 * Tests findChartTarget()'s preferred-id behavior by mocking global fetch.
 * Pure logic: no real CDP / TradingView connection required.
 *
 * Run: node --test tests/tab.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { findChartTarget } from '../src/connection.js';

const SAMPLE_TARGETS = [
  { id: 'tab-1', type: 'page', title: 'Live stock charts on AAPL', url: 'https://www.tradingview.com/chart/abc/' },
  { id: 'tab-2', type: 'page', title: 'Live stock charts on BTCUSD', url: 'https://www.tradingview.com/chart/def/' },
  { id: 'tab-3', type: 'page', title: 'Screener', url: 'https://www.tradingview.com/screener/' },
  { id: 'svc-1', type: 'service_worker', title: '', url: 'https://www.tradingview.com/sw.js' },
];

let originalFetch;

function installFetchMock(targets) {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => targets,
  });
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('findChartTarget() — preferred-id selection', () => {
  it('without preferredId returns first chart tab', async () => {
    installFetchMock(SAMPLE_TARGETS);
    const t = await findChartTarget();
    assert.equal(t?.id, 'tab-1', 'should pick first chart tab');
  });

  it('with preferredId returns the matching tab', async () => {
    installFetchMock(SAMPLE_TARGETS);
    const t = await findChartTarget('tab-2');
    assert.equal(t?.id, 'tab-2', 'should pick the requested tab');
    assert.match(t.url, /chart\/def/);
  });

  it('with preferredId not in list falls back to first chart tab', async () => {
    installFetchMock(SAMPLE_TARGETS);
    const t = await findChartTarget('does-not-exist');
    assert.equal(t?.id, 'tab-1', 'fallback to default selection');
  });

  it('only matches type=page (skips service workers etc.)', async () => {
    installFetchMock(SAMPLE_TARGETS);
    // svc-1 is a service_worker; preferredId should NOT bind to it
    const t = await findChartTarget('svc-1');
    assert.notEqual(t?.id, 'svc-1', 'must not pick service_worker target');
    assert.equal(t?.id, 'tab-1', 'falls back to first chart page');
  });

  it('returns null when no TradingView pages exist', async () => {
    installFetchMock([
      { id: 'other', type: 'page', url: 'https://example.com/' },
    ]);
    const t = await findChartTarget();
    assert.equal(t, null);
  });

  it('falls back to non-chart tradingview page when no /chart tab exists', async () => {
    installFetchMock([
      { id: 'screener', type: 'page', url: 'https://www.tradingview.com/screener/' },
    ]);
    const t = await findChartTarget();
    assert.equal(t?.id, 'screener', 'matches /tradingview/ fallback regex');
  });
});

describe('connection.js exports', () => {
  it('exports the expected reconnect API', async () => {
    const mod = await import('../src/connection.js');
    assert.equal(typeof mod.setActiveTarget, 'function', 'setActiveTarget exported');
    assert.equal(typeof mod.getActiveTargetId, 'function', 'getActiveTargetId exported');
    assert.equal(typeof mod.findChartTarget, 'function', 'findChartTarget exported');
    assert.equal(typeof mod.disconnect, 'function', 'disconnect exported');
    assert.equal(typeof mod.connect, 'function', 'connect exported');
  });

  it('getActiveTargetId returns null when not connected', async () => {
    // Not connecting in this test — should be null (or whatever a leftover from another test was)
    const { getActiveTargetId } = await import('../src/connection.js');
    const id = getActiveTargetId();
    // Either null or a string — not undefined, not throwing
    assert.ok(id === null || typeof id === 'string');
  });
});

describe('core/tab.js exports', () => {
  it('exports list/newTab/closeTab/switchTab/getActive', async () => {
    const mod = await import('../src/core/tab.js');
    assert.equal(typeof mod.list, 'function');
    assert.equal(typeof mod.newTab, 'function');
    assert.equal(typeof mod.closeTab, 'function');
    assert.equal(typeof mod.switchTab, 'function');
    assert.equal(typeof mod.getActive, 'function');
  });
});

describe('tab.list() — is_bound flag shape', () => {
  it('marks the bound tab when fetched targets contain it', async () => {
    // Mock fetch to return our sample targets, then read list().
    // Since no client is connected, getActiveTargetId() returns null and
    // is_bound should be false on every tab.
    installFetchMock(SAMPLE_TARGETS);
    const { list } = await import('../src/core/tab.js');
    const r = await list();
    assert.equal(r.success, true);
    assert.equal(r.tab_count, 2, 'two chart tabs expected');
    for (const tab of r.tabs) {
      assert.equal(typeof tab.is_bound, 'boolean', 'is_bound flag present on every tab');
    }
    // With no active client, none should be bound
    assert.ok(r.tabs.every(t => t.is_bound === false), 'no tab bound when client null');
  });
});
