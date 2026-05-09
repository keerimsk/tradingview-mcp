# Epic #1 — Premium Chart Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-05-09-epic1-premium-chart-types-design.md](../specs/2026-05-09-epic1-premium-chart-types-design.md)

**Goal:** Add 9 MCP tools that expose TradingView Ultimate's premium chart types (Volume Profile, Footprint, TPO, auto-patterns, Bar Magnifier) to LLM agents, with structured-data reads where feasible.

**Architecture:** Single Pine v5 indicator (`pine/mcp-helper.pine`) with a `mode` input emits Volume Profile and TPO data via `table.new()` with magic-string headers (`MCP_VP_v1`, `MCP_TPO_v1`). The MCP server's `core/premium_chart.js` injects/parses this helper, wraps built-in pattern studies for auto-pattern detection, and toggles chart-type / Bar Magnifier via existing UI primitives. No new dependencies, no internal-probe reverse engineering in v1.

**Tech Stack:** Node.js 18+ (ESM), `@modelcontextprotocol/sdk` ^1.12.1, `chrome-remote-interface` ^0.33.2, Pine Script v5, `node:test` for tests, `zod` for tool schemas.

**Repo conventions (already established):**
- `src/core/<module>.js` — pure CDP business logic, exports async functions, takes `_deps` for testability
- `src/tools/<module>.js` — MCP registrations, Zod schemas, wraps core in `try { jsonResult(...) } catch (err) { jsonResult({success:false, error:err.message}, true) }`
- `src/cli/commands/<module>.js` — calls `register(name, { description, subcommands: Map<...> })` from `cli/router.js`, invokes core directly
- `src/server.js` — imports `register<X>Tools` from each tool file and wires them
- `src/cli/index.js` — imports each command file (side-effect register) then calls `run(process.argv)`
- All connection helpers live in `src/connection.js` (`evaluate`, `getChartApi`, `safeString`, `requireFinite`, `KNOWN_PATHS`)
- All MCP outputs include `success: boolean`. CLI exit code 2 reserved for connection failures.

---

## Phase 0 — Foundation

### Task 0.0: Initialize git repository (if not already)

**Files:**
- Repo root: `c:/Users/Kerim/Desktop/tradingview-mcp`

- [ ] **Step 1: Check if git repo exists**

```bash
test -d .git && echo "git repo exists" || echo "needs init"
```

- [ ] **Step 2: If not a repo, initialize**

```bash
git init
git add -A
git commit -m "chore: initial commit (existing tradingview-mcp baseline)"
```
Skip Step 2 if Step 1 said "git repo exists".

- [ ] **Step 3: Create epic-1 working branch**

```bash
git checkout -b epic1-premium-chart-types
```

---

### Task 0.1: Create Pine helper indicator skeleton

**Files:**
- Create: `pine/mcp-helper.pine`
- Create: `pine/README.md`

- [ ] **Step 1: Create `pine/mcp-helper.pine` with skeleton**

```pine
//@version=5
// TV-MCP Helper Indicator
// Emits Volume Profile and TPO data as tables with magic-string headers
// for parsing by the tradingview-mcp server.
//
// Magic headers:
//   "MCP_VP_v1"  — Volume Profile output
//   "MCP_TPO_v1" — TPO output
//
// Install: paste into Pine editor, save as "TV-MCP Helper", then add to chart.
indicator("TV-MCP Helper", overlay=false, max_labels_count=10, max_lines_count=10, max_boxes_count=10)

// ── Mode selection ─────────────────────────────────────────────────────────
mode = input.string("vp", title="Mode", options=["vp", "tpo"])

// ── VP inputs ──────────────────────────────────────────────────────────────
vp_variant  = input.string("visible_range", title="VP Variant",
                           options=["visible_range", "fixed_range", "session"])
vp_rows     = input.int(24,  title="VP Rows",       minval=4, maxval=200)
vp_va_pct   = input.float(0.7, title="VP Value Area %", minval=0.1, maxval=0.99)
vp_lookback = input.int(200, title="VP Lookback Bars", minval=20, maxval=5000)

// ── TPO inputs ─────────────────────────────────────────────────────────────
tpo_period  = input.int(30,  title="TPO Period (min)", minval=1, maxval=240)
tpo_session = input.string("RTH", title="TPO Session", options=["RTH", "ETH"])
tpo_va_pct  = input.float(0.7, title="TPO Value Area %", minval=0.1, maxval=0.99)

// ── Placeholder table to confirm load ──────────────────────────────────────
var table t = table.new(position.top_right, columns=2, rows=2, border_width=1)
if barstate.islast
    table.cell(t, 0, 0, mode == "vp" ? "MCP_VP_v1" : "MCP_TPO_v1")
    table.cell(t, 1, 0, "loading")
    table.cell(t, 0, 1, "mode")
    table.cell(t, 1, 1, mode)
```

- [ ] **Step 2: Create `pine/README.md` with installation instructions**

```markdown
# Pine helper indicator

`mcp-helper.pine` is a Pine v5 indicator the user installs once into TradingView. It emits Volume Profile and TPO data as tables with magic headers (`MCP_VP_v1`, `MCP_TPO_v1`) so the MCP server can parse them via `data_get_pine_tables`.

## Manual install

1. Open Pine editor in TradingView Desktop.
2. Paste contents of `mcp-helper.pine`.
3. Save with name `TV-MCP Helper`.
4. Add to chart.

## Programmatic install

Run from project root once TradingView is running:

```bash
node src/cli/index.js premium install-helper
```

This bootstrap injects the source via `pine_set_source`, compiles, saves, and adds to chart.
```

- [ ] **Step 3: Commit**

```bash
git add pine/
git commit -m "feat(pine): scaffold TV-MCP helper indicator with magic-header table"
```

---

### Task 0.2: Implement Volume Profile bin aggregation in Pine helper

**Files:**
- Modify: `pine/mcp-helper.pine` (replace placeholder block)

- [ ] **Step 1: Replace the placeholder block with VP aggregation**

Replace the `// ── Placeholder table ──` block and everything below it with:

```pine
// ═══ Volume Profile Mode ═══════════════════════════════════════════════════
emit_vp() =>
    // Determine range: visible_range / session / fixed_range (using lookback as proxy)
    int lb = vp_variant == "session" ? math.min(vp_lookback, bar_index - ta.valuewhen(session.isfirstbar, bar_index, 0)) : vp_lookback
    lb := math.max(lb, 10)

    float low_min  = ta.lowest(low,  lb)
    float high_max = ta.highest(high, lb)
    float bin_size = (high_max - low_min) / vp_rows

    // Aggregate volume per bin via hlc3 typical price.
    var float[] bin_volumes = array.new_float(vp_rows, 0.0)
    var float[] bin_prices  = array.new_float(vp_rows, 0.0)

    for i = 0 to vp_rows - 1
        array.set(bin_volumes, i, 0.0)
        array.set(bin_prices,  i, low_min + bin_size * (i + 0.5))

    for j = 0 to lb - 1
        float typ = (high[j] + low[j] + close[j]) / 3.0
        int idx = int(math.floor((typ - low_min) / bin_size))
        idx := math.max(0, math.min(vp_rows - 1, idx))
        array.set(bin_volumes, idx, array.get(bin_volumes, idx) + (na(volume[j]) ? 0.0 : volume[j]))

    // POC = argmax bin
    int   poc_idx = 0
    float poc_vol = 0.0
    for k = 0 to vp_rows - 1
        if array.get(bin_volumes, k) > poc_vol
            poc_vol := array.get(bin_volumes, k)
            poc_idx := k

    float poc_price = array.get(bin_prices, poc_idx)

    // Value Area: expand from POC until va_pct of total.
    float total_vol = array.sum(bin_volumes)
    float va_target = total_vol * vp_va_pct
    float va_running = poc_vol
    int   va_low_i  = poc_idx
    int   va_high_i = poc_idx

    while va_running < va_target and (va_low_i > 0 or va_high_i < vp_rows - 1)
        float low_n  = va_low_i  > 0           ? array.get(bin_volumes, va_low_i  - 1) : -1.0
        float high_n = va_high_i < vp_rows - 1 ? array.get(bin_volumes, va_high_i + 1) : -1.0
        if low_n < 0 and high_n < 0
            break
        if low_n >= high_n
            va_low_i  -= 1
            va_running += low_n
        else
            va_high_i += 1
            va_running += high_n

    float val = array.get(bin_prices, va_low_i)
    float vah = array.get(bin_prices, va_high_i)

    [poc_price, vah, val, total_vol, bin_volumes, bin_prices]

// ═══ Output table emitter ══════════════════════════════════════════════════
var table t = table.new(position.top_right, columns=2, rows=210, border_width=1)

if barstate.islast
    if mode == "vp"
        [poc, vah, val, tvol, bvols, bprices] = emit_vp()
        table.cell(t, 0, 0, "MCP_VP_v1")
        table.cell(t, 1, 0, vp_variant)
        table.cell(t, 0, 1, "poc")
        table.cell(t, 1, 1, str.tostring(poc, "#.##########"))
        table.cell(t, 0, 2, "vah")
        table.cell(t, 1, 2, str.tostring(vah, "#.##########"))
        table.cell(t, 0, 3, "val")
        table.cell(t, 1, 3, str.tostring(val, "#.##########"))
        table.cell(t, 0, 4, "total_volume")
        table.cell(t, 1, 4, str.tostring(tvol, "#.##"))
        table.cell(t, 0, 5, "va_pct")
        table.cell(t, 1, 5, str.tostring(vp_va_pct))
        table.cell(t, 0, 6, "rows")
        table.cell(t, 1, 6, str.tostring(vp_rows))
        // Rows 7..7+vp_rows-1: bin_price | bin_volume
        for r = 0 to vp_rows - 1
            table.cell(t, 0, 7 + r, str.tostring(array.get(bprices, r), "#.##########"))
            table.cell(t, 1, 7 + r, str.tostring(array.get(bvols,    r), "#.##"))
    else
        // TPO branch — implemented in next task
        table.cell(t, 0, 0, "MCP_TPO_v1")
        table.cell(t, 1, 0, "pending")
```

