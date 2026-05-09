import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMcpTable, MAGIC_VP, MAGIC_TPO, findHelperStudy, readHelperTable, vpAdd, vpGet, vpRemove, patternsAdd, PATTERN_STUDY_NAMES, patternsList, tpoAdd, tpoGet, footprintToggle } from '../src/core/premium_chart.js';

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

describe('findHelperStudy', () => {
  it('returns study id when helper present', async () => {
    const fakeEvaluate = async () => ([
      { name: 'EMA', id: 'st_001' },
      { name: 'TV-MCP Helper', id: 'st_042' },
    ]);
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await findHelperStudy({ _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result, 'st_042');
  });

  it('returns null when helper absent', async () => {
    const fakeEvaluate = async () => ([{ name: 'EMA', id: 'st_001' }]);
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await findHelperStudy({ _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result, null);
  });
});

describe('readHelperTable', () => {
  it('reads MCP-VP table via data tools and parses', async () => {
    const fakeRows = [
      ['MCP_VP_v1', 'visible_range'],
      ['poc', '100'],
      ['vah', '110'],
      ['val', '90'],
      ['total_volume', '1000'],
      ['va_pct', '0.7'],
      ['rows', '1'],
      ['100', '500'],
    ];
    const flatCells = fakeRows.flatMap((r, ri) => r.map((c, ci) => ({ id: `${ri}-${ci}`, raw: { row: ri, column: ci, text: c } })));
    const fakeEvaluate = async (expr) => {
      if (expr.includes('TV-MCP Helper')) return flatCells;
      return null;
    };
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await readHelperTable('MCP_VP_v1', { _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result.poc, 100);
  });
});

describe('vpAdd', () => {
  it('returns success with study_id when helper installed', async () => {
    const setInputsCalls = [];
    const fakeSetInputs = async (args) => { setInputsCalls.push(args); return { success: true }; };
    const fakeEvaluate = async () => ([{ id: 'st_helper', name: 'TV-MCP Helper' }]);
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await vpAdd({
      variant: 'visible_range', rows: 24, va_pct: 0.7,
      _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi, setInputs: fakeSetInputs },
    });
    assert.equal(result.success, true);
    assert.equal(result.variant, 'visible_range');
    assert.equal(result.study_id, 'st_helper');
    assert.equal(setInputsCalls.length, 1);
    assert.equal(setInputsCalls[0].inputs.mode, 'vp');
  });

  it('errors when helper not installed', async () => {
    const fakeEvaluate = async () => ([]);
    const fakeGetChartApi = async () => 'window.fakeChart';
    await assert.rejects(
      () => vpAdd({ variant: 'visible_range', _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi, setInputs: async () => ({}) } }),
      /not found/i
    );
  });

  it('rejects invalid variant', async () => {
    await assert.rejects(
      () => vpAdd({ variant: 'bad_value' }),
      /variant/i
    );
  });
});

describe('vpGet', () => {
  it('returns parsed VP struct with bins', async () => {
    const flatCells = [
      ['MCP_VP_v1', 'visible_range'],
      ['poc', '24530.5'],
      ['vah', '24580.25'],
      ['val', '24470.0'],
      ['total_volume', '245800.0'],
      ['va_pct', '0.7'],
      ['rows', '2'],
      ['24580.0', '12450.0'],
      ['24470.0', '18200.0'],
    ].flatMap((cols, r) => cols.map((text, c) => ({ id: `${r}-${c}`, raw: { row: r, column: c, text } })));

    const fakeEvaluate = async (expr) => {
      if (expr.includes('TV-MCP Helper')) return flatCells;
      return null;
    };
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await vpGet({ _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result.success, true);
    assert.equal(result.poc, 24530.5);
    assert.equal(result.bins.length, 2);
  });

  it('caps bins via bins_limit', async () => {
    const rows = [
      ['MCP_VP_v1', 'visible_range'],
      ['poc', '100'], ['vah', '110'], ['val', '90'],
      ['total_volume', '1000'], ['va_pct', '0.7'], ['rows', '5'],
      ['100', '1'], ['101', '2'], ['102', '3'], ['103', '4'], ['104', '5'],
    ];
    const flatCells = rows.flatMap((cols, r) => cols.map((text, c) => ({ id: `${r}-${c}`, raw: { row: r, column: c, text } })));
    const fakeEvaluate = async () => flatCells;
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await vpGet({ bins_limit: 3, _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result.bins.length, 3);
  });
});

describe('vpRemove', () => {
  it('removes helper and returns removed:true when present', async () => {
    let removed = false;
    const fakeEvaluate = async () => removed ? [] : [{ id: 'st_helper', name: 'TV-MCP Helper' }];
    const fakeGetChartApi = async () => 'window.fakeChart';
    const fakeManageIndicator = async () => { removed = true; return { success: true }; };
    const result = await vpRemove({ _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi, manageIndicator: fakeManageIndicator } });
    assert.equal(result.success, true);
    assert.equal(result.removed, true);
  });

  it('returns removed:false when not present (idempotent)', async () => {
    const fakeEvaluate = async () => ([]);
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await vpRemove({ _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result.success, true);
    assert.equal(result.removed, false);
  });
});

describe('patternsAdd', () => {
  it('adds candlestick pattern study by full name', async () => {
    const calls = [];
    const fakeManageIndicator = async (args) => { calls.push(args); return { success: true, entity_id: 'st_p1' }; };
    const result = await patternsAdd({
      kinds: ['candlestick'],
      _deps: { manageIndicator: fakeManageIndicator, evaluate: async () => [], getChartApi: async () => 'x' },
    });
    assert.equal(result.success, true);
    assert.equal(result.added.length, 1);
    assert.equal(result.added[0].kind, 'candlestick');
    assert.equal(calls[0].indicator, PATTERN_STUDY_NAMES.candlestick);
  });

  it('adds multiple kinds in one call', async () => {
    const fakeManageIndicator = async () => ({ success: true, entity_id: 'st_x' });
    const result = await patternsAdd({
      kinds: ['candlestick', 'harmonic'],
      _deps: { manageIndicator: fakeManageIndicator, evaluate: async () => [], getChartApi: async () => 'x' },
    });
    assert.equal(result.added.length, 2);
  });

  it('rejects empty or invalid kinds', async () => {
    await assert.rejects(() => patternsAdd({ kinds: [] }), /at least one/i);
    await assert.rejects(() => patternsAdd({ kinds: ['bogus'] }), /unknown kind/i);
  });
});

describe('patternsList', () => {
  it('returns parsed patterns with kind, name, price, bar_time', async () => {
    const fakeEvaluate = async (expr) => {
      return [
        { name: 'All Candlestick Patterns', items: [
          { id: 'l1', raw: { text: 'Bullish Engulfing', points: [{ price: 24512.5, time: 1715260200 }] } },
        ]},
        { name: 'Harmonic Patterns', items: [
          { id: 'l2', raw: { text: 'Bullish Gartley', points: [{ price: 24470.0, time: 1715253000 }] } },
        ]},
      ];
    };
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await patternsList({ _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result.success, true);
    assert.equal(result.patterns.length, 2);
    assert.equal(result.patterns[0].kind, 'candlestick');
    assert.equal(result.patterns[0].name, 'Bullish Engulfing');
    assert.equal(result.patterns[1].kind, 'harmonic');
  });

  it('filters by kinds', async () => {
    const fakeEvaluate = async () => [
      { name: 'All Candlestick Patterns', items: [
        { id: 'l1', raw: { text: 'Doji', points: [{ price: 100, time: 1 }] } },
      ]},
      { name: 'Harmonic Patterns', items: [
        { id: 'l2', raw: { text: 'Bat', points: [{ price: 200, time: 2 }] } },
      ]},
    ];
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await patternsList({ kinds: ['harmonic'], _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result.patterns.length, 1);
    assert.equal(result.patterns[0].kind, 'harmonic');
  });
});

describe('tpoAdd', () => {
  it('configures helper for TPO mode', async () => {
    const calls = [];
    const fakeSetInputs = async (args) => { calls.push(args); return { success: true }; };
    const fakeEvaluate = async () => ([{ id: 'st_helper', name: 'TV-MCP Helper' }]);
    const fakeGetChartApi = async () => 'x';
    const result = await tpoAdd({
      period_min: 30, session: 'RTH', va_pct: 0.7,
      _deps: { setInputs: fakeSetInputs, evaluate: fakeEvaluate, getChartApi: fakeGetChartApi },
    });
    assert.equal(result.success, true);
    assert.equal(calls[0].inputs.mode, 'tpo');
    assert.equal(calls[0].inputs.tpo_period, 30);
  });

  it('rejects invalid period_min', async () => {
    await assert.rejects(() => tpoAdd({ period_min: 0 }), /period/i);
  });

  it('rejects invalid session', async () => {
    await assert.rejects(() => tpoAdd({ period_min: 30, session: 'BAD' }), /session/i);
  });
});

describe('tpoGet', () => {
  it('returns parsed TPO struct with letter rows + IB + value area', async () => {
    const rows = [
      ['MCP_TPO_v1', 'RTH'],
      ['period_min', '30'],
      ['poc', '24530'],
      ['vah', '24580'],
      ['val', '24470'],
      ['ib_high', '24580'],
      ['ib_low', '24500'],
      ['levels', '3'],
      ['24580', 'ABCD'],
      ['24530', 'ABCDEF'],
      ['24470', 'A'],
    ];
    const flatCells = rows.flatMap((cols, r) => cols.map((text, c) => ({ id: `${r}-${c}`, raw: { row: r, column: c, text } })));
    const fakeEvaluate = async () => flatCells;
    const fakeGetChartApi = async () => 'x';
    const result = await tpoGet({ _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result.success, true);
    assert.equal(result.session, 'RTH');
    assert.equal(result.period_min, 30);
    assert.equal(result.poc, 24530);
    assert.deepEqual(result.value_area, { vah: 24580, val: 24470 });
    assert.deepEqual(result.initial_balance, { high: 24580, low: 24500 });
    assert.equal(result.letter_rows.length, 3);
    assert.equal(result.single_prints.length, 1);
    assert.equal(result.single_prints[0].letters, 'A');
  });
});

describe('footprintToggle', () => {
  it('switches chart type to VolumeFootprint and remembers previous', async () => {
    const calls = [];
    const fakeSetType = async ({ type }) => { calls.push(type); return { success: true }; };
    const fakeGetState = async () => ({ chart_type: 'Candles' });
    const result = await footprintToggle({
      enable: true,
      _deps: { setType: fakeSetType, getChartState: fakeGetState, evaluate: async () => null, getChartApi: async () => 'x' },
    });
    assert.equal(result.success, true);
    assert.equal(result.current_type, 'VolumeFootprint');
    assert.equal(result.previous_type, 'Candles');
    assert.equal(calls[0], 'VolumeFootprint');
  });

  it('reverts to remembered previous type', async () => {
    let chart_type = 'VolumeFootprint';
    const fakeSetType = async ({ type }) => { chart_type = type; return { success: true }; };
    const fakeGetState = async () => ({ chart_type });
    await footprintToggle({
      enable: true,
      _deps: { setType: fakeSetType, getChartState: fakeGetState, evaluate: async () => null, getChartApi: async () => 'x' },
    });
    chart_type = 'VolumeFootprint';
    const result = await footprintToggle({
      enable: false,
      _deps: { setType: fakeSetType, getChartState: fakeGetState, evaluate: async () => null, getChartApi: async () => 'x' },
    });
    assert.equal(result.current_type, 'Candles');
  });
});
