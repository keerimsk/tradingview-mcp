# Epic #2 — Custom Intervals + Extended Data + Ticks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-05-10-epic2-intervals-data-design.md](../specs/2026-05-10-epic2-intervals-data-design.md)

**Goal:** Extend `chart_set_timeframe` to accept second-based resolutions ("1S", "5S", "30S"), raise `data_get_ohlcv` cap from 500 to 40000 bars with transparent history loading, and add `data_get_ticks` reading TradingView's Time & Sales panel.

**Architecture:** Extend two existing core modules (`chart.js` setTimeframe validation, `data.js` getOhlcv lazy-load) and add one new module pair (`core/ticks.js` + `tools/ticks.js` + `cli/commands/ticks.js`) for tick reads. All work uses existing CDP infrastructure — no new dependencies.

**Tech Stack:** Node.js 18+ (ESM), `@modelcontextprotocol/sdk` ^1.12.1, `chrome-remote-interface` ^0.33.2, `node:test`, `zod`. Same patterns as Epic #1: `_resolve(deps)` for testability, `jsonResult()` for MCP wrap, CLI via `register()`.

**Repo conventions** (already established by Epic #1):
- `src/core/<module>.js` — pure CDP business logic, exports async functions, `_deps` for tests
- `src/tools/<module>.js` — MCP tool registrations
- `src/cli/commands/<module>.js` — CLI mirrors via `cli/router.js`
- `src/server.js` registers tools, `src/cli/index.js` registers CLI commands
- Connection helpers in `src/connection.js`: `evaluate`, `getChartApi`, `safeString`, `KNOWN_PATHS`

**Discovery dependencies (controller-driven, not subagent):**
Three TradingView internal APIs cannot be probed without a live TV instance. The controller (you, the operator) handles probes. Subagents skip probe steps and use placeholders that the controller fills in afterward. Marked as `[CONTROLLER PROBE]` in tasks.

---

## Phase 0 — Branch setup

### Task 0.0: Create feature branch

**Files:** none (git only)

- [ ] **Step 1: Verify on master with clean tree**

```bash
cd c:/Users/Kerim/Desktop/tradingview-mcp
git status
git branch --show-current
```
Expected: `master`, working tree clean.

- [ ] **Step 2: Create branch**

```bash
git checkout -b epic2-intervals-data
```
Expected: `Switched to a new branch 'epic2-intervals-data'`.

---

## Phase 1 — `chart_set_timeframe` extend (TDD)

### Task 1.1: Add timeframe regex validation + post-call verification

**Files:**
- Modify: `src/core/chart.js` (function `setTimeframe`, ~line 55)
- Test: `tests/intervals.test.js` (NEW)

- [ ] **Step 1: Write failing test for regex validation**

Create `tests/intervals.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeframe } from '../src/core/chart.js';

describe('setTimeframe — regex validation', () => {
  const fakeDeps = {
    evaluate: async () => null,
    waitForChartReady: async () => true,
    getInterval: async () => '1S',
  };

  it('accepts second-based resolutions', async () => {
    for (const tf of ['1S', '5S', '30S']) {
      const r = await setTimeframe({ timeframe: tf, _deps: { ...fakeDeps, getInterval: async () => tf } });
      assert.equal(r.success, true);
      assert.equal(r.timeframe, tf);
    }
  });

  it('accepts minute resolutions', async () => {
    for (const tf of ['1', '5', '15', '60', '240']) {
      const r = await setTimeframe({ timeframe: tf, _deps: { ...fakeDeps, getInterval: async () => tf } });
      assert.equal(r.success, true);
    }
  });

  it('accepts D/W/M', async () => {
    for (const tf of ['D', 'W', 'M']) {
      const r = await setTimeframe({ timeframe: tf, _deps: { ...fakeDeps, getInterval: async () => tf } });
      assert.equal(r.success, true);
    }
  });

  it('rejects invalid formats', async () => {
    for (const bad of ['1.5', 'X', '', '5x', '1H', '1m']) {
      await assert.rejects(
        () => setTimeframe({ timeframe: bad, _deps: fakeDeps }),
        /invalid timeframe/i,
        `expected reject for "${bad}"`,
      );
    }
  });

  it('returns post-call verification mismatch error', async () => {
    const deps = {
      evaluate: async () => null,
      waitForChartReady: async () => true,
      getInterval: async () => '15', // TV silently kept old
    };
    const r = await setTimeframe({ timeframe: '1S', _deps: deps });
    assert.equal(r.success, false);
    assert.match(r.error, /does not support/i);
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

```bash
node --test tests/intervals.test.js
```
Expected: tests fail because (a) current `setTimeframe` has no regex check, (b) `getInterval` is not in `_resolve`.

- [ ] **Step 3: Modify `src/core/chart.js`**

In `_resolve(deps)` near top of file (find the existing `_resolve` function and add `getInterval` resolver). Then update `setTimeframe`:

Find:
```javascript
export async function setTimeframe({ timeframe, _deps }) {
  const { evaluate, waitForChartReady } = _resolve(_deps);
  await evaluate(`
    (function() {
      var chart = ${CHART_API};
      chart.setResolution(${safeString(timeframe)}, {});
    })()
  `);
  const ready = await waitForChartReady(null, timeframe);
  return { success: true, timeframe, chart_ready: ready };
}
```

Replace with:
```javascript
const TIMEFRAME_REGEX = /^(\d+S|\d+|D|W|M)$/;

export async function setTimeframe({ timeframe, _deps }) {
  const { evaluate, waitForChartReady, getInterval } = _resolve(_deps);
  if (typeof timeframe !== 'string' || !TIMEFRAME_REGEX.test(timeframe)) {
    throw new Error(`Invalid timeframe "${timeframe}". Use e.g. "1S", "5S", "1", "15", "60", "D", "W", "M".`);
  }
  await evaluate(`
    (function() {
      var chart = ${CHART_API};
      chart.setResolution(${safeString(timeframe)}, {});
    })()
  `);
  const ready = await waitForChartReady(null, timeframe);
  // Post-call verification — TV silently keeps old resolution if symbol does not support it.
  const actual = await getInterval();
  if (actual && actual !== timeframe) {
    return {
      success: false,
      requested: timeframe,
      actual,
      chart_ready: ready,
      error: `Symbol does not support ${timeframe} resolution. TV kept ${actual}. Try a higher timeframe.`,
    };
  }
  return { success: true, timeframe, chart_ready: ready };
}
```

Then in `_resolve`, add `getInterval` (find the `_resolve` block, look like ~line 10-15 in chart.js):
```javascript
function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    getChartApi: deps?.getChartApi || _getChartApi,
    waitForChartReady: deps?.waitForChartReady || _waitForChartReady,
    getInterval: deps?.getInterval || (async () => {
      try {
        return await _evaluate(`${CHART_API}._chartWidget.model().model().mainSeries().interval()`);
      } catch { return null; }
    }),
  };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