- [ ] **Step 2: Manual smoke test in TradingView**

1. Launch TradingView with `--remote-debugging-port=9222`.
2. Paste the indicator into the Pine editor, save as `TV-MCP Helper`, add to chart.
3. Set mode to `vp`. Confirm a table appears in top-right with first cell `MCP_VP_v1`, then `poc`, `vah`, `val`, etc.
4. Compare POC against TradingView's built-in "Volume Profile Visible Range" study added to the same chart — they should be within one bin's price width of each other.

Expected: Visible POC/VAH/VAL values that approximately match the built-in VRVP study.

If POC is off by orders of magnitude, the bin index math is wrong — fix and re-test.

- [ ] **Step 3: Commit**

```bash
git add pine/mcp-helper.pine
git commit -m "feat(pine): implement Volume Profile bin aggregation + value area"
```

---

### Task 0.3: Implement TPO bracket aggregation in Pine helper

**Files:**
- Modify: `pine/mcp-helper.pine` (replace TPO branch)

- [ ] **Step 1: Replace the TPO branch with full implementation**

Find this block:
```pine
    else
        // TPO branch — implemented in next task
        table.cell(t, 0, 0, "MCP_TPO_v1")
        table.cell(t, 1, 0, "pending")
```

Replace with:
```pine
    else
        // TPO: each bracket within the current session = a letter (A,B,C,...).
        // For every price level (1 tick increment), record which letters touched it.
        // Output: for each row (price level), the concatenated letters.

        int bracket_ms = tpo_period * 60 * 1000
        bool is_new_session = ta.change(time("D")) != 0

        // Count brackets per session — assumes session starts at 09:30 RTH or 00:00 ETH.
        int session_start_idx = ta.valuewhen(is_new_session, bar_index, 0)
        int bars_in_session = bar_index - session_start_idx + 1

        // Determine session high/low.
        float s_high = ta.highest(high, bars_in_session)
        float s_low  = ta.lowest(low,   bars_in_session)
        float tick   = syminfo.mintick > 0 ? syminfo.mintick : (s_high - s_low) / 50.0
        int   levels = int(math.min(200.0, math.round((s_high - s_low) / tick) + 1))
        levels := math.max(levels, 4)
        float lvl_step = (s_high - s_low) / (levels - 1)

        // For each price level, collect letters as ASCII string.
        var string[] letter_rows = array.new_string(200, "")
        for i = 0 to 199
            array.set(letter_rows, i, "")

        // Iterate each bar in session, assign to bracket index, mark touched levels.
        for j = 0 to bars_in_session - 1
            int bar_time = int(time[j])
            int session_open_time = int(time[bars_in_session - 1])
            int bracket_idx = int(math.floor((bar_time - session_open_time) / bracket_ms))
            bracket_idx := math.max(0, math.min(25, bracket_idx))  // A..Z cap
            string letter = str.format("{0}", str.tostring(bracket_idx + 65))  // ASCII A=65
            // str.tostring(int) gives a number — convert to char via lookup string
            string ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            letter := str.substring(ALPHABET, bracket_idx, bracket_idx + 1)

            float bar_low  = low[j]
            float bar_high = high[j]
            for lvl = 0 to levels - 1
                float p = s_low + lvl_step * lvl
                if p >= bar_low and p <= bar_high
                    string existing = array.get(letter_rows, lvl)
                    if str.contains(existing, letter) == false
                        array.set(letter_rows, lvl, existing + letter)

        // Compute POC = level with most letters; VA = expand from POC by total letter count.
        int poc_lvl = 0
        int poc_count = 0
        for lvl2 = 0 to levels - 1
            int c = str.length(array.get(letter_rows, lvl2))
            if c > poc_count
                poc_count := c
                poc_lvl := lvl2

        int total_letters = 0
        for lvl3 = 0 to levels - 1
            total_letters += str.length(array.get(letter_rows, lvl3))

        int va_target_lt = int(math.round(total_letters * tpo_va_pct))
        int va_running_lt = poc_count
        int va_lo = poc_lvl
        int va_hi = poc_lvl
        while va_running_lt < va_target_lt and (va_lo > 0 or va_hi < levels - 1)
            int lo_n = va_lo > 0          ? str.length(array.get(letter_rows, va_lo - 1)) : -1
            int hi_n = va_hi < levels - 1 ? str.length(array.get(letter_rows, va_hi + 1)) : -1
            if lo_n < 0 and hi_n < 0
                break
            if lo_n >= hi_n
                va_lo  -= 1
                va_running_lt += lo_n
            else
                va_hi  += 1
                va_running_lt += hi_n

        float poc_price_t = s_low + lvl_step * poc_lvl
        float vah_t       = s_low + lvl_step * va_hi
        float val_t       = s_low + lvl_step * va_lo

        // Initial Balance = first 2 brackets (60 min RTH default).
        float ib_high = s_low
        float ib_low  = s_high
        for j2 = 0 to bars_in_session - 1
            int bar_time2 = int(time[j2])
            int session_open_time2 = int(time[bars_in_session - 1])
            int b_idx = int(math.floor((bar_time2 - session_open_time2) / bracket_ms))
            if b_idx <= 1
                ib_high := math.max(ib_high, high[j2])
                ib_low  := math.min(ib_low,  low[j2])

        // Emit: header + summary + letter rows.
        table.cell(t, 0, 0, "MCP_TPO_v1")
        table.cell(t, 1, 0, tpo_session)
        table.cell(t, 0, 1, "period_min")
        table.cell(t, 1, 1, str.tostring(tpo_period))
        table.cell(t, 0, 2, "poc")
        table.cell(t, 1, 2, str.tostring(poc_price_t, "#.##########"))
        table.cell(t, 0, 3, "vah")
        table.cell(t, 1, 3, str.tostring(vah_t, "#.##########"))
        table.cell(t, 0, 4, "val")
        table.cell(t, 1, 4, str.tostring(val_t, "#.##########"))
        table.cell(t, 0, 5, "ib_high")
        table.cell(t, 1, 5, str.tostring(ib_high, "#.##########"))
        table.cell(t, 0, 6, "ib_low")
        table.cell(t, 1, 6, str.tostring(ib_low, "#.##########"))
        table.cell(t, 0, 7, "levels")
        table.cell(t, 1, 7, str.tostring(levels))
        for lvl4 = 0 to levels - 1
            float p_emit = s_low + lvl_step * lvl4
            table.cell(t, 0, 8 + lvl4, str.tostring(p_emit, "#.##########"))
            table.cell(t, 1, 8 + lvl4, array.get(letter_rows, lvl4))
```

- [ ] **Step 2: Bump table row capacity**

Find:
```pine
var table t = table.new(position.top_right, columns=2, rows=210, border_width=1)
```

Confirm `rows=210` (already set in Task 0.2). TPO needs up to `8 + 200 = 208` rows. OK.

- [ ] **Step 3: Manual smoke test**

1. Reload `TV-MCP Helper` indicator on chart, set mode to `tpo`, period 30, RTH.
2. Confirm table first cell is `MCP_TPO_v1`, then `period_min`, `poc`, `vah`, `val`, `ib_high`, `ib_low`, `levels`.
3. Subsequent rows: price | letters string (e.g., `24580.00 | ABCDEF`).

Expected: Letter rows roughly resemble a TPO chart's profile. Approximation only — Pine cannot replicate native TPO precisely.

- [ ] **Step 4: Commit**

```bash
git add pine/mcp-helper.pine
git commit -m "feat(pine): implement TPO bracket-letter aggregation"
```

---

## Phase 1 — Core module foundation

### Task 1.1: Create `src/core/premium_chart.js` skeleton with study locator

**Files:**
- Create: `src/core/premium_chart.js`
- Test: `tests/premium_chart.test.js`

