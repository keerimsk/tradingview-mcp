# Epic #3a — Strategy Tester deep control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-05-10-epic3a-strategy-tester-design.md](../specs/2026-05-10-epic3a-strategy-tester-design.md)

**Goal:** Add 8 strategy-domain MCP tools so an LLM agent can list, configure (settings + Deep Backtest), and read three Strategy Tester tabs (performance / trades analysis / risk ratios) without leaving the chart.

**Architecture:** New `src/core/strategy.js` + `src/tools/strategy.js` + `src/cli/commands/strategy.js`, mirroring the layout introduced by Epic #1's `premium_chart.*`. Existing `data_get_strategy_results`/`getTrades`/`getEquity` stay where they are. Strategy locator + settings parser + tab extractors are the core units; everything composes them.

**Tech Stack:** Node.js 18+ ESM, `@modelcontextprotocol/sdk` ^1.12.1, `chrome-remote-interface`, `zod`, `node:test`. `_resolve(deps)` pattern for testability (proven across Epics #1/#2).

**Repo conventions** (carry over from prior epics):
- `src/core/<module>.js` exports async functions accepting `_deps` for test injection
- `src/tools/<module>.js` registers MCP tools wrapped in `try { jsonResult(await core.fn()) } catch { jsonResult({success:false, error:err.message}, true) }`
- `src/cli/commands/<module>.js` registers via `cli/router.js`
- `src/server.js` + `src/cli/index.js` wire-up
- Connection helpers from `src/connection.js`: `evaluate`, `getChartApi`, `safeString`, `KNOWN_PATHS`

**Discovery dependencies (controller-driven):**
The spec lists 4 Open Questions. The controller (operator) handles a live probe phase before/during implementation:
- Strategy property internal field names → Phase 0.0 probe
- Performance tabs source structure (reportData / performance / per-tab) → Phase 0.0 probe
- Deep Backtest property path → Phase 4 probe (similar to Bar Magnifier)
- `set_active` API existence → Phase 4 probe

Subagents skip live probes; they use placeholders with clear `// PROBE-PENDING` comments. The controller fills probe results in afterwards.

---

## Phase 0 — Branch + initial probe

### Task 0.0: Create feature branch

**Files:** none (git only)

- [ ] **Step 1: Verify clean master**

```bash
cd c:/Users/Kerim/Desktop/tradingview-mcp
git status
git branch --show-current
```
Expected: `master`, clean tree.

- [ ] **Step 2: Create branch**

```bash
git checkout -b epic3a-strategy-tester
```
Expected: `Switched to a new branch 'epic3a-strategy-tester'`.

### [CONTROLLER PROBE] Task 0.1: Strategy property tree probe

**Files:** none (probe only — operator-driven)

This task discovers the live TV's strategy property field names. Subagents skip this — they use canonical mapping placeholders that the controller updates after this probe.

- [ ] **Step 1: Operator confirms a strategy is on chart**

If not, the operator adds a built-in Pine strategy (Indicators dialog → "Built-ins" tab → "Strategies" subtab → e.g., "RSI Strategy" or "MACD Strategy"). Note the entity_id from `tv state` afterwards.

- [ ] **Step 2: Operator runs property-tree probe**

```bash
node src/cli/index.js ui eval "
(function() {
  var chart = window.TradingViewApi._activeChartWidgetWV.value();
  var sources = chart._chartWidget.model().model().dataSources();
  for (var si = 0; si < sources.length; si++) {
    var s = sources[si];
    if (!s.metaInfo || !s.properties) continue;
    var meta = s.metaInfo();
    var isStrat = meta.is_strategy || (s.reportData != null);
    if (!isStrat) continue;
    var props = s.properties().childs();
    var keys = Object.keys(props);
    var report = { strategy_name: meta.description || meta.shortDescription, entity_id: s.id ? s.id() : null, top_level_keys: keys };
    // Drill into first 3 levels for capital/commission/pyramiding/slippage candidates
    var hits = {};
    function walk(node, prefix, depth) {
      if (depth > 4) return;
      try {
        var c = (typeof node.childs === 'function') ? node.childs() : null;
        if (!c) return;
        var ks = Object.keys(c);
        for (var i = 0; i < ks.length; i++) {
          var k = ks[i];
          if (/capital|commission|pyramid|slip|margin|qty|backtest|deep/i.test(k)) {
            try {
              var v = c[k] && typeof c[k].value === 'function' ? c[k].value() : '<no-value>';
              hits[prefix + '.' + k] = v;
            } catch(e) {}
          }
          walk(c[k], prefix + '.' + k, depth + 1);
        }
      } catch(e) {}
    }
    walk(s.properties(), 'props', 0);
    report.canonical_hits = hits;
    return report;
  }
  return { error: 'No strategy found on chart' };
})()
"
```

- [ ] **Step 3: Operator records canonical mappings**

From `canonical_hits`, identify the property paths for:
- `initial_capital` → e.g., `props.initialCapital` or `props.capital`
- `commission_value` → e.g., `props.commission.value`
- `commission_type` → e.g., `props.commission.type`
- `slippage` → e.g., `props.slippage`
- `pyramiding` → e.g., `props.pyramiding`
- `margin_long` / `margin_short` → e.g., `props.marginLong` / `props.marginShort`
- `default_qty_type` / `default_qty_value` → e.g., `props.defaultQtyType` / `props.defaultQtyValue`

Operator updates `CANONICAL_TO_TV_PATH` constants in Task 2.1's code with discovered paths. If a canonical setting has no probe match, mark as `null` (the implementation skips unmapped settings with a "skipped" warning).

- [ ] **Step 4: Operator probes performance tabs source**

```bash
node src/cli/index.js ui eval "
(function() {
  var chart = window.TradingViewApi._activeChartWidgetWV.value();
  var sources = chart._chartWidget.model().model().dataSources();
  for (var si = 0; si < sources.length; si++) {
    var s = sources[si];
    if (!s.metaInfo) continue;
    var meta = s.metaInfo();
    if (!(meta.is_strategy || s.reportData)) continue;
    var report = { strategy_name: meta.description };
    if (s.reportData) {
      var rd = typeof s.reportData === 'function' ? s.reportData() : s.reportData;
      if (rd && typeof rd.value === 'function') rd = rd.value();
      report.reportData_top_keys = rd && typeof rd === 'object' ? Object.keys(rd) : [];
    }
    if (s.performance) {
      var perf = s.performance();
      if (perf && typeof perf.value === 'function') perf = perf.value();
      report.performance_top_keys = perf && typeof perf === 'object' ? Object.keys(perf) : [];
    }
    return report;
  }
  return { error: 'No strategy found on chart' };
})()
"
```

- [ ] **Step 5: Operator records performance source structure**

From the probe output, document which object holds:
- Performance Summary metrics (net_profit, total_trades, max_drawdown, percent_profitable)
- Trades Analysis metrics (avg_trade, max_consecutive_wins, avg_bars_in_winning_trade)
- Risk Ratios (sharpe, sortino, profit_factor)

Subagent Tasks 3.1/3.2/3.3 use placeholder field names with the same `// PROBE-PENDING` pattern — controller updates them in Phase 7.

---

## Phase 1 — Core skeleton + strategy locator (TDD)

### Task 1.1: Create `src/core/strategy.js` skeleton + `findStrategies` helper

**Files:**
- Create: `src/core/strategy.js`
- Create: `tests/strategy.test.js`

- [ ] **Step 1: Write failing test for `findStrategies`**

Create `tests/strategy.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test, confirm fails**

```bash
cd c:/Users/Kerim/Desktop/tradingview-mcp
node --test tests/strategy.test.js
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/strategy.js`**

```javascript
/**
 * Strategy Tester deep control: list, settings, performance tabs, deep backtest.
 *
 * IMPORTANT: TV-internal property names are placeholders below — the controller
 * replaces them after probing a live strategy on chart (see plan Phase 0.0).
 */
import {
  evaluate as _evaluate,
  getChartApi as _getChartApi,
  safeString,
} from '../connection.js';

function _resolve(deps) {
  return {
    evaluate:    deps?.evaluate    || _evaluate,
    getChartApi: deps?.getChartApi || _getChartApi,
  };
}

/**
 * Returns all strategies currently on the chart as `{entity_id, name}`.
 */
export async function findStrategies({ _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const all = await evaluate(`
    (function() {
      var api = ${apiPath};
      var widget = api._chartWidget;
      var sources = widget.model().model().dataSources();
      var out = [];
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var isStrat = meta.is_strategy === true || (s.reportData != null && meta.is_price_study === false);
          out.push({
            id: s.id ? s.id() : null,
            name: meta.description || meta.shortDescription || '',
            is_strategy: !!isStrat,
          });
        } catch(e) {}
      }
      return out;
    })()
  `);
  return (all || [])
    .filter(s => s.is_strategy)
    .map(s => ({ entity_id: s.id, name: s.name }));
}

/**
 * Find a strategy by entity_id, or return the first strategy if id omitted.
 * Returns null if no match.
 */
export async function findStrategyById(entity_id, { _deps } = {}) {
  const list = await findStrategies({ _deps });
  if (list.length === 0) return null;
  if (!entity_id) return list[0];
  return list.find(s => s.entity_id === entity_id) || null;
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
node --test tests/strategy.test.js
```
Expected: 5 cases pass (2 findStrategies + 3 findStrategyById).

- [ ] **Step 5: Commit**

```bash
git add src/core/strategy.js tests/strategy.test.js
git commit -m "feat(core): strategy module skeleton + findStrategies / findStrategyById"
```

---

## Phase 2 — Settings (TDD)

### Task 2.1: `getSettings` + canonical mapping

**Files:**
- Modify: `src/core/strategy.js`
- Modify: `tests/strategy.test.js`

- [ ] **Step 1: Write failing test for `getSettings`**

Append to `tests/strategy.test.js`:

```javascript
import { getSettings, parseSettingsTree, CANONICAL_TO_TV_PATH } from '../src/core/strategy.js';

describe('parseSettingsTree', () => {
  it('extracts canonical fields from a TV-shaped tree', () => {
    // Simulate a TV property tree as a plain object {key: {value: () => v, childs: () => sub}}
    const make = (val) => ({ value: () => val });
    const fakeTree = {
      childs: () => ({
        currencyId:        make('USD'),
        initial_capital:   make(10000),     // canonical placeholder; real key from probe
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
      if (expr.includes('dataSources')) {
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
```

- [ ] **Step 2: Run, confirm fails**

```bash
node --test tests/strategy.test.js
```
Expected: FAIL — `parseSettingsTree`/`getSettings`/`CANONICAL_TO_TV_PATH` not exported.

- [ ] **Step 3: Add to `src/core/strategy.js`**

Append:

```javascript
// Canonical name → TV-internal property path. CONTROLLER: update these from
// Phase 0.1 probe results. `null` means the canonical setting could not be
// located in this TV version — getSettings/setSettings will skip it gracefully.
export const CANONICAL_TO_TV_PATH = {
  initial_capital:   'initial_capital',     // PROBE-PENDING
  default_qty_type:  'default_qty_type',    // PROBE-PENDING
  default_qty_value: 'default_qty_value',   // PROBE-PENDING
  commission_type:   'commission_type',     // PROBE-PENDING
  commission_value:  'commission_value',    // PROBE-PENDING
  slippage:          'slippage',            // PROBE-PENDING
  pyramiding:        'pyramiding',          // PROBE-PENDING
  margin_long:       'margin_long',         // PROBE-PENDING
  margin_short:      'margin_short',        // PROBE-PENDING
};

/**
 * Walk a TV property-tree node, return canonical settings + raw key list.
 * Each TV property has .value() / .setValue() / .childs(). Some TV "value" calls
 * throw on uninitialized properties — those are silently skipped.
 */
export function parseSettingsTree(node) {
  const settings = {};
  const raw_property_keys = [];
  const childs = (typeof node?.childs === 'function') ? node.childs() : null;
  if (!childs) return { settings, raw_property_keys };

  for (const key of Object.keys(childs)) {
    raw_property_keys.push(key);
    const child = childs[key];
    if (!child || typeof child.value !== 'function') continue;
    let value;
    try { value = child.value(); } catch { continue; }
    // Canonical mapping: if this raw key is one of the canonical-target paths, store it.
    for (const [canonical, tvPath] of Object.entries(CANONICAL_TO_TV_PATH)) {
      if (tvPath === key) {
        settings[canonical] = value;
        break;
      }
    }
  }
  return { settings, raw_property_keys };
}

export async function getSettings({ entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };

  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var api = ${apiPath};
      var widget = api._chartWidget;
      var sources = widget.model().model().dataSources();
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (s.id && s.id() === ${safeString(strat.entity_id)}) {
          if (!s.properties) return { settings: {}, raw_property_keys: [] };
          // Inline parse: TV property values are functions; we can't transfer
          // function refs through CDP, so we extract here.
          var node = s.properties();
          var childs = (typeof node.childs === 'function') ? node.childs() : null;
          if (!childs) return { settings: {}, raw_property_keys: [] };
          var settings = {};
          var raw = [];
          var canonical = ${JSON.stringify(CANONICAL_TO_TV_PATH)};
          var canonByPath = {};
          for (var c in canonical) { if (canonical[c]) canonByPath[canonical[c]] = c; }
          var keys = Object.keys(childs);
          for (var k = 0; k < keys.length; k++) {
            var rk = keys[k];
            raw.push(rk);
            var child = childs[rk];
            if (!child || typeof child.value !== 'function') continue;
            var v;
            try { v = child.value(); } catch(e) { continue; }
            if (canonByPath[rk]) settings[canonByPath[rk]] = v;
          }
          return { settings: settings, raw_property_keys: raw };
        }
      }
      return null;
    })()
  `);

  if (!result) return { success: false, error: `Strategy ${strat.entity_id} not found in current dataSources.` };
  return {
    success: true,
    entity_id: strat.entity_id,
    name: strat.name,
    settings: result.settings,
    raw_property_keys: result.raw_property_keys,
  };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
node --test tests/strategy.test.js
```
Expected: 9 cases pass (5 prior + 2 parseSettingsTree + 2 getSettings).

- [ ] **Step 5: Commit**

```bash
git add src/core/strategy.js tests/strategy.test.js
git commit -m "feat(core): parseSettingsTree + getSettings (canonical mapping placeholder)"
```

### Task 2.2: `setSettings` partial-update

**Files:**
- Modify: `src/core/strategy.js`
- Modify: `tests/strategy.test.js`

- [ ] **Step 1: Append failing test**

```javascript
import { setSettings } from '../src/core/strategy.js';

describe('setSettings', () => {
  it('applies partial settings + returns applied/skipped lists', async () => {
    const writes = [];
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dataSources')) {
        // findStrategies result
        if (!expr.includes('setValue')) return [{ id: 'st_X', name: 'RSI', is_strategy: true }];
        // setSettings JS — return success report
        return { applied: { commission_value: 0.1 }, skipped: [] };
      }
      return null;
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

  it('reports skipped settings when canonical path is null', async () => {
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
```

- [ ] **Step 2: Run, confirm fails**

```bash
node --test tests/strategy.test.js
```
Expected: FAIL — `setSettings` not exported.

- [ ] **Step 3: Add to `src/core/strategy.js`**

```javascript
export async function setSettings({ entity_id, settings, _deps } = {}) {
  if (!settings || typeof settings !== 'object' || Object.keys(settings).length === 0) {
    throw new Error('setSettings: provide at least one setting to update');
  }
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };

  const apiPath = await getChartApi();
  // Build canonical → tv-path resolution map filtered to requested settings.
  const writes = [];
  const skipped = [];
  for (const [canonical, value] of Object.entries(settings)) {
    const tvPath = CANONICAL_TO_TV_PATH[canonical];
    if (!tvPath) skipped.push(canonical);
    else writes.push({ canonical, tvPath, value });
  }

  if (writes.length === 0) {
    return { success: true, entity_id: strat.entity_id, applied: {}, skipped };
  }

  const result = await evaluate(`
    (function() {
      var api = ${apiPath};
      var widget = api._chartWidget;
      var sources = widget.model().model().dataSources();
      var writes = ${JSON.stringify(writes)};
      var applied = {};
      var skipped_runtime = [];
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (s.id && s.id() === ${safeString(strat.entity_id)}) {
          if (!s.properties) return { applied: {}, skipped: writes.map(function(w){return w.canonical;}) };
          var node = s.properties();
          var childs = (typeof node.childs === 'function') ? node.childs() : null;
          if (!childs) return { applied: {}, skipped: writes.map(function(w){return w.canonical;}) };
          for (var w = 0; w < writes.length; w++) {
            var write = writes[w];
            var child = childs[write.tvPath];
            if (!child || typeof child.setValue !== 'function') {
              skipped_runtime.push(write.canonical);
              continue;
            }
            try {
              child.setValue(write.value);
              applied[write.canonical] = write.value;
            } catch(e) {
              skipped_runtime.push(write.canonical);
            }
          }
          return { applied: applied, skipped: skipped_runtime };
        }
      }
      return null;
    })()
  `);

  if (!result) return { success: false, error: `Strategy ${strat.entity_id} not found.` };
  const allSkipped = [...skipped, ...(result.skipped || [])];
  return {
    success: true,
    entity_id: strat.entity_id,
    applied: result.applied || {},
    skipped: allSkipped,
  };
}
```

- [ ] **Step 4: Run tests, pass**

```bash
node --test tests/strategy.test.js
```
Expected: 12 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/strategy.js tests/strategy.test.js
git commit -m "feat(core): setSettings — partial updates with canonical→TV path mapping"
```

---

## Phase 3 — Performance tabs (TDD)

### Task 3.1: `getPerformanceSummary`

**Files:**
- Modify: `src/core/strategy.js`
- Modify: `tests/strategy.test.js`

- [ ] **Step 1: Append failing test**

```javascript
import { getPerformanceSummary, extractPerformanceSummary, REPORT_FIELD_MAP } from '../src/core/strategy.js';

describe('extractPerformanceSummary', () => {
  it('normalizes TV reportData fields to canonical names', () => {
    // Field names below are placeholders — Phase 0.0 probe will replace.
    // Test verifies the mapping logic, not the specific TV field names.
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
      // reportData read
      return { raw: { netProfit: 500, totalTrades: 10, winningTrades: 6 } };
    };
    const r = await getPerformanceSummary({ _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, true);
    assert.equal(r.metrics.net_profit, 500);
    assert.equal(r.metrics.total_trades, 10);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
node --test tests/strategy.test.js
```
Expected: FAIL — `extractPerformanceSummary`/`getPerformanceSummary`/`REPORT_FIELD_MAP` not exported.

- [ ] **Step 3: Implement**

Append to `src/core/strategy.js`:

```javascript
// CONTROLLER: replace right-hand TV field names from Phase 0.1 probe.
export const REPORT_FIELD_MAP = {
  net_profit:           'netProfit',           // PROBE-PENDING
  net_profit_pct:       'netProfitPercent',    // PROBE-PENDING
  gross_profit:         'grossProfit',         // PROBE-PENDING
  gross_loss:           'grossLoss',           // PROBE-PENDING
  total_trades:         'totalTrades',         // PROBE-PENDING
  winning_trades:       'winningTrades',       // PROBE-PENDING
  losing_trades:        'losingTrades',        // PROBE-PENDING
  max_drawdown:         'maxDrawdown',         // PROBE-PENDING
  max_drawdown_pct:     'maxDrawdownPercent',  // PROBE-PENDING
  buy_hold_return:      'buyHoldReturn',       // PROBE-PENDING
  buy_hold_return_pct:  'buyHoldReturnPercent',// PROBE-PENDING
};

function _coerceFromMap(source, map) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const [canon, tvField] of Object.entries(map)) {
    if (source[tvField] !== undefined && source[tvField] !== null) {
      out[canon] = source[tvField];
    }
  }
  return out;
}

export function extractPerformanceSummary(reportData) {
  const out = _coerceFromMap(reportData, REPORT_FIELD_MAP);
  // Compute derived percent_profitable if both inputs present.
  if (typeof out.winning_trades === 'number' && typeof out.total_trades === 'number' && out.total_trades > 0) {
    const pct = (out.winning_trades / out.total_trades) * 100;
    out.percent_profitable = `${pct.toFixed(2)}%`;
  }
  return out;
}

async function _readReportData(strat, evaluate, getChartApi) {
  const apiPath = await getChartApi();
  return await evaluate(`
    (function() {
      var api = ${apiPath};
      var sources = api._chartWidget.model().model().dataSources();
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (s.id && s.id() === ${safeString(strat.entity_id)}) {
          var rd = s.reportData;
          if (typeof rd === 'function') rd = rd();
          if (rd && typeof rd.value === 'function') rd = rd.value();
          var perf = s.performance ? s.performance() : null;
          if (perf && typeof perf.value === 'function') perf = perf.value();
          return { raw: rd || {}, performance: perf || null };
        }
      }
      return null;
    })()
  `);
}

export async function getPerformanceSummary({ entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };

  const data = await _readReportData(strat, evaluate, getChartApi);
  if (!data) return { success: false, error: `Strategy ${strat.entity_id} not found.` };

  const metrics = extractPerformanceSummary(data.raw);
  return { success: true, entity_id: strat.entity_id, metrics };
}
```

- [ ] **Step 4: Run tests, pass**

```bash
node --test tests/strategy.test.js
```
Expected: 15 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/strategy.js tests/strategy.test.js
git commit -m "feat(core): getPerformanceSummary + extractPerformanceSummary (canonical normalization)"
```

### Task 3.2: `getTradesAnalysis`

**Files:**
- Modify: `src/core/strategy.js`
- Modify: `tests/strategy.test.js`

- [ ] **Step 1: Append failing test**

```javascript
import { getTradesAnalysis, extractTradesAnalysis, TRADES_FIELD_MAP } from '../src/core/strategy.js';

describe('extractTradesAnalysis', () => {
  it('normalizes TV trades-analysis fields', () => {
    const fakeReport = {
      avgTrade: 29.4,
      avgWinningTrade: 93.8,
      avgLosingTrade: -65.3,
      ratioAvgWinAvgLoss: 1.44,
      largestWinningTrade: 425.0,
      largestLosingTrade: -250.5,
      maxConsecutiveWins: 6,
      maxConsecutiveLosses: 4,
      avgBarsInWinningTrade: 12.3,
      avgBarsInLosingTrade: 8.7,
    };
    const r = extractTradesAnalysis(fakeReport);
    assert.equal(r.avg_trade, 29.4);
    assert.equal(r.max_consecutive_wins, 6);
    assert.equal(r.avg_bars_in_winning_trade, 12.3);
  });
});

describe('getTradesAnalysis', () => {
  it('returns trades-analysis metrics', async () => {
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dataSources') && !expr.includes('reportData')) {
        return [{ id: 'st_X', name: 'RSI', is_strategy: true }];
      }
      return { raw: { avgTrade: 50, maxConsecutiveWins: 4 } };
    };
    const r = await getTradesAnalysis({ _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, true);
    assert.equal(r.metrics.avg_trade, 50);
    assert.equal(r.metrics.max_consecutive_wins, 4);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
node --test tests/strategy.test.js
```

- [ ] **Step 3: Implement**

Append to `src/core/strategy.js`:

```javascript
export const TRADES_FIELD_MAP = {
  avg_trade:                 'avgTrade',                // PROBE-PENDING
  avg_winning_trade:         'avgWinningTrade',         // PROBE-PENDING
  avg_losing_trade:          'avgLosingTrade',          // PROBE-PENDING
  ratio_avg_win_loss:        'ratioAvgWinAvgLoss',      // PROBE-PENDING
  largest_winning_trade:     'largestWinningTrade',     // PROBE-PENDING
  largest_losing_trade:      'largestLosingTrade',      // PROBE-PENDING
  max_consecutive_wins:      'maxConsecutiveWins',      // PROBE-PENDING
  max_consecutive_losses:    'maxConsecutiveLosses',    // PROBE-PENDING
  avg_bars_in_winning_trade: 'avgBarsInWinningTrade',   // PROBE-PENDING
  avg_bars_in_losing_trade:  'avgBarsInLosingTrade',    // PROBE-PENDING
};

export function extractTradesAnalysis(reportData) {
  return _coerceFromMap(reportData, TRADES_FIELD_MAP);
}

export async function getTradesAnalysis({ entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };
  const data = await _readReportData(strat, evaluate, getChartApi);
  if (!data) return { success: false, error: `Strategy ${strat.entity_id} not found.` };
  const metrics = extractTradesAnalysis(data.raw);
  return { success: true, entity_id: strat.entity_id, metrics };
}
```

- [ ] **Step 4: Run tests, pass**

```bash
node --test tests/strategy.test.js
```
Expected: 17 cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/strategy.js tests/strategy.test.js
git commit -m "feat(core): getTradesAnalysis + extractTradesAnalysis"
```

### Task 3.3: `getRiskRatios`

**Files:**
- Modify: `src/core/strategy.js`
- Modify: `tests/strategy.test.js`

- [ ] **Step 1: Append failing test**

```javascript
import { getRiskRatios, extractRiskRatios, RISK_FIELD_MAP } from '../src/core/strategy.js';

describe('extractRiskRatios', () => {
  it('normalizes risk-ratio fields', () => {
    const fakeReport = {
      sharpeRatio: 1.42,
      sortinoRatio: 2.01,
      profitFactor: 2.11,
      calmarRatio: 0.85,
      recoveryFactor: 3.04,
      maxDrawdown: -456.78,
      maxDrawdownPercent: -4.57,
    };
    const r = extractRiskRatios(fakeReport);
    assert.equal(r.sharpe_ratio, 1.42);
    assert.equal(r.profit_factor, 2.11);
  });
});

describe('getRiskRatios', () => {
  it('returns risk metrics', async () => {
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dataSources') && !expr.includes('reportData')) {
        return [{ id: 'st_X', name: 'RSI', is_strategy: true }];
      }
      return { raw: { sharpeRatio: 1.5, profitFactor: 2.0 } };
    };
    const r = await getRiskRatios({ _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, true);
    assert.equal(r.metrics.sharpe_ratio, 1.5);
  });
});
```

- [ ] **Step 2: Implement**

Append to `src/core/strategy.js`:

```javascript
export const RISK_FIELD_MAP = {
  sharpe_ratio:     'sharpeRatio',          // PROBE-PENDING
  sortino_ratio:    'sortinoRatio',         // PROBE-PENDING
  profit_factor:    'profitFactor',         // PROBE-PENDING
  calmar_ratio:     'calmarRatio',          // PROBE-PENDING
  recovery_factor:  'recoveryFactor',       // PROBE-PENDING
  max_drawdown:     'maxDrawdown',          // PROBE-PENDING (also in summary)
  max_drawdown_pct: 'maxDrawdownPercent',   // PROBE-PENDING
};

export function extractRiskRatios(reportData) {
  return _coerceFromMap(reportData, RISK_FIELD_MAP);
}

export async function getRiskRatios({ entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };
  const data = await _readReportData(strat, evaluate, getChartApi);
  if (!data) return { success: false, error: `Strategy ${strat.entity_id} not found.` };
  const metrics = extractRiskRatios(data.raw);
  return { success: true, entity_id: strat.entity_id, metrics };
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/strategy.test.js
git add src/core/strategy.js tests/strategy.test.js
git commit -m "feat(core): getRiskRatios + extractRiskRatios (Sharpe/Sortino/ProfitFactor/Calmar)"
```
Expected tests: 19 cases pass.

---

## Phase 4 — Deep Backtest + set_active

### Task 4.1: `deepBacktestToggle`

**Files:**
- Modify: `src/core/strategy.js`
- Modify: `tests/strategy.test.js`

- [ ] **Step 1: Append failing test**

```javascript
import { deepBacktestToggle } from '../src/core/strategy.js';

describe('deepBacktestToggle', () => {
  it('returns success with enabled=true when toggled on', async () => {
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dataSources') && !expr.includes('setValue')) {
        return [{ id: 'st_X', name: 'RSI', is_strategy: true }];
      }
      // Property-tree walk: returns true (found and set)
      return true;
    };
    const r = await deepBacktestToggle({ enable: true, _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, true);
    assert.equal(r.enabled, true);
  });

  it('returns clear error when property not found', async () => {
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dataSources') && !expr.includes('setValue')) {
        return [{ id: 'st_X', name: 'RSI', is_strategy: true }];
      }
      return false;
    };
    const r = await deepBacktestToggle({ enable: true, _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, false);
    assert.match(r.error, /Deep Backtest property not found/i);
  });
});
```

- [ ] **Step 2: Implement**

Append to `src/core/strategy.js`:

```javascript
/**
 * Walks the active strategy's property tree (depth ≤ 5) for any property
 * whose key contains "deepbacktest" / "deep_backtest" / "useDeepBacktest" and
 * calls setValue(enable). Same defensive pattern as Epic #1's barMagnifierToggle.
 */
export async function deepBacktestToggle({ enable = true, entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };

  const apiPath = await getChartApi();
  const ok = await evaluate(`
    (function() {
      try {
        var api = ${apiPath};
        var sources = api._chartWidget.model().model().dataSources();
        var target = null;
        for (var i = 0; i < sources.length; i++) {
          if (sources[i].id && sources[i].id() === ${safeString(strat.entity_id)}) {
            target = sources[i];
            break;
          }
        }
        if (!target || !target.properties) return false;
        function walk(node, depth) {
          if (depth > 5 || !node) return false;
          try {
            var c = (typeof node.childs === 'function') ? node.childs() : null;
            if (!c) return false;
            var ks = Object.keys(c);
            for (var j = 0; j < ks.length; j++) {
              var k = ks[j];
              var lk = k.toLowerCase();
              if (lk.indexOf('deepbacktest') !== -1 || lk.indexOf('deep_backtest') !== -1 || lk.indexOf('usedeepbacktest') !== -1) {
                try { c[k].setValue(${enable ? 'true' : 'false'}); return true; } catch(e) {}
              }
              if (walk(c[k], depth + 1)) return true;
            }
          } catch(e) {}
          return false;
        }
        return walk(target.properties(), 0);
      } catch(e) { return false; }
    })()
  `);
  if (!ok) {
    return { success: false, error: 'Deep Backtest property not found in this TV version. Toggle manually if needed.' };
  }
  return { success: true, enabled: !!enable, entity_id: strat.entity_id };
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/strategy.test.js
git add src/core/strategy.js tests/strategy.test.js
git commit -m "feat(core): deepBacktestToggle via strategy property tree walk"
```
Expected: 21 cases pass.

### Task 4.2: `setActive`

**Files:**
- Modify: `src/core/strategy.js`
- Modify: `tests/strategy.test.js`

- [ ] **Step 1: Append failing test**

```javascript
import { setActive } from '../src/core/strategy.js';

describe('setActive', () => {
  it('returns success when underlying API succeeds', async () => {
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dataSources') && !expr.includes('setActiveStudy')) {
        return [{ id: 'st_X', name: 'RSI', is_strategy: true }, { id: 'st_Y', name: 'MACD', is_strategy: true }];
      }
      // setActive call returns 'ok'
      return 'ok';
    };
    const r = await setActive({ entity_id: 'st_Y', _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, true);
    assert.equal(r.active_entity_id, 'st_Y');
  });

  it('returns documented error when API not supported', async () => {
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dataSources') && !expr.includes('setActiveStudy')) {
        return [{ id: 'st_X', name: 'RSI', is_strategy: true }];
      }
      return 'no_api';
    };
    const r = await setActive({ entity_id: 'st_X', _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, false);
    assert.match(r.error, /not supported in this TV version/i);
  });

  it('errors when entity_id not on chart', async () => {
    const fakeEvaluate = async () => [{ id: 'st_X', name: 'RSI', is_strategy: true }];
    const r = await setActive({ entity_id: 'st_BOGUS', _deps: { evaluate: fakeEvaluate, getChartApi: async () => 'x' } });
    assert.equal(r.success, false);
    assert.match(r.error, /No strategy on chart|not found/i);
  });
});
```

- [ ] **Step 2: Implement**

Append to `src/core/strategy.js`:

```javascript
/**
 * Set which strategy the Strategy Tester displays (when chart has multiple).
 * TradingView's API for this is uncertain — we try a few candidates and report
 * `not supported` if none work.
 */
export async function setActive({ entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };
  if (entity_id && strat.entity_id !== entity_id) {
    return { success: false, error: `Strategy ${entity_id} not found on chart.` };
  }

  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      try {
        var api = ${apiPath};
        var widget = api._chartWidget;
        var id = ${safeString(strat.entity_id)};
        // Candidate APIs in order
        if (typeof api.setActiveStudy === 'function') { api.setActiveStudy(id); return 'ok'; }
        if (widget && typeof widget.setActiveStudy === 'function') { widget.setActiveStudy(id); return 'ok'; }
        var model = widget && widget.model();
        if (model && typeof model.setActiveStudy === 'function') { model.setActiveStudy(id); return 'ok'; }
        return 'no_api';
      } catch(e) { return 'no_api'; }
    })()
  `);

  if (result === 'ok') {
    return { success: true, active_entity_id: strat.entity_id };
  }
  return {
    success: false,
    error: 'Active-strategy selection not supported in this TV version. Tester shows the most recent strategy automatically.',
  };
}
```

- [ ] **Step 3: Run + commit**

```bash
node --test tests/strategy.test.js
git add src/core/strategy.js tests/strategy.test.js
git commit -m "feat(core): setActive with graceful 'not supported' fallback"
```
Expected: 24 cases pass.

---

## Phase 5 — Wire-up

### Task 5.1: Create `src/tools/strategy.js`

**Files:**
- Create: `src/tools/strategy.js`

- [ ] **Step 1: Create file**

```javascript
import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/strategy.js';

const SettingsSchema = z.object({
  initial_capital:   z.number().min(0).optional(),
  default_qty_type:  z.enum(['fixed', 'percent_of_equity', 'cash']).optional(),
  default_qty_value: z.number().min(0).optional(),
  commission_type:   z.enum(['percent', 'cash_per_order', 'cash_per_contract']).optional(),
  commission_value:  z.number().min(0).optional(),
  slippage:          z.coerce.number().int().min(0).optional(),
  pyramiding:        z.coerce.number().int().min(0).optional(),
  margin_long:       z.number().min(0).max(100).optional(),
  margin_short:      z.number().min(0).max(100).optional(),
}).strict();

export function registerStrategyTools(server) {
  server.tool('strategy_list',
    'List all strategies currently on the chart. Returns [{entity_id, name}, ...].',
    {},
    async () => {
      try {
        const list = await core.findStrategies();
        return jsonResult({ success: true, count: list.length, strategies: list });
      } catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_get_settings',
    'Read all canonical settings (initial_capital, commission, pyramiding, etc.) for a strategy.',
    { entity_id: z.string().optional() },
    async ({ entity_id }) => {
      try { return jsonResult(await core.getSettings({ entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_set_settings',
    'Update strategy settings (partial). Settings keys: initial_capital, commission_type/value, slippage, pyramiding, margin_long/short, default_qty_type/value.',
    {
      entity_id: z.string().optional(),
      settings:  SettingsSchema,
    },
    async ({ entity_id, settings }) => {
      try { return jsonResult(await core.setSettings({ entity_id, settings })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_deep_backtest_toggle',
    'Toggle Deep Backtest mode (Premium/Ultimate feature) on the active strategy.',
    {
      enable:    z.coerce.boolean().default(true),
      entity_id: z.string().optional(),
    },
    async ({ enable, entity_id }) => {
      try { return jsonResult(await core.deepBacktestToggle({ enable, entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_get_performance_summary',
    'Read Performance Summary tab metrics (net profit, drawdown, total trades, percent profitable).',
    { entity_id: z.string().optional() },
    async ({ entity_id }) => {
      try { return jsonResult(await core.getPerformanceSummary({ entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_get_trades_analysis',
    'Read Trades Analysis tab metrics (avg win/loss, max consecutive wins/losses, avg bars in trade).',
    { entity_id: z.string().optional() },
    async ({ entity_id }) => {
      try { return jsonResult(await core.getTradesAnalysis({ entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_get_risk_ratios',
    'Read Risk-Performance Ratios tab (Sharpe, Sortino, Profit Factor, Calmar, Recovery Factor).',
    { entity_id: z.string().optional() },
    async ({ entity_id }) => {
      try { return jsonResult(await core.getRiskRatios({ entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_set_active',
    'Choose which strategy the Strategy Tester displays (when multiple are on chart).',
    { entity_id: z.string() },
    async ({ entity_id }) => {
      try { return jsonResult(await core.setActive({ entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });
}
```

- [ ] **Step 2: Verify import**

```bash
node -e "import('./src/tools/strategy.js').then(m => console.log('exports:', Object.keys(m)))"
```
Expected: `exports: [ 'registerStrategyTools' ]`.

- [ ] **Step 3: Commit**

```bash
git add src/tools/strategy.js
git commit -m "feat(tools): register 8 strategy MCP tools"
```

### Task 5.2: Wire `registerStrategyTools` into `src/server.js`

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add import + registration**

After existing tool imports (after `import { registerTickTools } from './tools/ticks.js';`), add:
```javascript
import { registerStrategyTools } from './tools/strategy.js';
```

After `registerTickTools(server);`, add:
```javascript
registerStrategyTools(server);
```

- [ ] **Step 2: Bump tool count in instructions**

Find `89 tools` in the instructions template literal and replace with `97 tools`.

After the line about `data_get_ticks`, add:
```
- strategy_list / strategy_get_settings / strategy_set_settings → manage strategy properties
- strategy_get_performance_summary / strategy_get_trades_analysis / strategy_get_risk_ratios → read all 3 Strategy Tester tabs
- strategy_deep_backtest_toggle / strategy_set_active → premium toggles
```

- [ ] **Step 3: Smoke test boot**

```bash
node -e "import('./src/server.js').then(() => { console.log('server boot ok'); setTimeout(() => process.exit(0), 100); }).catch(e => { console.error(e.message); process.exit(1); });"
```
Expected: `server boot ok`.

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat(server): register strategy tools (count 89 -> 97)"
```

### Task 5.3: Create `src/cli/commands/strategy.js`

**Files:**
- Create: `src/cli/commands/strategy.js`

- [ ] **Step 1: Create file**

```javascript
import { register } from '../router.js';
import * as core from '../../core/strategy.js';

register('strategy', {
  description: 'Strategy Tester: list, settings, performance tabs, deep backtest',
  subcommands: new Map([
    ['list', {
      description: 'List strategies on chart',
      handler: async () => {
        const list = await core.findStrategies();
        return { success: true, count: list.length, strategies: list };
      },
    }],
    ['get-settings', {
      description: 'Read strategy settings',
      options: { entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id (default: first)' } },
      handler: (opts) => core.getSettings({ entity_id: opts.entity_id }),
    }],
    ['set-settings', {
      description: 'Update strategy settings (JSON via --settings)',
      options: {
        entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id' },
        settings:  { type: 'string', short: 's', description: 'JSON object of settings to apply' },
      },
      handler: (opts) => {
        if (!opts.settings) throw new Error('--settings <JSON> is required');
        return core.setSettings({ entity_id: opts.entity_id, settings: JSON.parse(opts.settings) });
      },
    }],
    ['deep-backtest', {
      description: 'Toggle Deep Backtest (--enable=true|false)',
      options: {
        enable:    { type: 'string', description: 'true | false' },
        entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id' },
      },
      handler: (opts) => core.deepBacktestToggle({
        enable: opts.enable !== 'false',
        entity_id: opts.entity_id,
      }),
    }],
    ['performance', {
      description: 'Read Performance Summary tab',
      options: { entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id' } },
      handler: (opts) => core.getPerformanceSummary({ entity_id: opts.entity_id }),
    }],
    ['trades-analysis', {
      description: 'Read Trades Analysis tab',
      options: { entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id' } },
      handler: (opts) => core.getTradesAnalysis({ entity_id: opts.entity_id }),
    }],
    ['risk-ratios', {
      description: 'Read Risk-Performance Ratios tab',
      options: { entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id' } },
      handler: (opts) => core.getRiskRatios({ entity_id: opts.entity_id }),
    }],
    ['set-active', {
      description: 'Set active strategy (multi-strategy charts)',
      handler: (opts, positionals) => core.setActive({ entity_id: positionals[0] }),
    }],
  ]),
});
```

- [ ] **Step 2: Verify import**

```bash
node -e "import('./src/cli/commands/strategy.js').then(() => console.log('cli strategy ok'))"
```
Expected: `cli strategy ok`.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/strategy.js
git commit -m "feat(cli): tv strategy subcommands (list, get/set settings, performance tabs, deep BT, set-active)"
```

### Task 5.4: Wire CLI in `src/cli/index.js`

**Files:**
- Modify: `src/cli/index.js`

- [ ] **Step 1: Add import**

After `import './commands/ticks.js';`, add:
```javascript
import './commands/strategy.js';
```

- [ ] **Step 2: Update count comment**

Find `* All 89 MCP tools` and change to `* All 97 MCP tools`.

- [ ] **Step 3: Smoke test**

```bash
node src/cli/index.js --help 2>&1 | grep -i strategy
```
Expected: a line including `strategy` and the description.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.js
git commit -m "feat(cli): wire strategy command group (count 89 -> 97)"
```

### Task 5.5: Update `package.json` test scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Append `tests/strategy.test.js` to test scripts**

Find each of `"test"`, `"test:all"`, `"test:unit"` scripts and append `tests/strategy.test.js` to their command lists.

- [ ] **Step 2: Run unit tests**

```bash
npm run test:unit
```
Expected: previous count + 24 new strategy tests, all passing. Pre-existing 2 CDP-dependent failures still expected.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: include strategy.test in npm test scripts"
```

---

## Phase 6 — Documentation

### Task 6.1: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Bump count**

Find `## Tool Reference (89 MCP tools)` → `## Tool Reference (97 MCP tools)`. Find `MCP over stdio (89 tools)` → `MCP over stdio (97 tools)`.

- [ ] **Step 2: Add Strategy Tester subsection**

After "### Tick Data (Premium / Ultimate)" subsection, INSERT:

```markdown
### Strategy Tester (deep control)

| Tool | What it does |
|------|-------------|
| `strategy_list` | List strategies on chart `[{entity_id, name}]` |
| `strategy_get_settings` / `strategy_set_settings` | Read/write strategy properties (capital, commission, slippage, pyramiding, margin) |
| `strategy_deep_backtest_toggle` | Toggle Deep Backtest mode (Premium/Ultimate) |
| `strategy_get_performance_summary` | Performance tab metrics (net profit, drawdown, win rate) |
| `strategy_get_trades_analysis` | Trades Analysis tab (avg win/loss, max consec wins, etc.) |
| `strategy_get_risk_ratios` | Risk Ratios (Sharpe, Sortino, Profit Factor, Calmar) |
| `strategy_set_active` | Pick active strategy when multiple on chart |
```

- [ ] **Step 3: Add decision-tree rows**

In the "How Claude Knows Which Tool to Use" table, append:

```markdown
| "What strategies are on the chart?" | `strategy_list` |
| "Set commission to 0.1% and re-run" | `strategy_set_settings` → `strategy_get_performance_summary` |
| "What's my Sharpe ratio?" | `strategy_get_risk_ratios` |
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): document 8 strategy tester tools (97 total)"
```

### Task 6.2: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Bump count**

Find any `89 tools` references → `97 tools`.

- [ ] **Step 2: Add Strategy Tester decision-tree section**

After the "Deep history backtest data" subsection, INSERT:

```markdown
### "Manage / read strategy backtest"

**Discover:**
- `strategy_list` → returns `[{entity_id, name}]` for every strategy on chart

**Read:**
- `strategy_get_settings` → current settings (capital, commission, slippage, pyramiding)
- `strategy_get_performance_summary` → net profit, drawdown, win rate
- `strategy_get_trades_analysis` → avg win/loss, max consecutive wins
- `strategy_get_risk_ratios` → Sharpe, Sortino, Profit Factor

**Tune:**
- `strategy_set_settings { settings: { commission_value: 0.1 } }` → partial update
- `strategy_deep_backtest_toggle { enable: true }` → Premium feature, more accurate per-bar backtest
- `strategy_set_active { entity_id }` → pick active strategy on multi-strategy chart

**Pre-condition:** A Pine strategy must be on chart. If `strategy_list` returns empty, instruct the user to add one (Indicators → Built-ins → Strategies).
```

- [ ] **Step 3: Add output sizes**

Append to the "Output Size Estimates" table:

```markdown
| `strategy_list` | ~200 B per strategy |
| `strategy_get_settings` | ~500 B (incl. raw_property_keys) |
| `strategy_get_performance_summary` / `_trades_analysis` / `_risk_ratios` | ~500 B each |
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): strategy tester deep control decision tree"
```

---

## Phase 7 — Live smoke + canonical mapping finalization

### [CONTROLLER] Task 7.1: Live probe finalization

**Files:**
- Modify: `src/core/strategy.js` (replace `// PROBE-PENDING` constants)

After Phases 1-6 complete, controller runs the probe (Task 0.1) on a real strategy and updates the canonical mapping constants:
- `CANONICAL_TO_TV_PATH` — settings tree property paths
- `REPORT_FIELD_MAP` — Performance Summary fields
- `TRADES_FIELD_MAP` — Trades Analysis fields
- `RISK_FIELD_MAP` — Risk Ratios fields

- [ ] **Step 1: Operator runs probes from Task 0.1 if not yet done**

- [ ] **Step 2: Operator updates each `PROBE-PENDING` constant in `src/core/strategy.js`**

Replace the right-hand-side strings with discovered TV field names. Remove `// PROBE-PENDING` comments from the lines that were updated; leave the comment on lines whose canonical setting could not be located in this TV version (those become `null` and are safely skipped).

- [ ] **Step 3: Re-run unit tests**

```bash
node --test tests/strategy.test.js
```
Expected: 24/24 still pass (unit tests use injected `_deps`, not real TV).

- [ ] **Step 4: Commit**

```bash
git add src/core/strategy.js
git commit -m "fix(strategy): replace probe-pending field names with live-probe values"
```

### [CONTROLLER] Task 7.2: Live smoke against TradingView Desktop

**Files:** none (tests only)

- [ ] **Step 1: Operator confirms strategy on chart**

If not, add a built-in strategy via TV's Indicators dialog. Then:

```bash
node src/cli/index.js strategy list
```
Expected: at least one strategy returned.

- [ ] **Step 2: Settings roundtrip**

```bash
node src/cli/index.js strategy get-settings
node src/cli/index.js strategy set-settings -s '{"commission_value": 0.1}'
node src/cli/index.js strategy get-settings   # verify commission_value is now 0.1
```

- [ ] **Step 3: Performance tabs**

```bash
node src/cli/index.js strategy performance
node src/cli/index.js strategy trades-analysis
node src/cli/index.js strategy risk-ratios
```
Expected: each returns `{success:true, metrics: {...}}` with at least the canonical fields populated.

- [ ] **Step 4: Deep Backtest toggle**

```bash
node src/cli/index.js strategy deep-backtest --enable true
```
Expected: either `{success:true, enabled:true}` or the documented `{success:false, error:"Deep Backtest property not found..."}`. Document which.

- [ ] **Step 5: set-active (if multiple strategies)**

```bash
node src/cli/index.js strategy set-active <entity_id>
```
Expected: success or the documented `not supported` error. Document.

- [ ] **Step 6: Capture results**

If any tool fails unexpectedly, controller dispatches a fix subagent (or makes a small inline fix) referencing the symptom and the relevant Task above.

### Task 7.3: Final acceptance walkthrough

**Files:** none

- [ ] **Step 1: Verify spec section 11 acceptance criteria**

```bash
# 1. strategy_list returns at least one strategy
node src/cli/index.js strategy list

# 2-7. settings roundtrip + performance tabs + deep BT + set-active (Task 7.2)

# 8. existing 89 tools still work
npm run test:unit

# 9. README count
grep "Tool Reference (97 MCP tools)" README.md

# 10. CLAUDE.md decision tree includes new sections
grep -i "Manage / read strategy backtest" CLAUDE.md
```

- [ ] **Step 2: Final tweak commits if needed**

### Task 7.4: Merge to master

**Files:** none

- [ ] **Step 1: Verify clean tree**

```bash
git status
```

- [ ] **Step 2: Merge**

```bash
git checkout master
git merge epic3a-strategy-tester --ff-only
```

- [ ] **Step 3: Delete branch**

```bash
git branch -d epic3a-strategy-tester
```

---

## Risks and rollback

| Risk | Mitigation |
|---|---|
| TV strategy property names differ wildly from canonical guesses | `parseSettingsTree` returns `raw_property_keys` for debug; controller updates `CANONICAL_TO_TV_PATH` from probe |
| `reportData()` shape varies across TV versions | Each `extract*` function uses `_coerceFromMap`; missing fields are silently omitted (no zero-fill) |
| Deep Backtest property is UI-only (like Bar Magnifier) | `deepBacktestToggle` returns documented error; doc'd in CLAUDE.md fallback |
| `setActive` API doesn't exist in this TV version | 3 candidate paths tried; clear error returned if all fail |
| User removes strategy mid-call | All tools call `findStrategyById` first; null result → clear error |

To roll back the entire epic:
```bash
git checkout master
git branch -D epic3a-strategy-tester
```

---

## Self-review

**Spec coverage:**
- [x] §6.1 strategy_list — Task 1.1
- [x] §6.2 strategy_get_settings — Task 2.1
- [x] §6.3 strategy_set_settings — Task 2.2
- [x] §6.4 strategy_deep_backtest_toggle — Task 4.1
- [x] §6.5 strategy_get_performance_summary — Task 3.1
- [x] §6.6 strategy_get_trades_analysis — Task 3.2
- [x] §6.7 strategy_get_risk_ratios — Task 3.3
- [x] §6.8 strategy_set_active — Task 4.2
- [x] §8 error handling — covered by per-task tests
- [x] §10 OQ1 (property names) — Task 0.1 + Task 7.1 controller probe
- [x] §10 OQ2 (performance source structure) — Task 0.1 + Task 7.1
- [x] §10 OQ3 (deep BT path) — Task 4.1 with property-tree walk + clear error
- [x] §10 OQ4 (set_active API) — Task 4.2 with 3-candidate try + documented fallback
- [x] §11 acceptance criteria — Task 7.3 walkthrough

**Placeholder scan:** `// PROBE-PENDING` markers exist intentionally on the canonical mapping constants (CANONICAL_TO_TV_PATH, REPORT_FIELD_MAP, TRADES_FIELD_MAP, RISK_FIELD_MAP). Controller updates them in Task 7.1. All other steps contain complete, executable code.

**Type consistency:**
- `findStrategyById(entity_id, { _deps })` — same signature in Tasks 1.1, 2.1, 2.2, 3.x, 4.x
- `_resolve(deps)` shape: `{evaluate, getChartApi}` — never extended (no `setInputs`/`manageIndicator` needed)
- All `get*` core functions return `{success, entity_id, metrics}` shape
- All `set*` core functions return `{success, entity_id, applied/enabled, ...}` shape
- 24 unit tests across 1 file (`tests/strategy.test.js`)