node --test tests/intervals.test.js
```
Expected: all 5 cases pass.

- [ ] **Step 5: Verify no regressions in existing tests**

```bash
node --test tests/premium_chart.test.js
```
Expected: 25/25 pass (Epic #1 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/chart.js tests/intervals.test.js
git commit -m "feat(chart): accept second-based resolutions in setTimeframe + post-call verify"
```

---

## Phase 2 — `data_get_ohlcv` 40k extend (TDD)

### Task 2.1: Raise `MAX_OHLCV_BARS` cap to 40000

**Files:**
- Modify: `src/core/data.js` (constant near top)

- [ ] **Step 1: Inline change**

In `src/core/data.js`, find:
```javascript
const MAX_OHLCV_BARS = 500;
```
Replace with:
```javascript
const MAX_OHLCV_BARS = 40000;
```

- [ ] **Step 2: Update tool schema upper bound**

Find `src/tools/data.js`. Locate the `data_get_ohlcv` registration with `count` zod schema. The current schema likely has `.max(500)` or no cap. Update to `.max(40000)`. Read the file first to find the exact location:

```bash
node -e "import('node:fs/promises').then(fs => fs.readFile('src/tools/data.js','utf-8')).then(s => { const idx = s.indexOf('data_get_ohlcv'); console.log(s.substring(idx, idx + 800)); })"
```

If the schema has `.max(500)` or `.max(N)` for `count`, change to `.max(40000)`. If there is no `.max()`, leave alone (zod accepts unbounded by default).

- [ ] **Step 3: Verify existing tests still pass**

```bash
node --test tests/premium_chart.test.js tests/intervals.test.js
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/data.js src/tools/data.js
git commit -m "feat(data): raise MAX_OHLCV_BARS from 500 to 40000"
```

### Task 2.2: Add `_loadHistoryUntil` helper + integrate into `getOhlcv`

**Files:**
- Modify: `src/core/data.js` (add helper, modify `getOhlcv`)
- Test: `tests/data_ohlcv.test.js` (NEW)

- [ ] **Step 1: Write failing tests**

Create `tests/data_ohlcv.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test, confirm fails**

```bash
node --test tests/data_ohlcv.test.js
```
Expected: FAIL — `_loadHistoryUntil` not exported.

- [ ] **Step 3: Add `_loadHistoryUntil` to `src/core/data.js`**

Append to `src/core/data.js` (after `getOhlcv`):

```javascript
const HISTORY_LOAD_TIMEOUT_MS = 30_000;
const HISTORY_POLL_INTERVAL_MS = 500;

/**
 * Best-effort: ask TradingView to load enough history so bars().size() >= target.
 * Polls until reached or timeout. Returns { reached, final }.
 *
 * Implementation note: TradingView's history-loading API is not stable across
 * versions. We try several known entry points (mainSeries.requestMoreBars,
 * chart.scroll, navigation API). If none work, this becomes a no-op poll that
 * returns whatever bars are currently loaded.
 *
 * @param {number} target — desired bar count
 * @param {object} opts
 * @param {object} [opts._deps] — for tests
 */
