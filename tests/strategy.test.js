import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findStrategies, findStrategyById } from '../src/core/strategy.js';
import { getSettings, parseSettingsTree, CANONICAL_TO_TV_PATH } from '../src/core/strategy.js';

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
