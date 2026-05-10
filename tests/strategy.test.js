import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findStrategies, findStrategyById } from '../src/core/strategy.js';
import { getSettings, parseSettingsTree, CANONICAL_TO_TV_PATH } from '../src/core/strategy.js';
import { setSettings } from '../src/core/strategy.js';
import { getPerformanceSummary, extractPerformanceSummary, REPORT_FIELD_MAP } from '../src/core/strategy.js';

describe('findStrategies', () => {
  it('returns strategies on chart', async () => {
    const fake = async () => ([
      { id: 'st_001', name: 'RSI Strategy', is_strategy: true },
      { id: 'st_002', name: 'EMA',           is_strategy: false },
      { id: 'st_003', name: 'MACD Strategy', is_strategy: true },
    ]);
    const result = await findStrategies({ _deps: { evaluate: fake, getChartApi: async () => 'x' } });
    assert.equal(result.length, 2);
    assert.equal(result[0].entity_id, 'st_001');
    assert.equal(result[0].name, 'RSI Strategy');
    assert.equal(result[1].entity_id, 'st_003');
  });

  it('returns empty array when no strategies', async () => {
    const fake = async () => ([{ id: 'st_001', name: 'Volume', is_strategy: false }]);
    const result = await findStrategies({ _deps: { evaluate: fake, getChartApi: async () => 'x' } });
    assert.deepEqual(result, []);
  });
});

describe('findStrategyById', () => {
  it('finds strategy by id', async () => {
    const fake = async () => ([
      { id: 'st_001', name: 'RSI Strategy', is_strategy: true },
      { id: 'st_002', name: 'MACD Strategy', is_strategy: true },
    ]);
    const r = await findStrategyById('st_002', { _deps: { evaluate: fake, getChartApi: async () => 'x' } });
    assert.equal(r.entity_id, 'st_002');
    assert.equal(r.name, 'MACD Strategy');
  });

  it('returns null when not found', async () => {
    const fake = async () => ([{ id: 'st_001', name: 'RSI', is_strategy: true }]);
    const r = await findStrategyById('st_missing', { _deps: { evaluate: fake, getChartApi: async () => 'x' } });
    assert.equal(r, null);
  });

  it('with omitted id returns first strategy', async () => {
    const fake = async () => ([
      { id: 'st_001', name: 'RSI Strategy', is_strategy: true },
      { id: 'st_002', name: 'MACD Strategy', is_strategy: true },
    ]);
    const r = await findStrategyById(undefined, { _deps: { evaluate: fake, getChartApi: async () => 'x' } });
    assert.equal(r.entity_id, 'st_001');
  });
});

describe('parseSettingsTree', () => {
  it('extracts canonical fields from a TV-shaped tree', () => {
    const make = (val) => ({ value: () => val });
    const fakeTree = {
      childs: () => ({
        currencyId:        make('USD'),
        initial_capital:   make(10000),
        pyramiding:        make(2),
        slippage:          make(1),
        commission_value:  make(0.075),
        commission_type:   make('percent'),
        default_qty_type:  make('percent_of_equity'),
        default_qty_value: make(100),
      }),
    };
    const r = parseSettingsTree(fakeTree);
    assert.equal(r.settings.initial_capital, 10000);
    assert.equal(r.settings.commission_value, 0.075);
    assert.equal(r.settings.commission_type, 'percent');
    assert.equal(r.settings.pyramiding, 2);
    assert.ok(r.raw_property_keys.length >= 6);
  });

  it('skips properties whose value() throws', () => {
    const make = (val) => ({ value: () => val });
    const broken = { value: () => { throw new Error('boom'); } };
    const fakeTree = {
      childs: () => ({ initial_capital: make(5000), broken_thing: broken }),
    };
    const r = parseSettingsTree(fakeTree);
    assert.equal(r.settings.initial_capital, 5000);
  });
});

describe('getSettings', () => {
  it('returns canonical settings for a strategy', async () => {
    const fakeEvaluate = async (expr) => {
      // First call: findStrategies — returns one strategy
      if (expr.includes('dataSources') && !expr.includes('childs')) {
        return [{ id: 'st_X', name: 'RSI Strategy', is_strategy: true }];
      }
      // Second call: read settings — returns canonical struct
      if (expr.includes('childs')) {
        return {
          settings: { initial_capital: 10000, commission_value: 0.05 },
          raw_property_keys: ['currencyId', 'initial_capital', 'commission_value'],
        };
      }
      return null;
    };
    const r = await getSettings({ _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 'st_X');
    assert.equal(r.settings.initial_capital, 10000);
  });

  it('errors when no strategy on chart', async () => {
    const fakeEvaluate = async () => [];
    const r = await getSettings({ _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, false);
    assert.match(r.error, /No strategy on chart/i);
  });
});

describe('setSettings', () => {
  it('applies partial settings + returns applied/skipped lists', async () => {
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dataSources') && !expr.includes('setValue')) {
        return [{ id: 'st_X', name: 'RSI', is_strategy: true }];
      }
      return { applied: { commission_value: 0.1 }, skipped: [] };
    };
    const r = await setSettings({
      entity_id: 'st_X',
      settings: { commission_value: 0.1 },
      _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' },
    });
    assert.equal(r.success, true);
    assert.equal(r.entity_id, 'st_X');
    assert.deepEqual(r.applied, { commission_value: 0.1 });
    assert.deepEqual(r.skipped, []);
  });

  it('reports skipped settings for unmapped canonical names', async () => {
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dataSources') && !expr.includes('setValue')) {
        return [{ id: 'st_X', name: 'RSI', is_strategy: true }];
      }
      return { applied: {}, skipped: ['margin_long'] };
    };
    const r = await setSettings({
      entity_id: 'st_X',
      settings: { margin_long: 50 },
      _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' },
    });
    assert.equal(r.success, true);
    assert.deepEqual(r.skipped, ['margin_long']);
  });

  it('rejects empty settings object', async () => {
    await assert.rejects(
      () => setSettings({ settings: {} }),
      /at least one setting/i,
    );
  });
});

describe('extractPerformanceSummary', () => {
  it('normalizes TV reportData fields to canonical names', () => {
    const fakeReport = {
      netProfit: 1234.56,
      netProfitPercent: 12.35,
      grossProfit: 2345.0,
      grossLoss: -1110.4,
      totalTrades: 42,
      winningTrades: 25,
      losingTrades: 17,
      maxDrawdown: -456.78,
      maxDrawdownPercent: -4.57,
      buyHoldReturn: 234.5,
      buyHoldReturnPercent: 2.35,
    };
    const r = extractPerformanceSummary(fakeReport);
    assert.equal(r.net_profit, 1234.56);
    assert.equal(r.total_trades, 42);
    assert.equal(r.percent_profitable, '59.52%');
    assert.equal(r.max_drawdown, -456.78);
  });

  it('omits fields missing in source', () => {
    const r = extractPerformanceSummary({ netProfit: 100 });
    assert.equal(r.net_profit, 100);
    assert.equal(r.total_trades, undefined);
  });
});

describe('getPerformanceSummary', () => {
  it('returns metrics for a strategy', async () => {
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dataSources') && !expr.includes('reportData')) {
        return [{ id: 'st_X', name: 'RSI', is_strategy: true }];
      }
      return { raw: { netProfit: 500, totalTrades: 10, winningTrades: 6 } };
    };
    const r = await getPerformanceSummary({ _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, true);
    assert.equal(r.metrics.net_profit, 500);
    assert.equal(r.metrics.total_trades, 10);
  });
});
