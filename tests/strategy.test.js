import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findStrategies, findStrategyById } from '../src/core/strategy.js';

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
