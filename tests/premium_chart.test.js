import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpTable, MAGIC_VP, MAGIC_TPO } from '../src/core/premium_chart.js';

describe('parseMcpTable — Volume Profile', () => {
  const sampleVpRows = [
    ['MCP_VP_v1', 'visible_range'],
    ['poc', '24530.5'],
    ['vah', '24580.25'],
    ['val', '24470.0'],
    ['total_volume', '245800.0'],
    ['va_pct', '0.7'],
    ['rows', '2'],
    ['24580.0', '12450.0'],
    ['24470.0', '18200.0'],
  ];

  it('parses VP magic header + summary + bins', () => {
    const result = parseMcpTable(sampleVpRows, MAGIC_VP);
    assert.equal(result.variant, 'visible_range');
    assert.equal(result.poc, 24530.5);
    assert.equal(result.vah, 24580.25);
    assert.equal(result.val, 24470.0);
    assert.equal(result.total_volume, 245800.0);
    assert.equal(result.value_area_pct, 0.7);
    assert.deepEqual(result.bins, [
      { price: 24580.0, volume: 12450.0 },
      { price: 24470.0, volume: 18200.0 },
    ]);
  });

  it('rejects table with wrong magic', () => {
    const wrong = [['MCP_OTHER_v1', 'x']];
    assert.throws(() => parseMcpTable(wrong, MAGIC_VP), /magic header/i);
  });

  it('rejects empty table', () => {
    assert.throws(() => parseMcpTable([], MAGIC_VP), /empty/i);
  });
});