export async function _loadHistoryUntil(target, { _deps } = {}) {
  const getBarCount = _deps?.getBarCount || (async () => {
    try {
      return await evaluate(`(function(){ var b = ${BARS_PATH}; return b && typeof b.size === 'function' ? b.size() : 0; })()`);
    } catch { return 0; }
  });
  const requestMore = _deps?.requestMore || (async () => {
    try {
      await evaluate(`
        (function() {
          var ms = ${CHART_API}._chartWidget.model().mainSeries();
          // Try known APIs in order; first one that works wins.
          if (ms && typeof ms.requestMoreBars === 'function') { ms.requestMoreBars(); return 1; }
          if (ms && typeof ms.requestMoreData === 'function') { ms.requestMoreData(); return 2; }
          var chart = ${CHART_API}._chartWidget;
          if (chart && typeof chart.requestMoreData === 'function') { chart.requestMoreData(); return 3; }
          return 0;
        })()
      `);
    } catch { /* swallow — best-effort */ }
  });
  const timeoutMs = _deps?.timeoutMs ?? HISTORY_LOAD_TIMEOUT_MS;
  const pollIntervalMs = _deps?.pollIntervalMs ?? HISTORY_POLL_INTERVAL_MS;

  let final = await getBarCount();
  if (final >= target) return { reached: true, final };

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await requestMore();
    await new Promise(r => setTimeout(r, pollIntervalMs));
    final = await getBarCount();
    if (final >= target) return { reached: true, final };
  }
  return { reached: false, final };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