- [ ] **Step 1: Write failing unit test for study locator parser**

Create `tests/premium_chart.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `Cannot find module '../src/core/premium_chart.js'`.

- [ ] **Step 3: Implement minimal `src/core/premium_chart.js`**

```javascript
/**
 * Core logic for premium chart types: Volume Profile, TPO, auto-patterns,
 * Footprint, Bar Magnifier.
 *
 * Reads structured data emitted by pine/mcp-helper.pine via magic-header tables,
 * and toggles native chart-type / settings via existing UI primitives.
 */
import {
  evaluate as _evaluate,
  getChartApi as _getChartApi,
  safeString,
} from '../connection.js';

export const MAGIC_VP  = 'MCP_VP_v1';
export const MAGIC_TPO = 'MCP_TPO_v1';
export const HELPER_NAME = 'TV-MCP Helper';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    getChartApi: deps?.getChartApi || _getChartApi,
  };
}

/**
 * Parse a 2-column magic-header table emitted by mcp-helper.pine.
 * @param {Array<[string, string]>} rows  - [[col0, col1], ...] from data_get_pine_tables
 * @param {string} expectedMagic          - MAGIC_VP or MAGIC_TPO
 * @returns parsed struct depending on magic
 */
export function parseMcpTable(rows, expectedMagic) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('parseMcpTable: empty table');
  }
  const [magic, variantOrSession] = rows[0];
  if (magic !== expectedMagic) {
    throw new Error(`parseMcpTable: magic header mismatch — got "${magic}", expected "${expectedMagic}"`);
  }

  if (expectedMagic === MAGIC_VP) {
    const summary = {};
    const bins = [];
    for (let i = 1; i < rows.length; i++) {
      const [k, v] = rows[i];
      if (['poc', 'vah', 'val', 'total_volume', 'va_pct', 'rows'].includes(k)) {
        summary[k] = Number(v);
      } else {
        // Bin row: numeric price | numeric volume
        const price = Number(k);
        const volume = Number(v);
        if (Number.isFinite(price) && Number.isFinite(volume)) {
          bins.push({ price, volume });
        }
      }
    }
    return {
      variant: variantOrSession,
      poc: summary.poc,
      vah: summary.vah,
      val: summary.val,
      total_volume: summary.total_volume,
      value_area_pct: summary.va_pct,
      bins,
    };
  }

  if (expectedMagic === MAGIC_TPO) {
    const summary = { session: variantOrSession };
    const letter_rows = [];
    for (let i = 1; i < rows.length; i++) {
      const [k, v] = rows[i];
      if (['period_min', 'levels'].includes(k)) summary[k] = Number(v);
      else if (['poc', 'vah', 'val', 'ib_high', 'ib_low'].includes(k)) summary[k] = Number(v);
      else {
        const price = Number(k);
        if (Number.isFinite(price)) letter_rows.push({ price, letters: v || '' });
      }
    }
    return {
      session: summary.session,
      period_min: summary.period_min,
      poc: summary.poc,
      value_area: { vah: summary.vah, val: summary.val },
      initial_balance: { high: summary.ib_high, low: summary.ib_low },
      letter_rows,
      single_prints: letter_rows.filter(r => r.letters.length === 1),
    };
  }

  throw new Error(`parseMcpTable: unsupported magic "${expectedMagic}"`);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): add premium_chart module with magic-header table parser"
```

---

### Task 1.2: Add helper-study locator (find study by name)

**Files:**
- Modify: `src/core/premium_chart.js`
- Test: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test for `findHelperStudy`**

Append to `tests/premium_chart.test.js`:

```javascript
import { findHelperStudy } from '../src/core/premium_chart.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `findHelperStudy is not exported`.

- [ ] **Step 3: Add `findHelperStudy` to `src/core/premium_chart.js`**

Append:

```javascript
/**
 * Find the entity ID of the TV-MCP Helper indicator on the active chart.
 * @returns {Promise<string|null>}
 */
export async function findHelperStudy({ _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const studies = await evaluate(`
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
          var nm = meta.description || meta.shortDescription || '';
          out.push({ id: s.id ? s.id() : null, name: nm });
        } catch(e) {}
      }
      return out;
    })()
  `);
  const found = (studies || []).find(s => s.name === HELPER_NAME);
  return found ? found.id : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS — 5 cases total.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): add findHelperStudy locator"
```

---

### Task 1.3: Add Pine helper installer + helper-table reader

**Files:**
- Modify: `src/core/premium_chart.js`
- Modify: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test for `readHelperTable`**

Append to `tests/premium_chart.test.js`:

```javascript
import { readHelperTable } from '../src/core/premium_chart.js';

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
    const fakeEvaluate = async (expr) => {
      if (expr.includes('dwgtablecells')) return [{ name: 'TV-MCP Helper', count: 8, items: fakeRows.flatMap((r, ri) => r.map((c, ci) => ({ id: `${ri}-${ci}`, raw: { text: c } }))) }];
      return null;
    };
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await readHelperTable('MCP_VP_v1', { _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result.poc, 100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `readHelperTable is not exported`.

- [ ] **Step 3: Implement `readHelperTable`**

Append to `src/core/premium_chart.js`:

```javascript
/**
 * Read the helper indicator's emitted table and parse with the given magic.
 *
 * Implementation note: TradingView Pine table cells are stored in
 * primitive collections — the same path used by data_get_pine_tables.
 * We bypass the MCP layer and call the same JS expression directly.
 *
 * @param {string} expectedMagic
 * @returns parsed struct
 */
