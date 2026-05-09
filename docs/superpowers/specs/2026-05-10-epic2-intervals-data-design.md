# Epic #2 — Custom Intervals + Extended Data

**Date:** 2026-05-10
**Status:** Draft (awaiting user review)
**Owner:** TradingView MCP maintainer
**Parent program:** TradingView Ultimate parity (8 epics remaining after #1)

---

## 1. Background

Epic #1 added 10 premium-chart tools. Epic #2 closes Ultimate's data-access gap:

| Ultimate feature | Currently |
|---|---|
| Second-based intervals (1s, 5s, 30s) | Not supported — `chart_set_timeframe` rejects sub-minute strings |
| 40,000-bar history | Capped at 500 bars (`MAX_OHLCV_BARS = 500`) |
| Tick-by-tick data | No tool exposes Time & Sales / trade prints |
| Custom non-standard intervals (7m, 13m) | **Out of scope** (skipped per user prioritization) |

Without these, an LLM agent on an Ultimate plan cannot do scalping analysis (sub-minute resolutions), deep backtesting (40k+ bars), or order-flow inspection (tick stream). Epic #2 unlocks all three with minimal API changes — extending two existing tools and adding one new tool.

## 2. Goals

- Accept second-based resolution strings (`"1S"`, `"5S"`, `"30S"`) in `chart_set_timeframe` with clear error if symbol doesn't support seconds.
- Allow `data_get_ohlcv { count }` up to 40000 bars; transparently load history if chart hasn't cached enough.
- Add `data_get_ticks` — read recent tick prints from TradingView's Time & Sales panel.
- Maintain mode parity: every change reflected in CLI (`tv` command).
- Stay within existing CDP-only architecture; no new dependencies.

## 3. Non-goals

- **Custom non-standard intervals (7m, 13m, etc.)** — explicitly dropped during scope review.
- **Aggregating ticks into volume profiles** — Epic #1 covers Volume Profile already.
- **Real broker / order placement** — Epic #10 (deferred).
- **Tick replay** — historical tick playback is a separate request.

## 4. Architecture

```
Claude Code
  └── MCP server (stdio)
       ├── src/tools/chart.js          [unchanged registration; chart.js core gets validation update]
       ├── src/tools/data.js           [unchanged registration; data.js core gets count limit + history loader]
       └── src/tools/ticks.js          [NEW — registers data_get_ticks]
            └── src/core/ticks.js      [NEW — reads Time & Sales widget via CDP]
       └── chrome-remote-interface
            └── TradingView Desktop (Electron, port 9222)
                 ├── chart.setResolution("1S")   ← second-based
                 ├── mainSeries.bars().requestMoreBars()  ← history loader (probe-pending)
                 └── Time & Sales panel DOM       ← tick source (probe-pending)
```

## 5. File layout

| Path | Change |
|---|---|
| `src/core/chart.js` | Modify — `setTimeframe` validation regex + post-call verification |
| `src/core/data.js` | Modify — bump `MAX_OHLCV_BARS` to 40000, add `_loadHistoryUntil(target)` helper |
| `src/core/ticks.js` | New — `getTicks({ limit, since })`, ~120 LoC |
| `src/tools/ticks.js` | New — MCP tool registration, ~30 LoC |
| `src/cli/commands/ticks.js` | New — `tv ticks <opts>` subcommand |
| `src/server.js` | Modify — register `registerTickTools` |
| `src/cli/index.js` | Modify — import `commands/ticks.js` |
| `tests/intervals.test.js` | New — timeframe regex validation tests |
| `tests/ticks.test.js` | New — tick parser tests against fixture cells |
| `tests/data_ohlcv.test.js` | New — count limit + partial-return tests |

## 6. Tool specifications

### 6.1 `chart_set_timeframe` (modified — no schema change)

**Input** (unchanged):
- `timeframe`: string

**New behavior:**
- Accept regex `^(\d+S|\d+|D|W|M)$` (was `^(\d+|D|W|M)$`)
- After `setResolution`, read back `mainSeries().interval()` and compare. If TV silently dropped the change (e.g., symbol does not support seconds):
  - Return `{ success: false, error: "Symbol does not support {requested} resolution. Try a higher timeframe." }`

**Output** (unchanged): `{ success: boolean, timeframe: string, chart_ready: boolean }`

### 6.2 `data_get_ohlcv` (modified — no schema change)

**Input** (unchanged): `count`, `summary`, etc.

**New behavior:**
- `count` upper bound: 500 → 40000 (cap unchanged from input — schema's `.max(40000)` enforced)
- If `bars().size() < count`:
  1. Call internal `_loadHistoryUntil(count)` helper
  2. Helper calls TV's history-loading API (exact API name probed — see Section 10 OQ1)
  3. Poll `bars().size()` every 500 ms; stop when reached or 30 s timeout
  4. If timeout with insufficient bars: still return what's available + `{ partial: true, requested, returned }`

**Output:** existing shape + new optional fields when partial:
```json
{ "success": true, "bars": [...], "bar_count": 18234, "partial": true, "requested": 40000, "returned": 18234 }
```

### 6.3 `data_get_ticks` (NEW)

Reads recent tick prints from TradingView's Time & Sales widget.

**Input:**
- `limit`: integer 1..500, default 50
- `since`: optional ISO 8601 timestamp string — only return ticks with `time >= since`

**Output:**
```json
{
  "success": true,
  "tick_count": 47,
  "panel_open": true,
  "ticks": [
    { "time": "2026-05-10T13:30:01.234Z", "price": 93.45, "size": 0.5, "side": "buy" },
    { "time": "2026-05-10T13:30:00.998Z", "price": 93.44, "size": 1.2, "side": "sell" }
  ]
}
```

**Behavior:**
- Detect whether the Time & Sales panel is open (panel root selector probe).
- If not open: best-effort auto-open via either an existing UI primitive (if `ui_open_panel` supports the panel name — TBD probe) or a direct DOM click on the panel-toggle button. If neither works, return `{success:false, error:"Open Time & Sales panel manually"}`.
- Read tick rows from the panel's DOM via CDP evaluate.
- Parse rows into `{ time, price, size, side }` (raw field names probed — see Section 10 OQ2).
- Filter by `since` after parse, cap at `limit`.

## 7. Data flow examples

**Example A — Sub-minute scalp setup:**
```
LLM: "Show me last 5 minutes of 5-second bars"
LLM: chart_set_timeframe(timeframe="5S")
     → { success: true, timeframe: "5S" }
LLM: data_get_ohlcv(count=60, summary=false)
     → 60 bars × 5s = 5 minutes of data
```

**Example B — Deep history backtest:**
```
LLM: data_get_ohlcv(count=10000, summary=true)
     → bars().size() = 1500, triggers _loadHistoryUntil(10000)
     → polls 30s, reaches 10000
     → { success: true, bar_count: 10000, period: {...}, partial: false }
```

**Example C — Tick analysis:**
```
LLM: data_get_ticks(limit=20)
     → opens Time & Sales panel if needed
     → returns last 20 prints with side/size
LLM observes: 18 buys, 2 sells in last 20 ticks → bullish microstructure
```

## 8. Error handling

| Condition | Response |
|---|---|
| Sub-minute on non-intraday symbol (e.g., daily-only) | `{success:false, error:"Symbol does not support 1S resolution. Try a higher timeframe."}` |
| `count > 40000` | Schema rejects at MCP boundary |
| 40k history timeout | Partial return: `{success:true, partial:true, requested, returned}` |
| Time & Sales panel cannot open (UI changed) | `{success:false, error:"Cannot open Time & Sales panel — UI may have changed"}` |
| `since` ISO parse failure | `{success:false, error:"Invalid 'since' timestamp"}` |
| Tick parse: empty rows | `{success:true, tick_count:0, panel_open:true, ticks:[]}` |

## 9. Testing strategy

**Unit (no TV needed):**
- `tests/intervals.test.js` — regex acceptance: 1S, 5S, 30S, 15, 60, D, W, M; rejection: 1.5, X, empty
- `tests/data_ohlcv.test.js` — `_loadHistoryUntil` fake CDP returning growing bar count, asserts polling + partial-return logic
- `tests/ticks.test.js` — fixture DOM rows → parsed `{time, price, size, side}`; `since` filter; `limit` cap

**E2E live (TV running with Time & Sales panel):**
- `chart_set_timeframe("5S")` on BINANCE:BTCUSDT → roundtrip, OHLCV reads 5-second bars
- `data_get_ohlcv(count=10000)` on intraday symbol → confirms history load + bar_count
- `data_get_ticks(limit=10)` while market is active → returns 10 recent prints with non-null fields

**Manual / acceptance:**
- All examples in Section 7 produce expected output on Ultimate-tier account.

## 10. Open questions (implementation will resolve)

1. **`requestMoreBars` API name and signature** — TradingView's internal API for forcing history load. Candidates: `mainSeries().requestMoreBars(N)`, `chart.requestMoreData()`, `bars().requestRange(from, to)`. Live probe required during Phase 1 of implementation.
2. **Time & Sales widget DOM path + raw field names** — Selector for the panel root, row element class, field accessors for time/price/size/side. Live probe + diff against open/closed states.
3. **Sub-minute resolution acceptance per symbol type** — TV's per-exchange `has_seconds` flag values (BINANCE crypto, NYSE equities, FX brokers). Live test on 3-4 symbols during smoke phase.

## 11. Acceptance criteria

- [ ] `chart_set_timeframe("1S")` succeeds on a crypto symbol; rejects with clear error on a daily-only symbol.
- [ ] `data_get_ohlcv(count=10000)` returns 10k bars on a sufficiently old crypto symbol; returns partial:true with warning on shorter-history symbols.
- [ ] `data_get_ticks(limit=20)` returns 20 well-formed tick records during active market hours.
- [ ] All existing 88 tools still work (regression-free).
- [ ] Unit tests pass via `npm test`.
- [ ] README + CLAUDE.md decision tree updated for the new sub-minute / 40k / tick capabilities.
- [ ] SETUP_GUIDE.md notes Time & Sales panel must be available (Premium/Ultimate).
- [ ] Tool count: 88 → 89 (only `data_get_ticks` is new; the others are extensions).