node --test tests/data_ohlcv.test.js
```
Expected: 3 cases pass.

- [ ] **Step 5: Integrate `_loadHistoryUntil` into `getOhlcv`**

In `src/core/data.js`, modify `getOhlcv`:

Find:
```javascript
export async function getOhlcv({ count, summary } = {}) {
  const limit = Math.min(count || 100, MAX_OHLCV_BARS);
  let data;
  try {
    data = await evaluate(`
      (function() {
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') return null;
        var result = [];
        var end = bars.lastIndex();
        var start = Math.max(bars.firstIndex(), end - ${limit} + 1);
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (v) result.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
        }
        return {bars: result, total_bars: bars.size(), source: 'direct_bars'};
      })()
    `);
  } catch { data = null; }

  if (!data || !data.bars || data.bars.length === 0) {
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }
```

Replace with:
```javascript
export async function getOhlcv({ count, summary } = {}) {
  const limit = Math.min(count || 100, MAX_OHLCV_BARS);

  // If requested count exceeds current chart cache, load more history first.
  let partial = false;
  if (limit > 500) {
    try {
      const currentSize = await evaluate(`(function(){ var b = ${BARS_PATH}; return b && typeof b.size === 'function' ? b.size() : 0; })()`);
      if (currentSize < limit) {
        const loadResult = await _loadHistoryUntil(limit);
        if (!loadResult.reached) partial = true;
      }
    } catch { /* fall through — read whatever's available */ }
  }

  let data;
  try {
    data = await evaluate(`
      (function() {
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') return null;
        var result = [];
        var end = bars.lastIndex();
        var start = Math.max(bars.firstIndex(), end - ${limit} + 1);
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (v) result.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
        }
        return {bars: result, total_bars: bars.size(), source: 'direct_bars'};
      })()
    `);
  } catch { data = null; }

  if (!data || !data.bars || data.bars.length === 0) {
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }
```

Then find the final `return` of `getOhlcv` (the non-summary path) and add `partial` field:

Find:
```javascript
  return { success: true, bar_count: data.bars.length, total_available: data.total_bars, source: data.source, bars: data.bars };
}
```

Replace with:
```javascript
  const out = { success: true, bar_count: data.bars.length, total_available: data.total_bars, source: data.source, bars: data.bars };
  if (partial) {
    out.partial = true;
    out.requested = limit;
    out.returned = data.bars.length;
  }
  return out;
}
```

(The `summary: true` branch ignores partial — that's intentional; summaries are aggregates and don't need a partial flag.)

- [ ] **Step 6: Run tests**

```bash
node --test tests/data_ohlcv.test.js tests/intervals.test.js tests/premium_chart.test.js
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/core/data.js tests/data_ohlcv.test.js
git commit -m "feat(data): _loadHistoryUntil polls TV history API; getOhlcv loads up to 40k bars"
```

---

## Phase 3 — `data_get_ticks` (Time & Sales)

### [CONTROLLER PROBE] Task 3.0: Discover Time & Sales DOM structure

**Files:** none (probe only)

**This task is performed by the controller (operator), not a subagent. Subagent tasks 3.1+ assume the discovered selectors. Update placeholders in 3.1 from this probe's output.**

- [ ] **Step 1: Operator opens TradingView, opens Time & Sales panel manually**

Click the Time & Sales icon in the right sidebar (bid/ask/last symbol).

- [ ] **Step 2: Operator runs CDP probe**

```bash
cd c:/Users/Kerim/Desktop/tradingview-mcp
node src/cli/index.js ui eval "
(function() {
  // Probe: find any panel/widget likely to be Time & Sales
  var candidates = [];
  // Look for elements with 'time-sales', 'sales', 'tape', 'trades' keywords in id/class/aria
  var all = document.querySelectorAll('div[class*=\"time\" i], div[class*=\"sales\" i], div[class*=\"tape\" i], div[class*=\"trades\" i], [data-name*=\"sales\" i], [aria-label*=\"sales\" i]');
  for (var i = 0; i < Math.min(all.length, 20); i++) {
    var el = all[i];
    candidates.push({
      tag: el.tagName,
      id: el.id || null,
      cls: (el.className || '').toString().substring(0, 100),
      aria: el.getAttribute('aria-label') || null,
      data_name: el.getAttribute('data-name') || null,
      text_sample: (el.textContent || '').substring(0, 80),
    });
  }
  return candidates;
})()
"
```

- [ ] **Step 3: Operator records selectors**

From the probe output, identify:
1. **Panel root selector** (e.g., `[data-name=\"time-sales\"]` or `.tv-time-sales-panel`)
2. **Row selector** (e.g., `.tv-time-sales-row` — children of root)
3. **Column accessors per row**: time field, price field, size field, side indicator

If panel was not found, the operator may need to manually right-click a chart and select "Time & Sales" — the panel name in TradingView Desktop varies. Document the discovered values in the implementation comment of `src/core/ticks.js` (Task 3.2).

- [ ] **Step 4: Record findings as constants**

Operator updates the placeholder values in Task 3.2's code with discovered selectors. If the probe yields no usable selectors, mark `data_get_ticks` as deferred and skip Phase 3, then move to Phase 4.

### Task 3.1: Add MCP tool registration scaffold

**Files:**
- Create: `src/tools/ticks.js`

- [ ] **Step 1: Create the tool registration**

```javascript
import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/ticks.js';

export function registerTickTools(server) {
  server.tool('data_get_ticks',
    'Read recent tick prints from TradingView\'s Time & Sales panel. Returns last N ticks with price, size, side, time.',
    {
      limit: z.coerce.number().int().min(1).max(500).default(50).describe('Maximum ticks to return (1-500)'),
      since: z.string().optional().describe('ISO timestamp filter — only return ticks at or after this time'),
    },
    async ({ limit, since }) => {
      try { return jsonResult(await core.getTicks({ limit, since })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });
}
```

- [ ] **Step 2: Verify import shape (will fail until ticks.js exists)**

```bash
node -e "import('./src/tools/ticks.js').then(m => console.log('exports:', Object.keys(m))).catch(e => console.log('expected fail:', e.message))"
```
Expected: error mentioning `core/ticks.js` not found. That's fine — Task 3.2 creates it.

- [ ] **Step 3: Commit (incomplete — fails to import until Task 3.2)**

Defer commit; bundle with Task 3.2 commit.

### Task 3.2: Create `src/core/ticks.js` with parser + Time & Sales reader (TDD)

**Files:**
- Create: `src/core/ticks.js`
- Test: `tests/ticks.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/ticks.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test, confirm fails**

```bash
node --test tests/ticks.test.js
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/core/ticks.js`**

```javascript
/**
 * Read recent tick prints from TradingView's Time & Sales panel.
 *
 * IMPORTANT — selectors below are placeholders. The controller must replace
 * them with values discovered from a live probe (see plan Task 3.0). If the
 * panel selector does not match in production, getTicks returns a clear error
 * directing the user to open Time & Sales manually.
 */
import {
  evaluate as _evaluate,
  getChartApi as _getChartApi,
} from '../connection.js';

// CONTROLLER: replace these placeholders with values from Task 3.0 probe.
const PANEL_ROOT_SELECTOR = '[data-name="time-sales"]'; // PROBE-PENDING
const ROW_SELECTOR        = '.time-sales-row';          // PROBE-PENDING
const FIELD_TIME_SEL      = '.cell-time';               // PROBE-PENDING
const FIELD_PRICE_SEL     = '.cell-price';              // PROBE-PENDING
const FIELD_SIZE_SEL      = '.cell-size';               // PROBE-PENDING
const FIELD_SIDE_SEL      = '.cell-side';               // PROBE-PENDING (may be absent; fall back to row-level color class)

/**
 * Convert a raw row object {time, price, size, side?, sideClass?} into a structured tick.
 * Returns null if the row is malformed.
 */
export function parseTickRow(row, sessionDateMs) {
  if (!row || row.price == null) return null;
  const price = Number(row.price);
  if (!Number.isFinite(price)) return null;
  const size = Number(row.size);
  // Time field is "HH:MM:SS" or "HH:MM:SS.sss" relative to today's session.
  let timeIso = null;
  if (row.time) {
    const m = String(row.time).match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (m) {
      const ms = sessionDateMs + (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + (Number(m[4] || 0));
      timeIso = new Date(ms).toISOString();
    }
  }
  // Side: explicit > inferred from color class.
  let side = null;
  if (row.side === 'buy' || row.side === 'sell') side = row.side;
  else if (row.sideClass) {
    if (/buy|up|green/i.test(row.sideClass)) side = 'buy';
    else if (/sell|down|red/i.test(row.sideClass)) side = 'sell';
  }
  return {
    time: timeIso,
    price,
    size: Number.isFinite(size) ? size : null,
    side,
  };
}

function _resolve(deps) {
  return {
    evaluate:        deps?.evaluate        || _evaluate,
    getChartApi:     deps?.getChartApi     || _getChartApi,
    ensurePanelOpen: deps?.ensurePanelOpen || _ensurePanelOpen,
    readRawRows:     deps?.readRawRows     || _readRawRows,
    sessionDateMs:   deps?.sessionDateMs   || (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    }),
  };
}

async function _ensurePanelOpen() {
  // Best-effort: check if panel root exists in DOM. If not, click the panel toggle.
  const exists = await _evaluate(`!!document.querySelector(${JSON.stringify(PANEL_ROOT_SELECTOR)})`);
  if (exists) return true;
  await _evaluate(`
    (function() {
      // Placeholder click strategy: aria-label or data-name button.
      var btn = document.querySelector('[aria-label*="Time & Sales" i]')
             || document.querySelector('[data-name*="time-sales" i]');
      if (btn) btn.click();
      return !!btn;
    })()
  `);
  await new Promise(r => setTimeout(r, 500));
  return await _evaluate(`!!document.querySelector(${JSON.stringify(PANEL_ROOT_SELECTOR)})`);
}

async function _readRawRows() {
  return await _evaluate(`
    (function() {
      var root = document.querySelector(${JSON.stringify(PANEL_ROOT_SELECTOR)});
      if (!root) return [];
      var rows = root.querySelectorAll(${JSON.stringify(ROW_SELECTOR)});
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var time  = (r.querySelector(${JSON.stringify(FIELD_TIME_SEL)}) || {}).textContent;
        var price = (r.querySelector(${JSON.stringify(FIELD_PRICE_SEL)}) || {}).textContent;
        var size  = (r.querySelector(${JSON.stringify(FIELD_SIZE_SEL)}) || {}).textContent;
        var sideEl = r.querySelector(${JSON.stringify(FIELD_SIDE_SEL)});
        var side = sideEl ? (sideEl.textContent || '').trim().toLowerCase() : null;
        out.push({ time: (time || '').trim(), price: (price || '').trim(), size: (size || '').trim(), side: side, sideClass: r.className });
      }
      return out;
    })()
  `);
}

export async function getTicks({ limit = 50, since, _deps } = {}) {
  const { ensurePanelOpen, readRawRows, sessionDateMs } = _resolve(_deps);
  const open = await ensurePanelOpen();
  if (!open) {
    return {
      success: false,
      error: 'Time & Sales panel could not be opened. Open it manually and retry.',
    };
  }

  const rawRows = await readRawRows();
  const dayMs = sessionDateMs();
  const sinceMs = since ? Date.parse(since) : null;
  if (since && !Number.isFinite(sinceMs)) {
    return { success: false, error: `Invalid 'since' timestamp: ${since}` };
  }

  const ticks = [];
  for (const row of rawRows || []) {
    const t = parseTickRow(row, dayMs);
    if (!t) continue;
    if (sinceMs && t.time && Date.parse(t.time) < sinceMs) continue;
    ticks.push(t);
    if (ticks.length >= Math.max(1, Math.min(500, limit))) break;
  }
  return {
    success: true,
    tick_count: ticks.length,
    panel_open: true,
    ticks,
  };
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
node --test tests/ticks.test.js
```
Expected: 6 cases pass (3 parseTickRow + 3 getTicks).

- [ ] **Step 5: Verify tools/ticks.js loads cleanly**

```bash
node -e "import('./src/tools/ticks.js').then(m => console.log('exports:', Object.keys(m)))"
```
Expected: `exports: [ 'registerTickTools' ]`.

- [ ] **Step 6: Commit (Tasks 3.1 + 3.2 together)**

```bash
git add src/core/ticks.js src/tools/ticks.js tests/ticks.test.js
git commit -m "feat(ticks): data_get_ticks reads Time & Sales panel (selectors probe-pending)"
```

### Task 3.3: CLI command for ticks

**Files:**
- Create: `src/cli/commands/ticks.js`

- [ ] **Step 1: Create the CLI command file**

```javascript
import { register } from '../router.js';
import * as core from '../../core/ticks.js';

register('ticks', {
  description: 'Read recent ticks from Time & Sales panel',
  options: {
    limit: { type: 'string', short: 'l', description: 'Max ticks to return (1-500, default 50)' },
    since: { type: 'string', short: 's', description: 'ISO timestamp filter' },
  },
  handler: (opts) => core.getTicks({
    limit: opts.limit ? Number(opts.limit) : 50,
    since: opts.since,
  }),
});
```

- [ ] **Step 2: Verify import**

```bash
node -e "import('./src/cli/commands/ticks.js').then(() => console.log('cli ticks ok'))"
```
Expected: `cli ticks ok`.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/ticks.js
git commit -m "feat(cli): add 'tv ticks' subcommand"
```

---

## Phase 4 — Wire-up + tool count bump

### Task 4.1: Register tick tools in `src/server.js`

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add import**

After existing tool imports (after `import { registerPremiumChartTools } from './tools/premium_chart.js';`), add:

```javascript
import { registerTickTools } from './tools/ticks.js';
```

- [ ] **Step 2: Add registration**

After `registerPremiumChartTools(server);`, add:

```javascript
registerTickTools(server);
```

- [ ] **Step 3: Bump tool count in instructions**

Find `instructions: \`TradingView MCP — 88 tools` and replace with `89 tools`. Also append to the "Premium chart types" section in instructions:

```
- data_get_ticks → recent ticks from Time & Sales panel (Premium/Ultimate)
```

- [ ] **Step 4: Smoke test server boots**

```bash
node -e "
import('./src/server.js').then(() => { console.log('server boot ok'); setTimeout(() => process.exit(0), 100); })
.catch(e => { console.error(e.message); process.exit(1); });
"
```
Expected: `server boot ok`.

- [ ] **Step 5: Commit**

```bash
git add src/server.js
git commit -m "feat(server): register data_get_ticks (count 88 -> 89)"
```

### Task 4.2: Wire CLI command in `src/cli/index.js`

**Files:**
- Modify: `src/cli/index.js`

- [ ] **Step 1: Add import**

After `import './commands/premium.js';`, add:

```javascript
import './commands/ticks.js';
```

- [ ] **Step 2: Update the count comment**

Find the line `* All 88 MCP tools are accessible via CLI commands.` and change to `* All 89 MCP tools are accessible via CLI commands.`

- [ ] **Step 3: Smoke test CLI lists ticks**

```bash
node src/cli/index.js --help 2>&1 | grep -i ticks
```
Expected: a line including `ticks` and the description.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.js
git commit -m "feat(cli): wire ticks command (count 88 -> 89)"
```

### Task 4.3: Update `package.json` test scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Append new test files to scripts**

Find:
```json
"test": "node --test tests/e2e.test.js tests/pine_analyze.test.js tests/premium_chart.test.js",
```

Replace with:
```json
"test": "node --test tests/e2e.test.js tests/pine_analyze.test.js tests/premium_chart.test.js tests/intervals.test.js tests/data_ohlcv.test.js tests/ticks.test.js",
```

Find similar lines for `test:all` and `test:unit` and append the same three new test files.

- [ ] **Step 2: Run unit tests**

```bash
npm run test:unit
```
Expected: previous 25 + (5 intervals + 3 data_ohlcv + 6 ticks) = 39 unit tests pass. (Plus pre-existing 27 from old suites = ~66 total. Two pre-existing CDP-dependent failures still expected.)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: include intervals/data_ohlcv/ticks tests in npm scripts"
```

---

## Phase 5 — Documentation

### Task 5.1: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Bump tool count**

Find `## Tool Reference (88 MCP tools)` → `## Tool Reference (89 MCP tools)`.
Find `MCP over stdio (88 tools)` → `MCP over stdio (89 tools)`.

- [ ] **Step 2: Add note to chart-control + data sections**

In the "Chart Control" subsection (under Tool Reference), find the row for `chart_set_timeframe` (or the column "Change resolution (1, 5, 60, D, W, M)" for `chart_set_timeframe`) and update the description to:

```
| `chart_set_timeframe` | Change resolution. Accepts seconds (`1S`, `5S`, `30S`), minutes (`1`, `15`, `60`), `D`, `W`, `M`. Symbol must support requested resolution. |
```

In the "Chart Reading" subsection, update `data_get_ohlcv` description to:

```
| `data_get_ohlcv` | Get price bars (up to 40,000). **Use `summary: true`** for compact stats. Triggers history load if requested count exceeds chart cache. |
```

- [ ] **Step 3: Add new "Tick Data" subsection**

After the "Premium Chart Types (Ultimate)" subsection, insert:

```markdown
### Tick Data (Premium / Ultimate)

| Tool | What it does |
|------|-------------|
| `data_get_ticks` | Read recent tick prints from Time & Sales panel (price, size, side, time). Requires panel to be openable. |
```

- [ ] **Step 4: Add row to "How Claude Knows Which Tool to Use" decision table**

Append:

```markdown
| "Show me last 50 ticks" | `data_get_ticks` |
| "Switch to 5-second bars" | `chart_set_timeframe` with `"5S"` |
| "Get me 10000 daily bars" | `data_get_ohlcv` with `count: 10000` |
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): document seconds intervals, 40k OHLCV, ticks (89 total)"
```

### Task 5.2: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Bump tool count**

Find `## Decision Tree` line context (top of file). Update any reference to 88 tools → 89.

- [ ] **Step 2: Add tick + interval workflows**

After the "Premium chart features" section, insert:

```markdown
### "Read recent tick prints"

1. `data_get_ticks` with `limit: 50` → returns last 50 ticks (price, size, side, time)

Pre-condition: TradingView's Time & Sales panel must be open (or auto-openable). If `panel_open: false` in response, instruct the user to open it manually.

### "Sub-minute resolution analysis"

1. `chart_set_timeframe` with `"1S"`, `"5S"`, or `"30S"` (seconds intervals — Ultimate feature, requires symbol to support seconds).
2. `data_get_ohlcv` to read the resulting fast bars.

If chart_set_timeframe returns `success: false` with "Symbol does not support", fall back to a higher resolution.

### "Deep history backtest data"

`data_get_ohlcv` with `count: 10000` (or up to 40,000) — the tool transparently triggers TradingView to load older bars if the chart cache has fewer than requested. Returns `partial: true` with `requested` / `returned` if loading times out.
```

- [ ] **Step 3: Add tick output size to size estimates table**

Append rows:

```markdown
| `data_get_ticks` (50 ticks) | ~3-5 KB |
| `data_get_ohlcv` (10000 bars) | ~800 KB — use `summary: true` instead unless raw bars needed |
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): seconds intervals, 40k bars, ticks decision-tree workflows"
```

### Task 5.3: Update `SETUP_GUIDE.md`

**Files:**
- Modify: `SETUP_GUIDE.md`

- [ ] **Step 1: Add Time & Sales note**

Find the "## Premium Chart Types (Ultimate plan only)" section and append below it:

```markdown
## Tick Data (Premium / Ultimate plans)

For `data_get_ticks` to work, TradingView's Time & Sales panel must be available. On Premium/Ultimate plans this panel is included; on lower tiers it may be locked.

**One-time:** open the Time & Sales panel from TradingView's right sidebar (look for the bid/ask/last icon). The MCP server attempts auto-open before each call but will return `{success:false, error:"Time & Sales panel could not be opened"}` if the click fails.

**Sub-minute resolutions** (`chart_set_timeframe` with `"1S"`, `"5S"`, `"30S"`) require the symbol to support seconds-based intervals. Crypto exchanges (BINANCE, COINBASE) generally do; equities and forex usually do not.

**40,000-bar history** is fetched lazily — `data_get_ohlcv` with high `count` triggers TradingView to load older data. Some symbols may have shorter histories; in that case the tool returns `partial: true` with `returned < requested`.
```

- [ ] **Step 2: Commit**

```bash
git add SETUP_GUIDE.md
git commit -m "docs(setup): document Time & Sales panel + seconds intervals + 40k bar history"
```

---

## Phase 6 — Live smoke + selector finalization

### [CONTROLLER] Task 6.1: Live smoke against TradingView Desktop

**Files:** none (test only)

This task is performed by the controller after Phases 1-5 complete. Subagents do NOT run this — they don't have live TV access.

- [ ] **Step 1: Operator confirms TV running, panel open**

```bash
node src/cli/index.js status
```
Expected: `cdp_connected: true`. Operator opens Time & Sales panel manually if not already open.

- [ ] **Step 2: Sub-minute test on a crypto symbol**

```bash
node src/cli/index.js symbol "BINANCE:BTCUSDT"
node src/cli/index.js timeframe "5S"
node src/cli/index.js ohlcv --count 60 --summary
```
Expected: `timeframe: "5S"` set, OHLCV returns 60 5-second bars.

If `chart_set_timeframe` returns `success: false`, the symbol/exchange does not support 5S — try `BINANCE:ETHUSDT` or another crypto.

- [ ] **Step 3: Sub-minute test on a non-supporting symbol (negative)**

```bash
node src/cli/index.js symbol "AAPL"
node src/cli/index.js timeframe "5S"
```
Expected: `success: false` with "Symbol does not support 5S resolution" message. (Equities typically support minutes only.)

- [ ] **Step 4: 40k-bar test**

Switch back to a long-history symbol (`BINANCE:BTCUSDT`, daily resolution):

```bash
node src/cli/index.js timeframe "D"
node src/cli/index.js ohlcv --count 10000 --summary
```
Expected: returns either full 10000 bars or a `partial: true` response with `returned` < 10000. Either is acceptable; document whichever.

- [ ] **Step 5: Tick test**

```bash
node src/cli/index.js ticks --limit 10
```
Expected: 10 tick records with `time`, `price`, `size`, `side`. If `success: false` with "panel could not be opened" — Task 6.2 below.

- [ ] **Step 6: Document smoke results**

Operator captures observed values into a smoke-results.md (optional) or notes in the eventual PR.

### [CONTROLLER] Task 6.2: Finalize Time & Sales selectors (if probe yielded actual values)

**Files:**
- Modify: `src/core/ticks.js` (placeholder constants near top)

This task only runs if Task 3.0 probe yielded different selectors than the placeholders.

- [ ] **Step 1: Replace placeholder selectors**

In `src/core/ticks.js`, find the constants block:

```javascript
const PANEL_ROOT_SELECTOR = '[data-name="time-sales"]'; // PROBE-PENDING
const ROW_SELECTOR        = '.time-sales-row';          // PROBE-PENDING
// ...
```

Replace each placeholder with the actual selector discovered by Task 3.0. Remove the `// PROBE-PENDING` comments.

- [ ] **Step 2: Re-run unit tests**

```bash
node --test tests/ticks.test.js
```
Expected: 6/6 pass (selectors don't affect unit tests, which use injected `_deps`).

- [ ] **Step 3: Re-run live tick smoke**

```bash
node src/cli/index.js ticks --limit 10
```
Expected: 10 well-formed ticks.

- [ ] **Step 4: Commit (if changes)**

```bash
git add src/core/ticks.js
git commit -m "fix(ticks): replace placeholder selectors with live-probe values"
```

### Task 6.3: Final acceptance walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Verify all spec acceptance criteria from Section 11 of spec**

Run each:
```bash
# 1. chart_set_timeframe accepts "1S" on crypto
node src/cli/index.js symbol "BINANCE:BTCUSDT" && node src/cli/index.js timeframe "1S"

# 2. data_get_ohlcv 10000 bars
node src/cli/index.js ohlcv --count 10000 --summary

# 3. data_get_ticks 20
node src/cli/index.js ticks --limit 20

# 4. Existing 88 tools still work
node --test tests/premium_chart.test.js

# 5. Unit tests pass
npm test

# 6. README count
grep "Tool Reference (89 MCP tools)" README.md

# 7. CLAUDE.md decision tree includes new sections
grep -i "Read recent tick" CLAUDE.md

# 8. SETUP_GUIDE has Time & Sales note
grep -i "Time & Sales" SETUP_GUIDE.md
```

- [ ] **Step 2: Commit any final tweaks**

If anything was missed, commit fixes with descriptive messages.

### Task 6.4: Merge to master

**Files:** none (git only)

- [ ] **Step 1: Verify clean working tree**

```bash
git status
```
Expected: clean.

- [ ] **Step 2: Switch to master and merge**

```bash
git checkout master
git merge epic2-intervals-data --ff-only
```
Expected: fast-forward merge succeeds.

- [ ] **Step 3: Delete feature branch**

```bash
git branch -d epic2-intervals-data
```

- [ ] **Step 4: Verify final commit count**

```bash
git log --oneline | head -10
```

---

## Risks and rollback

| Risk | Mitigation |
|---|---|
| TV's `requestMoreBars` API name differs from probed values | `_loadHistoryUntil` tries 3 known entry points; if all silent, falls through to no-op poll (returns `partial: true` rather than crashing) |
| Time & Sales selectors don't match in some TV versions | Task 6.2 swaps placeholders; if probe fails entirely, `data_get_ticks` returns clear error directing user to open panel manually |
| Symbol doesn't support seconds → silent TV no-op | Post-call interval read (Task 1.1) catches this and returns `success: false` with explanation |
| `getOhlcv` 40k load takes too long | 30s timeout; partial result returned with `partial: true, requested, returned` |

To roll back the entire epic:
```bash
git checkout master
git branch -D epic2-intervals-data
```

---

## Self-review (run by plan author before handoff)

**Spec coverage:**
- [x] §6.1 `chart_set_timeframe` regex + post-verify — Task 1.1
- [x] §6.2 `data_get_ohlcv` 40k cap + history loader — Tasks 2.1 + 2.2
- [x] §6.3 `data_get_ticks` schema + parser + panel open — Tasks 3.1 + 3.2 + 3.3
- [x] §8 error handling — covered in per-task tests
- [x] §10 OQ1 (requestMoreBars) — Task 2.2 implementation tries 3 candidates
- [x] §10 OQ2 (Time & Sales DOM) — Tasks 3.0 + 6.2 (controller probes)
- [x] §10 OQ3 (seconds support per symbol) — Task 6.1 Step 2 + Step 3 covers crypto + equity check
- [x] §11 acceptance criteria — Task 6.3 walkthrough

**Placeholder scan:** Two `// PROBE-PENDING` markers exist intentionally in `src/core/ticks.js` constants — they document that the values must be replaced post-probe (Task 6.2). All other steps contain complete code.

**Type consistency:**
- `getTicks` signature: `{ limit, since, _deps }` — matches Task 3.1 tool registration and Task 3.3 CLI handler
- `parseTickRow(row, sessionDateMs)` — used identically in tests and impl
- `_loadHistoryUntil(target, { _deps })` — both test and `getOhlcv` integration use this shape

**Note:** Phase 3 cannot be fully completed by subagents because Time & Sales selectors require a live probe (Task 3.0 + Task 6.2). The plan tags these as `[CONTROLLER]` and provides placeholder selectors that allow unit tests to pass; live e2e is gated on operator post-processing.