export async function readHelperTable(expectedMagic, { _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const studyName = HELPER_NAME;

  const tableData = await evaluate(`
    (function() {
      var api = ${apiPath};
      var widget = api._chartWidget;
      var sources = widget.model().model().dataSources();
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (name !== ${safeString(studyName)}) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) return null;
          var pc = g._primitivesCollection;
          var tcOuter = pc.dwgtablecells;
          if (!tcOuter) return null;
          var tcColl = tcOuter.get('tableCells');
          if (!tcColl || !tcColl._primitivesDataById) return null;
          var cells = [];
          tcColl._primitivesDataById.forEach(function(v, id) { cells.push({ id: id, raw: v }); });
          return cells;
        } catch(e) { return { _err: e.message }; }
      }
      return null;
    })()
  `);

  if (!tableData) {
    throw new Error(`${HELPER_NAME} indicator not found on chart. Run 'tv premium install-helper' or add it manually.`);
  }
  if (tableData._err) throw new Error('Table read error: ' + tableData._err);

  // Convert flat cells into [row][col] grid using cell.raw.points or cell metadata.
  // Each cell has raw.column and raw.row (or position info in raw).
  const rowsMap = new Map();
  for (const cell of tableData) {
    const r = cell.raw?.row ?? cell.raw?.rowIndex ?? cell.raw?.points?.[0]?.row;
    const c = cell.raw?.column ?? cell.raw?.colIndex ?? cell.raw?.points?.[0]?.column;
    const text = cell.raw?.text ?? cell.raw?.cellText ?? cell.raw?.value ?? '';
    if (r === undefined || c === undefined) continue;
    if (!rowsMap.has(r)) rowsMap.set(r, []);
    rowsMap.get(r)[c] = String(text);
  }

  const sorted = [...rowsMap.entries()].sort((a, b) => a[0] - b[0]).map(([, cols]) => cols);
  return parseMcpTable(sorted, expectedMagic);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS.

If the fake-evaluate test path is wrong (the expression check), adjust the fake to return `tableData` directly — the test exists to lock in the parsing contract, not the JS expression detail.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): add readHelperTable to read+parse MCP magic table"
```

---

### Task 1.4: Add `installHelper` bootstrap (paste Pine source + save + add to chart)

**Files:**
- Modify: `src/core/premium_chart.js`

- [ ] **Step 1: Add `installHelper` function**

Append to `src/core/premium_chart.js`:

```javascript
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as pineCore from './pine.js';
import * as chartCore from './chart.js';

/**
 * One-time bootstrap: read pine/mcp-helper.pine, inject via pine_set_source,
 * compile, save, then add to chart via chart_manage_indicator.
 * Idempotent: if helper already present, returns { success: true, action: 'already_installed' }.
 */
export async function installHelper({ _deps } = {}) {
  const existing = await findHelperStudy({ _deps });
  if (existing) {
    return { success: true, action: 'already_installed', study_id: existing };
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const pinePath = join(here, '..', '..', 'pine', 'mcp-helper.pine');
  const source = await readFile(pinePath, 'utf-8');

  await pineCore.setSource({ source });
  await pineCore.smartCompile({});
  await pineCore.save({ name: HELPER_NAME });

  // Add saved script to chart by full name.
  await chartCore.manageIndicator({ action: 'add', name: HELPER_NAME });

  // Wait briefly for indicator to render.
  await new Promise(r => setTimeout(r, 800));
  const newId = await findHelperStudy({ _deps });
  if (!newId) {
    throw new Error('installHelper: helper indicator added but cannot be found on chart.');
  }
  return { success: true, action: 'installed', study_id: newId };
}
```

- [ ] **Step 2: Verify pine.js + chart.js export the functions used**

```bash
node -e "import('./src/core/pine.js').then(m => console.log(Object.keys(m)))"
node -e "import('./src/core/chart.js').then(m => console.log(Object.keys(m)))"
```

Expected: `pine.js` exports `setSource`, `smartCompile`, `save`. `chart.js` exports `manageIndicator`.

If function names differ (e.g., `pineSetSource` instead of `setSource`), update the imports in `installHelper` to match. Do NOT rename existing exports.

- [ ] **Step 3: Smoke test (requires TV running)**

```bash
node -e "
  import('./src/core/premium_chart.js').then(async m => {
    try {
      const r = await m.installHelper();
      console.log(JSON.stringify(r, null, 2));
    } catch (e) { console.error(e.message); process.exit(1); }
  });
"
```

Expected: `{ success: true, action: 'installed' or 'already_installed', study_id: '...' }`. Open TradingView and confirm `TV-MCP Helper` is on chart with the magic table visible.

- [ ] **Step 4: Commit**

```bash
git add src/core/premium_chart.js
git commit -m "feat(core): add installHelper bootstrap (paste+compile+save+add)"
```

---

## Phase 2 — Volume Profile (TDD)

### Task 2.1: Implement `vpAdd`

**Files:**
- Modify: `src/core/premium_chart.js`
- Modify: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test for `vpAdd`**

Append to `tests/premium_chart.test.js`:

```javascript
import { vpAdd } from '../src/core/premium_chart.js';

describe('vpAdd', () => {
  it('returns success with study_id when helper installed', async () => {
    const fakeEvaluate = async () => ([{ id: 'st_helper', name: 'TV-MCP Helper' }]);
    const fakeGetChartApi = async () => 'window.fakeChart';
    const result = await vpAdd({ variant: 'visible_range', rows: 24, va_pct: 0.7, _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } });
    assert.equal(result.success, true);
    assert.equal(result.variant, 'visible_range');
    assert.equal(result.study_id, 'st_helper');
  });

  it('errors when helper not installed', async () => {
    const fakeEvaluate = async () => ([]);
    const fakeGetChartApi = async () => 'window.fakeChart';
    await assert.rejects(
      () => vpAdd({ variant: 'visible_range', _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi } }),
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `vpAdd is not exported`.

- [ ] **Step 3: Implement `vpAdd`**

Append to `src/core/premium_chart.js`:

```javascript
import * as indicatorCore from './indicators.js';

const VP_VARIANTS = ['visible_range', 'fixed_range', 'session'];

/**
 * Set the helper indicator's mode to "vp" with the given inputs.
 * Requires the helper to already be installed (call installHelper first).
 */
export async function vpAdd({ variant = 'visible_range', rows = 24, va_pct = 0.7, _deps } = {}) {
  if (!VP_VARIANTS.includes(variant)) {
    throw new Error(`vpAdd: invalid variant "${variant}". Must be one of ${VP_VARIANTS.join(', ')}.`);
  }
  if (!Number.isInteger(rows) || rows < 4 || rows > 200) {
    throw new Error(`vpAdd: rows must be integer 4..200, got ${rows}`);
  }
  if (typeof va_pct !== 'number' || va_pct < 0.1 || va_pct > 0.99) {
    throw new Error(`vpAdd: va_pct must be number 0.1..0.99, got ${va_pct}`);
  }

  const studyId = await findHelperStudy({ _deps });
  if (!studyId) {
    throw new Error(`${HELPER_NAME} not found. Run 'tv premium install-helper' first.`);
  }

  // Update inputs on existing helper instance.
  await indicatorCore.setInputs({
    entity_id: studyId,
    inputs: { mode: 'vp', vp_variant: variant, vp_rows: rows, vp_va_pct: va_pct },
  });

  return { success: true, study_id: studyId, variant, rows, va_pct };
}
```

Verify `indicators.js` exports `setInputs`:

```bash
node -e "import('./src/core/indicators.js').then(m => console.log(Object.keys(m)))"
```

If different name (e.g., `setIndicatorInputs`), update import.

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS for the 3 vpAdd cases.

If the fake-evaluate test path doesn't trigger `setInputs` correctly, override `indicatorCore.setInputs` in the test by injecting via `_deps` — extend `_deps` to allow `indicators` override:

In `_resolve(deps)`, add:
```javascript
return {
  evaluate: deps?.evaluate || _evaluate,
  getChartApi: deps?.getChartApi || _getChartApi,
  setInputs: deps?.setInputs || indicatorCore.setInputs,
};
```
And in `vpAdd`, call `setInputs(...)` from the resolved deps.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): implement vpAdd (configures helper for VP mode)"
```

---

### Task 2.2: Implement `vpGet`

**Files:**
- Modify: `src/core/premium_chart.js`
- Modify: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test for `vpGet`**

Append to `tests/premium_chart.test.js`:

```javascript
import { vpGet } from '../src/core/premium_chart.js';

describe('vpGet', () => {
  it('returns parsed VP struct with bins', async () => {
    // Synthesize the full evaluate-side flat cell array
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `vpGet is not exported`.

- [ ] **Step 3: Implement `vpGet`**

Append to `src/core/premium_chart.js`:

```javascript
/**
 * Read VP data from the helper indicator and return structured JSON.
 */
export async function vpGet({ bins_limit = 100, _deps } = {}) {
  const parsed = await readHelperTable(MAGIC_VP, { _deps });
  const bins = parsed.bins.slice(0, Math.max(1, Math.min(500, bins_limit)));
  return {
    success: true,
    variant: parsed.variant,
    poc: parsed.poc,
    vah: parsed.vah,
    val: parsed.val,
    value_area_pct: parsed.value_area_pct,
    total_volume: parsed.total_volume,
    bins,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): implement vpGet (reads + parses VP magic table)"
```

---

### Task 2.3: Implement `vpRemove`

**Files:**
- Modify: `src/core/premium_chart.js`
- Modify: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test for `vpRemove`**

Append to `tests/premium_chart.test.js`:

```javascript
import { vpRemove } from '../src/core/premium_chart.js';

describe('vpRemove', () => {
  it('removes helper and returns removed:true when present', async () => {
    let removed = false;
    const fakeEvaluate = async (expr) => {
      if (removed) return [];
      return [{ id: 'st_helper', name: 'TV-MCP Helper' }];
    };
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `vpRemove is not exported`.

- [ ] **Step 3: Implement `vpRemove` and extend `_resolve`**

In `src/core/premium_chart.js`, update `_resolve`:

```javascript
function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    getChartApi: deps?.getChartApi || _getChartApi,
    setInputs: deps?.setInputs || indicatorCore.setInputs,
    manageIndicator: deps?.manageIndicator || chartCore.manageIndicator,
  };
}
```

Append:
```javascript
export async function vpRemove({ _deps } = {}) {
  const { manageIndicator } = _resolve(_deps);
  const id = await findHelperStudy({ _deps });
  if (!id) return { success: true, removed: false };
  await manageIndicator({ action: 'remove', name: HELPER_NAME });
  return { success: true, removed: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): implement vpRemove (idempotent helper removal)"
```

---

## Phase 3 — Auto-detected patterns (TDD)

### Task 3.1: Implement `patternsAdd`

**Files:**
- Modify: `src/core/premium_chart.js`
- Modify: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test**

Append to `tests/premium_chart.test.js`:

```javascript
import { patternsAdd, PATTERN_STUDY_NAMES } from '../src/core/premium_chart.js';

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
    assert.equal(calls[0].name, PATTERN_STUDY_NAMES.candlestick);
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `patternsAdd is not exported`.

- [ ] **Step 3: Implement**

Append to `src/core/premium_chart.js`:

```javascript
export const PATTERN_STUDY_NAMES = {
  candlestick: 'All Candlestick Patterns',
  harmonic:    'Harmonic Patterns',
  auto_fib:    'Auto Fib Retracement',
};

export async function patternsAdd({ kinds = [], _deps } = {}) {
  if (!Array.isArray(kinds) || kinds.length === 0) {
    throw new Error('patternsAdd: provide at least one kind');
  }
  for (const k of kinds) {
    if (!(k in PATTERN_STUDY_NAMES)) {
      throw new Error(`patternsAdd: unknown kind "${k}". Allowed: ${Object.keys(PATTERN_STUDY_NAMES).join(', ')}`);
    }
  }
  const { manageIndicator } = _resolve(_deps);
  const added = [];
  for (const kind of kinds) {
    const name = PATTERN_STUDY_NAMES[kind];
    const r = await manageIndicator({ action: 'add', name });
    added.push({ kind, name, study_id: r?.entity_id || r?.id || null });
  }
  return { success: true, added };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): implement patternsAdd (add built-in pattern studies)"
```

---

### Task 3.2: Implement `patternsList`

**Files:**
- Modify: `src/core/premium_chart.js`
- Modify: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test**

Append to `tests/premium_chart.test.js`:

```javascript
import { patternsList } from '../src/core/premium_chart.js';

describe('patternsList', () => {
  it('returns parsed patterns with kind, name, price, bar_time', async () => {
    const fakeEvaluate = async (expr) => {
      // Simulate label primitives across two pattern studies
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `patternsList is not exported`.

- [ ] **Step 3: Implement**

Append to `src/core/premium_chart.js`:

```javascript
const STUDY_NAME_TO_KIND = Object.fromEntries(
  Object.entries(PATTERN_STUDY_NAMES).map(([k, v]) => [v, k])
);

export async function patternsList({ kinds, max_per_kind = 25, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();

  const allowedNames = (kinds && kinds.length > 0)
    ? kinds.map(k => PATTERN_STUDY_NAMES[k]).filter(Boolean)
    : Object.values(PATTERN_STUDY_NAMES);

  // Read labels from each pattern study via primitive collection (same path as data_get_pine_labels).
  const studiesWithLabels = await evaluate(`
    (function() {
      var api = ${apiPath};
      var widget = api._chartWidget;
      var sources = widget.model().model().dataSources();
      var allowed = ${JSON.stringify(allowedNames)};
      var out = [];
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (allowed.indexOf(name) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          var pc = g._primitivesCollection;
          var lblOuter = pc.dwglabels;
          if (!lblOuter) continue;
          var lblColl = lblOuter.get('labels');
          if (!lblColl) continue;
          var inner = lblColl.get(false);
          if (!inner || !inner._primitivesDataById) continue;
          var items = [];
          inner._primitivesDataById.forEach(function(v, id) { items.push({ id: id, raw: v }); });
          if (items.length > 0) out.push({ name: name, items: items });
        } catch(e) {}
      }
      return out;
    })()
  `);

  const patterns = [];
  for (const st of (studiesWithLabels || [])) {
    const kind = STUDY_NAME_TO_KIND[st.name];
    const cap = Math.max(1, Math.min(200, max_per_kind));
    const items = (st.items || []).slice(0, cap);
    for (const item of items) {
      const text  = item.raw?.text ?? item.raw?.label ?? '';
      const point = item.raw?.points?.[0] ?? item.raw?.point ?? {};
      const price = Number(point.price);
      const time  = Number(point.time);
      patterns.push({
        kind,
        name: String(text || '').trim(),
        price: Number.isFinite(price) ? price : null,
        bar_time: Number.isFinite(time) ? new Date(time * 1000).toISOString() : null,
      });
    }
  }

  return { success: true, patterns };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): implement patternsList (parses labels from pattern studies)"
```

---

## Phase 4 — TPO (TDD)

### Task 4.1: Implement `tpoAdd`

**Files:**
- Modify: `src/core/premium_chart.js`
- Modify: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test**

Append to `tests/premium_chart.test.js`:

```javascript
import { tpoAdd } from '../src/core/premium_chart.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `tpoAdd is not exported`.

- [ ] **Step 3: Implement**

Append to `src/core/premium_chart.js`:

```javascript
export async function tpoAdd({ period_min = 30, session = 'RTH', va_pct = 0.7, _deps } = {}) {
  if (!Number.isInteger(period_min) || period_min < 1 || period_min > 240) {
    throw new Error(`tpoAdd: period_min must be 1..240, got ${period_min}`);
  }
  if (!['RTH', 'ETH'].includes(session)) {
    throw new Error(`tpoAdd: session must be 'RTH' or 'ETH', got "${session}"`);
  }
  if (typeof va_pct !== 'number' || va_pct < 0.1 || va_pct > 0.99) {
    throw new Error(`tpoAdd: va_pct must be 0.1..0.99, got ${va_pct}`);
  }

  const { setInputs } = _resolve(_deps);
  const studyId = await findHelperStudy({ _deps });
  if (!studyId) throw new Error(`${HELPER_NAME} not found. Run 'tv premium install-helper' first.`);
  await setInputs({
    entity_id: studyId,
    inputs: { mode: 'tpo', tpo_period: period_min, tpo_session: session, tpo_va_pct: va_pct },
  });
  return { success: true, study_id: studyId, period_min, session, va_pct };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): implement tpoAdd (configures helper for TPO mode)"
```

---

### Task 4.2: Implement `tpoGet`

**Files:**
- Modify: `src/core/premium_chart.js`
- Modify: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test**

Append to `tests/premium_chart.test.js`:

```javascript
import { tpoGet } from '../src/core/premium_chart.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `tpoGet is not exported`.

- [ ] **Step 3: Implement**

Append to `src/core/premium_chart.js`:

```javascript
export async function tpoGet({ _deps } = {}) {
  const parsed = await readHelperTable(MAGIC_TPO, { _deps });
  return {
    success: true,
    session: parsed.session,
    period_min: parsed.period_min,
    poc: parsed.poc,
    value_area: parsed.value_area,
    initial_balance: parsed.initial_balance,
    letter_rows: parsed.letter_rows,
    single_prints: parsed.single_prints,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): implement tpoGet (reads + parses TPO magic table)"
```

---

## Phase 5 — Footprint and Bar Magnifier

### Task 5.1: Implement `footprintToggle`

**Files:**
- Modify: `src/core/premium_chart.js`
- Modify: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test**

Append to `tests/premium_chart.test.js`:

```javascript
import { footprintToggle } from '../src/core/premium_chart.js';

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
    // First enable to set previous
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL — `footprintToggle is not exported`.

- [ ] **Step 3: Verify chart core function names**

```bash
node -e "import('./src/core/chart.js').then(m => console.log(Object.keys(m)))"
```

Note the export names for "set type" and "get state". Likely `setType` / `chartSetType` and `getChartState` / `getState`. Use the actual names in the implementation.

- [ ] **Step 4: Implement `footprintToggle`**

In `src/core/premium_chart.js`, extend `_resolve`:

```javascript
function _resolve(deps) {
  return {
    evaluate:        deps?.evaluate        || _evaluate,
    getChartApi:     deps?.getChartApi     || _getChartApi,
    setInputs:       deps?.setInputs       || indicatorCore.setInputs,
    manageIndicator: deps?.manageIndicator || chartCore.manageIndicator,
    setType:         deps?.setType         || chartCore.setType,           // adjust name to match chart.js
    getChartState:   deps?.getChartState   || chartCore.getState,          // adjust name to match chart.js
  };
}
```

(If the actual export is e.g. `chartSetType`, use `chartCore.chartSetType` everywhere.)

Append:

```javascript
const FOOTPRINT_TYPE_NAME = 'VolumeFootprint';

// Module-local cache so toggle(false) can revert to the prior type.
let _previousChartType = null;

export async function footprintToggle({ enable = true, _deps } = {}) {
  const { setType, getChartState } = _resolve(_deps);
  if (enable) {
    const state = await getChartState();
    const prev = state?.chart_type || state?.type || 'Candles';
    if (prev !== FOOTPRINT_TYPE_NAME) _previousChartType = prev;
    await setType({ type: FOOTPRINT_TYPE_NAME });
    return { success: true, current_type: FOOTPRINT_TYPE_NAME, previous_type: _previousChartType };
  } else {
    const target = _previousChartType || 'Candles';
    await setType({ type: target });
    return { success: true, current_type: target, previous_type: FOOTPRINT_TYPE_NAME };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS. If chart export name differs, adjust imports — do not rename existing exports.

- [ ] **Step 6: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): implement footprintToggle (chart-type swap with revert)"
```

---

### Task 5.2: Implement `barMagnifierToggle`

**Files:**
- Modify: `src/core/premium_chart.js`
- Modify: `tests/premium_chart.test.js`

- [ ] **Step 1: Add failing test**

Append to `tests/premium_chart.test.js`:

```javascript
import { barMagnifierToggle } from '../src/core/premium_chart.js';

describe('barMagnifierToggle', () => {
  it('returns success with enabled=true when toggled on', async () => {
    const fakeEvaluate = async () => true;  // pretend toggle succeeded
    const fakeGetChartApi = async () => 'x';
    const result = await barMagnifierToggle({
      enable: true,
      _deps: { evaluate: fakeEvaluate, getChartApi: fakeGetChartApi },
    });
    assert.equal(result.success, true);
    assert.equal(result.enabled, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/premium_chart.test.js
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/core/premium_chart.js`:

```javascript
/**
 * Toggle Bar Magnifier in chart settings via the TradingView property model.
 * On Premium/Ultimate, this corresponds to the "Bar Magnifier" feature in
 * Chart Settings → Symbol → Bar Magnifier.
 *
 * Implementation: writes to the chart property tree directly via
 * mainSeriesProperties.barMagnifier.value.setValue(bool). This avoids
 * brittle DOM clicking on the settings dialog.
 */
export async function barMagnifierToggle({ enable = true, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const ok = await evaluate(`
    (function() {
      try {
        var api = ${apiPath};
        var ms = api._chartWidget.model().mainSeries();
        var props = ms.properties().childs();
        var keys = Object.keys(props);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (k.toLowerCase().indexOf('barmagnifier') !== -1 || k.toLowerCase().indexOf('bar_magnifier') !== -1) {
            try { props[k].setValue(${enable ? 'true' : 'false'}); return true; } catch(e) {}
          }
        }
        // Fallback: search nested settings for any "barMagnifier" leaf
        function walk(node, depth) {
          if (depth > 4 || !node || typeof node !== 'object') return false;
          try {
            var c = typeof node.childs === 'function' ? node.childs() : null;
            if (!c) return false;
            var ks = Object.keys(c);
            for (var j = 0; j < ks.length; j++) {
              if (ks[j].toLowerCase().indexOf('barmagnifier') !== -1) {
                try { c[ks[j]].setValue(${enable ? 'true' : 'false'}); return true; } catch(e) {}
              }
              if (walk(c[ks[j]], depth + 1)) return true;
            }
          } catch(e) {}
          return false;
        }
        return walk(ms.properties(), 0);
      } catch(e) { return false; }
    })()
  `);
  if (!ok) {
    throw new Error('Bar Magnifier property not found in chart settings (TradingView UI may have changed).');
  }
  return { success: true, enabled: !!enable };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test tests/premium_chart.test.js
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/premium_chart.js tests/premium_chart.test.js
git commit -m "feat(core): implement barMagnifierToggle via property tree walk"
```

---

## Phase 6 — Wire MCP tools + CLI

### Task 6.1: Create `src/tools/premium_chart.js` registering 9 MCP tools

**Files:**
- Create: `src/tools/premium_chart.js`

- [ ] **Step 1: Create the tool registration file**

```javascript
import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/premium_chart.js';

export function registerPremiumChartTools(server) {
  // ── Helper installation ──────────────────────────────────────────────
  server.tool('premium_install_helper',
    'One-time bootstrap: paste pine/mcp-helper.pine into editor, compile, save, add to chart.',
    {},
    async () => {
      try { return jsonResult(await core.installHelper()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  // ── Volume Profile ───────────────────────────────────────────────────
  server.tool('vp_add',
    'Configure helper for Volume Profile mode (variant: visible_range / fixed_range / session).',
    {
      variant: z.enum(['visible_range', 'fixed_range', 'session']).default('visible_range'),
      rows:    z.coerce.number().int().min(4).max(200).default(24),
      va_pct:  z.coerce.number().min(0.1).max(0.99).default(0.7),
    },
    async ({ variant, rows, va_pct }) => {
      try { return jsonResult(await core.vpAdd({ variant, rows, va_pct })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('vp_get',
    'Read Volume Profile structured data (POC, VAH, VAL, bins) from helper indicator.',
    {
      bins_limit: z.coerce.number().int().min(1).max(500).default(100),
    },
    async ({ bins_limit }) => {
      try { return jsonResult(await core.vpGet({ bins_limit })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('vp_remove',
    'Remove the helper Volume Profile indicator from chart.',
    {},
    async () => {
      try { return jsonResult(await core.vpRemove()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  // ── Auto-detected patterns ───────────────────────────────────────────
  server.tool('patterns_add',
    'Add built-in pattern detection studies (candlestick / harmonic / auto_fib).',
    {
      kinds: z.array(z.enum(['candlestick', 'harmonic', 'auto_fib'])).min(1),
    },
    async ({ kinds }) => {
      try { return jsonResult(await core.patternsAdd({ kinds })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('patterns_list',
    'List patterns detected by built-in studies (name, price, bar_time).',
    {
      kinds:        z.array(z.enum(['candlestick', 'harmonic', 'auto_fib'])).optional(),
      max_per_kind: z.coerce.number().int().min(1).max(200).default(25),
    },
    async ({ kinds, max_per_kind }) => {
      try { return jsonResult(await core.patternsList({ kinds, max_per_kind })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  // ── TPO ──────────────────────────────────────────────────────────────
  server.tool('tpo_add',
    'Configure helper for TPO mode (period_min, session: RTH/ETH).',
    {
      period_min: z.coerce.number().int().min(1).max(240).default(30),
      session:    z.enum(['RTH', 'ETH']).default('RTH'),
      va_pct:     z.coerce.number().min(0.1).max(0.99).default(0.7),
    },
    async ({ period_min, session, va_pct }) => {
      try { return jsonResult(await core.tpoAdd({ period_min, session, va_pct })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('tpo_get',
    'Read TPO structured data (letter rows, value area, IB, single prints).',
    {},
    async () => {
      try { return jsonResult(await core.tpoGet()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  // ── Footprint ────────────────────────────────────────────────────────
  server.tool('footprint_toggle',
    'Toggle chart type to/from Volume Footprint. enable=false reverts to previous type.',
    {
      enable: z.coerce.boolean().default(true),
    },
    async ({ enable }) => {
      try { return jsonResult(await core.footprintToggle({ enable })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  // ── Bar Magnifier ────────────────────────────────────────────────────
  server.tool('bar_magnifier_toggle',
    'Toggle Bar Magnifier setting (Premium/Ultimate feature).',
    {
      enable: z.coerce.boolean().default(true),
    },
    async ({ enable }) => {
      try { return jsonResult(await core.barMagnifierToggle({ enable })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });
}
```

- [ ] **Step 2: Lint check (no static analyzer in repo, run import test)**

```bash
node -e "import('./src/tools/premium_chart.js').then(m => console.log('exports:', Object.keys(m)))"
```
Expected: `exports: [ 'registerPremiumChartTools' ]`.

- [ ] **Step 3: Commit**

```bash
git add src/tools/premium_chart.js
git commit -m "feat(tools): register 10 premium chart MCP tools"
```

(Note: 10 = 9 spec'd tools + the `premium_install_helper` bootstrap. The bootstrap is documented in the spec's Section 7 and is not double-counted in the "9 tools" mentioned earlier — adjust spec if needed when updating docs in Task 7.)

---

### Task 6.2: Wire `registerPremiumChartTools` into `src/server.js`

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add import + registration**

In `src/server.js`, after the existing tool imports (after line 16), add:

```javascript
import { registerPremiumChartTools } from './tools/premium_chart.js';
```

After `registerTabTools(server);` (line 86), add:

```javascript
registerPremiumChartTools(server);
```

Update the `instructions` template literal (line 25) to bump the count: change the line `name 78 tools` reference to reflect the new count. Specifically, change:

```javascript
description: 'AI-assisted TradingView chart analysis and Pine Script development via Chrome DevTools Protocol',
```

(no count there — leave it.) And update the instructions block where `78 tools` is mentioned:

```javascript
instructions: `TradingView MCP — 88 tools for reading and controlling a live TradingView Desktop chart.
```

(78 → 88, since 78 + 10 = 88.)

Append a new section to the `instructions` text, just after the "Tabs:" line:

```text

Premium chart types (Ultimate features):
- premium_install_helper → ONE-TIME: install pine/mcp-helper.pine into TradingView (paste, compile, save, add)
- vp_add / vp_get / vp_remove → Volume Profile via helper (POC, VAH, VAL, bins)
- patterns_add / patterns_list → auto-detected candlestick/harmonic/auto_fib patterns
- tpo_add / tpo_get → TPO Market Profile (letter rows, value area, single prints, IB)
- footprint_toggle → switch chart type to/from Volume Footprint
- bar_magnifier_toggle → toggle Bar Magnifier setting
```

- [ ] **Step 2: Smoke test the server boots**

```bash
node -e "
import('./src/server.js').then(() => { console.log('server boot ok'); process.exit(0); })
.catch(e => { console.error(e.message); process.exit(1); });
" 2>&1 | grep -v 'tradingview-mcp' || true
```

Expected: `server boot ok` (or no error). It will hang waiting on stdio if it succeeds — kill it after seeing the print.

Use ctrl+c. Alternative: run `node src/server.js < /dev/null` and confirm no immediate exception.

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat(server): wire premium_chart tools (count 78 -> 88)"
```

---

### Task 6.3: Create `src/cli/commands/premium.js`

**Files:**
- Create: `src/cli/commands/premium.js`

- [ ] **Step 1: Create the CLI command file**

```javascript
import { register } from '../router.js';
import * as core from '../../core/premium_chart.js';

register('premium', {
  description: 'Premium chart types: Volume Profile, TPO, patterns, footprint, bar magnifier',
  subcommands: new Map([
    ['install-helper', {
      description: 'Install TV-MCP Helper Pine indicator (one-time bootstrap)',
      handler: () => core.installHelper(),
    }],

    ['vp-add', {
      description: 'Configure Volume Profile (variant, rows, va_pct)',
      options: {
        variant: { type: 'string', description: 'visible_range | fixed_range | session' },
        rows:    { type: 'string', description: 'Number of rows (4-200, default 24)' },
        va_pct:  { type: 'string', description: 'Value area % (0.1-0.99, default 0.7)' },
      },
      handler: (opts) => core.vpAdd({
        variant: opts.variant || 'visible_range',
        rows:    opts.rows ? Number(opts.rows) : 24,
        va_pct:  opts.va_pct ? Number(opts.va_pct) : 0.7,
      }),
    }],
    ['vp-get', {
      description: 'Read Volume Profile data (POC, VAH, VAL, bins)',
      options: {
        bins_limit: { type: 'string', description: 'Cap on bins returned (default 100)' },
      },
      handler: (opts) => core.vpGet({ bins_limit: opts.bins_limit ? Number(opts.bins_limit) : 100 }),
    }],
    ['vp-remove', {
      description: 'Remove Volume Profile helper from chart',
      handler: () => core.vpRemove(),
    }],

    ['patterns-add', {
      description: 'Add pattern studies (kinds=candlestick,harmonic,auto_fib)',
      options: {
        kinds: { type: 'string', description: 'Comma-separated: candlestick,harmonic,auto_fib' },
      },
      handler: (opts) => {
        const kinds = (opts.kinds || 'candlestick').split(',').map(s => s.trim()).filter(Boolean);
        return core.patternsAdd({ kinds });
      },
    }],
    ['patterns-list', {
      description: 'List detected patterns',
      options: {
        kinds:        { type: 'string', description: 'Comma-separated filter' },
        max_per_kind: { type: 'string', description: 'Max patterns per study (default 25)' },
      },
      handler: (opts) => core.patternsList({
        kinds: opts.kinds ? opts.kinds.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        max_per_kind: opts.max_per_kind ? Number(opts.max_per_kind) : 25,
      }),
    }],

    ['tpo-add', {
      description: 'Configure TPO mode (period_min, session, va_pct)',
      options: {
        period_min: { type: 'string', description: 'Bracket period in minutes (default 30)' },
        session:    { type: 'string', description: 'RTH | ETH (default RTH)' },
        va_pct:     { type: 'string', description: 'Value area % (default 0.7)' },
      },
      handler: (opts) => core.tpoAdd({
        period_min: opts.period_min ? Number(opts.period_min) : 30,
        session:    opts.session || 'RTH',
        va_pct:     opts.va_pct ? Number(opts.va_pct) : 0.7,
      }),
    }],
    ['tpo-get', {
      description: 'Read TPO data (letters, VA, IB, single prints)',
      handler: () => core.tpoGet(),
    }],

    ['footprint', {
      description: 'Toggle Volume Footprint chart type (--enable=true/false)',
      options: {
        enable: { type: 'string', description: 'true (switch to Footprint) | false (revert)' },
      },
      handler: (opts) => core.footprintToggle({ enable: opts.enable !== 'false' }),
    }],

    ['magnifier', {
      description: 'Toggle Bar Magnifier (--enable=true/false)',
      options: {
        enable: { type: 'string', description: 'true | false' },
      },
      handler: (opts) => core.barMagnifierToggle({ enable: opts.enable !== 'false' }),
    }],
  ]),
});
```

- [ ] **Step 2: Verify import works**

```bash
node -e "import('./src/cli/commands/premium.js').then(() => console.log('cli premium ok'))"
```
Expected: `cli premium ok`.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/premium.js
git commit -m "feat(cli): add 'tv premium' subcommands (install-helper, vp, tpo, patterns, footprint, magnifier)"
```

---

### Task 6.4: Wire premium CLI into `src/cli/index.js`

**Files:**
- Modify: `src/cli/index.js`

- [ ] **Step 1: Add import**

After the existing `import './commands/stream.js';` (last command import), add:

```javascript
import './commands/premium.js';
```

- [ ] **Step 2: Smoke test CLI help**

```bash
node src/cli/index.js --help 2>&1 | grep premium
```
Expected output line:
```
  premium     Premium chart types: Volume Profile, TPO, patterns, footprint, bar magnifier  [install-helper, vp-add, ...]
```

- [ ] **Step 3: Smoke test subcommand help**

```bash
node src/cli/index.js premium --help
```
Expected: lists all subcommands with descriptions.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.js
git commit -m "feat(cli): wire premium command group"
```

---

### Task 6.5: End-to-end smoke test against running TradingView

**Files:** none (test only)

- [ ] **Step 1: Ensure TradingView Desktop is running with `--remote-debugging-port=9222`**

```bash
node src/cli/index.js status
```
Expected: `{ "connected": true, ... }`.

- [ ] **Step 2: Run helper installation**

```bash
node src/cli/index.js premium install-helper
```
Expected: `{ "success": true, "action": "installed" or "already_installed", "study_id": "..." }`.

If failure due to compile error in Pine, fix `pine/mcp-helper.pine` syntax and retry.

- [ ] **Step 3: VP smoke test**

```bash
node src/cli/index.js premium vp-add --variant visible_range --rows 24
node src/cli/index.js premium vp-get
```
Expected on `vp-get`:
```json
{
  "success": true,
  "variant": "visible_range",
  "poc": <numeric>,
  "vah": <numeric>,
  "val": <numeric>,
  "bins": [...]
}
```

- [ ] **Step 4: Patterns smoke test**

```bash
node src/cli/index.js premium patterns-add --kinds candlestick
node src/cli/index.js premium patterns-list --kinds candlestick --max_per_kind 5
```
Expected: list of patterns (or empty `patterns: []` if none on current bars — both are valid).

- [ ] **Step 5: TPO smoke test**

```bash
node src/cli/index.js premium tpo-add --period_min 30 --session RTH
node src/cli/index.js premium tpo-get
```
Expected: TPO struct with `letter_rows`. Note: TPO needs intraday data — switch to ES1! 5min if testing on a daily chart.

- [ ] **Step 6: Footprint + Magnifier smoke**

```bash
node src/cli/index.js premium footprint --enable true
node src/cli/index.js premium footprint --enable false
node src/cli/index.js premium magnifier --enable true
```
Expected: Each returns `{success: true, ...}`. Visually confirm chart type changed and magnifier toggled.

If `VolumeFootprint` is rejected as an unknown chart type, run `tv_discover` (existing tool) to find the actual identifier, then update `FOOTPRINT_TYPE_NAME` constant in `src/core/premium_chart.js`.

- [ ] **Step 7: Commit smoke results to a notes file (optional)**

If any smoke step revealed an issue requiring fix:
```bash
git add <fixed files>
git commit -m "fix(premium): <what was fixed>"
```

---

## Phase 7 — Documentation

### Task 7.1: Update `README.md` tool count and reference table

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Bump tool count**

Find:
```
## Tool Reference (78 MCP tools)
```
Replace with:
```
## Tool Reference (88 MCP tools)
```

Find (architecture section near bottom):
```
- **Transport**: MCP over stdio (78 tools) + CLI (`tv` command, 30 commands with 66 subcommands)
```
Replace `78` with `88`.

- [ ] **Step 2: Add a Premium Chart Types section to the reference table**

After the "### Drawing, Alerts, UI Automation" subsection, insert:

```markdown
### Premium Chart Types (Ultimate)

| Tool | What it does |
|------|-------------|
| `premium_install_helper` | One-time: install `pine/mcp-helper.pine` indicator |
| `vp_add` / `vp_get` / `vp_remove` | Volume Profile (POC, VAH, VAL, bins) — variants: visible_range / fixed_range / session |
| `patterns_add` / `patterns_list` | Auto-detected candlestick, harmonic, auto-fib patterns |
| `tpo_add` / `tpo_get` | TPO Market Profile (letter rows, value area, IB, single prints) |
| `footprint_toggle` | Toggle Volume Footprint chart type |
| `bar_magnifier_toggle` | Toggle Bar Magnifier setting |
```

- [ ] **Step 3: Add row to "How Claude Knows Which Tool to Use" decision table**

After the existing rows, add:

```markdown
| "What's the value area / POC?" | `vp_add` → `vp_get` |
| "Show me detected candlestick patterns" | `patterns_add` → `patterns_list` |
| "Read the TPO profile" | `tpo_add` → `tpo_get` |
| "Switch to footprint" | `footprint_toggle` |
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(readme): document premium chart type tools (88 total)"
```

---

### Task 7.2: Update `CLAUDE.md` decision tree

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add premium chart types section**

After the "### Manage alerts" subsection, insert:

```markdown
### "Premium chart features (Volume Profile, TPO, patterns)"

**Setup (one-time per session if helper not installed):**
- `premium_install_helper` → installs `TV-MCP Helper` Pine indicator

**Volume Profile workflow:**
1. `vp_add` with `variant: "visible_range"` (or `"fixed_range"`/`"session"`) → configures helper
2. `vp_get` → returns POC, VAH, VAL, value_area_pct, bins (price/volume pairs)
3. `vp_remove` → cleanup

**Auto-pattern detection:**
1. `patterns_add` with `kinds: ["candlestick", "harmonic", "auto_fib"]` → adds built-in studies
2. `patterns_list` → returns `[{kind, name, price, bar_time}, ...]` for each detected pattern

**TPO (Market Profile):**
1. `tpo_add` with `period_min: 30, session: "RTH"`
2. `tpo_get` → letter_rows, value_area, initial_balance, single_prints

**Chart type / settings toggles:**
- `footprint_toggle { enable: true }` → Volume Footprint chart type (revert with `enable: false`)
- `bar_magnifier_toggle { enable: true }` → Bar Magnifier setting

**Important:** `vp_get`/`tpo_get` require the helper to be installed first. If they error with "TV-MCP Helper not found", call `premium_install_helper` once.
```

- [ ] **Step 2: Add premium tools to Output Size Estimates table**

After existing rows in the size table:

```markdown
| `vp_get` | ~2-4 KB (depends on `bins_limit`) |
| `tpo_get` | ~2-5 KB (depends on level count) |
| `patterns_list` | ~1-3 KB |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): add premium chart types decision tree"
```

---

### Task 7.3: Update `SETUP_GUIDE.md` with Pine helper installation note

**Files:**
- Modify: `SETUP_GUIDE.md`

- [ ] **Step 1: Read current setup guide**

```bash
node -e "import('node:fs/promises').then(fs => fs.readFile('SETUP_GUIDE.md','utf-8')).then(s => console.log(s.length))"
```

Skim the file and find a sensible insertion point (typically after "## Verify connection" or before "## Troubleshooting").

- [ ] **Step 2: Append Premium Chart Types setup section**

Insert before the troubleshooting section (or at the end, before any disclaimer/license footer):

```markdown
## Premium Chart Types (Ultimate plan only)

For Volume Profile and TPO support, install the Pine helper indicator one time:

```bash
node src/cli/index.js premium install-helper
```

Or in Claude Code:
> "Run premium_install_helper"

This pastes `pine/mcp-helper.pine` into your Pine editor, compiles it, saves it as `TV-MCP Helper`, and adds it to your chart. The helper emits Volume Profile and TPO data as a table that the MCP server reads.

**Manual fallback:** if the bootstrap fails (Pine compile error, etc.), open `pine/mcp-helper.pine`, copy contents, paste into the Pine editor in TradingView, save as `TV-MCP Helper`, add to chart.

**Cleanup:** to remove, use `vp_remove` MCP tool or remove `TV-MCP Helper` indicator manually.
```

- [ ] **Step 3: Commit**

```bash
git add SETUP_GUIDE.md
git commit -m "docs(setup): document Pine helper installation for premium features"
```

---

### Task 7.4: Update `package.json` test script to include new test file

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `tests/premium_chart.test.js` to `test` and `test:all` scripts**

Find:
```json
"test": "node --test tests/e2e.test.js tests/pine_analyze.test.js",
```
Replace with:
```json
"test": "node --test tests/e2e.test.js tests/pine_analyze.test.js tests/premium_chart.test.js",
```

Find:
```json
"test:all": "node --test tests/e2e.test.js tests/pine_analyze.test.js tests/cli.test.js",
```
Replace with:
```json
"test:all": "node --test tests/e2e.test.js tests/pine_analyze.test.js tests/cli.test.js tests/premium_chart.test.js",
```

- [ ] **Step 2: Run full test suite**

```bash
npm run test:unit
```
Expected: All tests pass.

```bash
npm test
```
Expected: All tests pass (e2e tests skipped or pass depending on TV running).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: include premium_chart.test in npm test scripts"
```

---

## Phase 8 — Final integration check

### Task 8.1: Acceptance criteria walkthrough

**Files:** none

- [ ] **Step 1: Verify acceptance criteria from spec section 13**

Run each check from `docs/superpowers/specs/2026-05-09-epic1-premium-chart-types-design.md` Section 13:

```bash
# 1. All tools registered
node src/cli/index.js premium --help
# Should list 9 subcommands.

# 2. tv_discover lists new tools (requires TV running)
node src/cli/index.js discover | grep -E "vp_|patterns_|tpo_|footprint|magnifier|premium_install"

# 3. Helper bootstrap end-to-end
node src/cli/index.js premium install-helper

# 4. Documented examples from spec Section 8 work end-to-end
node src/cli/index.js premium vp-add --variant visible_range
node src/cli/index.js premium vp-get
node src/cli/index.js premium patterns-add --kinds candlestick
node src/cli/index.js premium patterns-list

# 5. Tests pass
npm test

# 6. README count updated to 88
grep "Tool Reference (88 MCP tools)" README.md

# 7. CLAUDE.md decision tree includes premium section
grep -i "Premium chart features" CLAUDE.md
```

- [ ] **Step 2: Resolve open questions from spec Section 12**

- [ ] OQ1: Pine helper packaging confirmed as single indicator with `mode` switch (built that way in Task 0.1).
- [ ] OQ2: `ta.vvp()` not used — manual bin aggregation implemented in Task 0.2 instead. Update spec Section 7 to reflect: "uses manual hlc3-weighted bin aggregation, not ta.vvp()".
- [ ] OQ3: Chart type identifier — verify `VolumeFootprint` works in Task 6.5 Step 6. If not, update `FOOTPRINT_TYPE_NAME` constant.

Update spec to note resolutions:
```bash
# Edit docs/superpowers/specs/2026-05-09-epic1-premium-chart-types-design.md
# Section 12 — mark each OQ as resolved with the chosen value.
```

- [ ] **Step 3: Final commit**

```bash
git add docs/superpowers/specs/2026-05-09-epic1-premium-chart-types-design.md
git commit -m "docs(spec): resolve open questions OQ1-OQ3 from Epic 1 implementation"
```

- [ ] **Step 4: Merge or PR**

If working on a feature branch:
```bash
git checkout main || git checkout master
git merge epic1-premium-chart-types --no-ff -m "Epic #1: Premium chart types (Volume Profile, TPO, patterns, footprint, magnifier)"
```

Or if a remote is configured:
```bash
git push -u origin epic1-premium-chart-types
# then open PR via gh or web UI
```

---

## Risks and rollback

| Risk | Mitigation |
|---|---|
| Pine helper fails to compile due to v5 syntax error in plan code | Tasks 0.2 + 0.3 include manual smoke test step. Fix syntax inline; spec is approximate, real compiler is the source of truth. |
| `VolumeFootprint` enum value wrong | Task 6.5 Step 6 catches this; resolution recorded in OQ3. |
| `setInputs` cannot set string-enum input on indicator (`vp_variant`, `tpo_session`) | Fall back to using a numeric enum input in the Pine helper (`int 0/1/2`) and have the JS layer map. |
| Bar Magnifier property tree path wrong | The implementation walks the settings tree; if not found, error is explicit. User can fall back to manual UI toggle. |
| Pine table rows > 210 cap (TPO with high tick density) | Helper clamps `levels` to 200 (`int(math.min(200.0, ...))`). For symbols with very wide ranges, levels widen automatically. |

To roll back the entire epic:
```bash
git checkout main
git branch -D epic1-premium-chart-types
# Or revert specific commits if already merged.
```

---

## Self-review (run by plan author before handoff)

**Spec coverage:**
- [x] Tool 6.1 `vp_add` — Task 2.1
- [x] Tool 6.2 `vp_get` — Task 2.2
- [x] Tool 6.3 `vp_remove` — Task 2.3
- [x] Tool 6.4 `patterns_add` — Task 3.1
- [x] Tool 6.5 `patterns_list` — Task 3.2
- [x] Tool 6.6 `tpo_add` — Task 4.1
- [x] Tool 6.7 `tpo_get` — Task 4.2
- [x] Tool 6.8 `footprint_toggle` — Task 5.1
- [x] Tool 6.9 `bar_magnifier_toggle` — Task 5.2
- [x] Pine helper indicator — Task 0.1, 0.2, 0.3
- [x] Bootstrap installer — Task 1.4 + tool `premium_install_helper` (Task 6.1)
- [x] Error-handling table — covered by per-task tests
- [x] Schema sanitization — uses `_format.js` `jsonResult` (Task 6.1)
- [x] README + CLAUDE.md updates — Tasks 7.1 + 7.2
- [x] SETUP_GUIDE.md update — Task 7.3
- [x] Acceptance criteria check — Task 8.1

**Placeholder scan:** No "TBD", "fill in", "etc." in actionable steps. Pine code is full; JS code is full.

**Type consistency:** All function names match (`vpAdd`/`vp_add` etc.), `_resolve` deps shape consistent across tasks.

**Note:** Tool count went from spec-stated "9 new tools" to 10 because the bootstrap (`premium_install_helper`) is its own tool — the spec described it as a CLI bootstrap rather than an MCP tool, but exposing it as an MCP tool is consistent with the rest of the codebase. Spec to be updated in Task 8.1.
