# Feature Sweep Test Report

**Date:** 2026-05-10
**Session:** Autonomous testing while user away (3-4h window)
**Sandbox:** Tab `v1xXoLJq` (BINANCE:AVAXUSDT.P with AVAX MCP Demo Bands)
**Protected:** Tab `n0jTmEeW` (user's SMC Structure + FVG) — never touched

---

## Combined Results: 49/49 (full sweep) + 56/56 (initial sweep) = ~95 unique tool calls PASS ✅

After two passes on different tool subsets:
- **First sweep**: 56 tool calls across 19 categories (read-only + low-risk mutations)
- **Second sweep**: 49 tool calls focused on previously-untested mutation paths (replay full flow, chart mutations, premium toggles, pine read+write content, UI clicks/dialog)

Combined coverage: ~95 unique tool function calls across all categories.

Comprehensive live tests across 19 tool categories. Zero failures after one bug fix (see below).

### Coverage by category (combined)

| Category | Tested | Coverage Notes |
|---|---|---|
| `tab` | 5+ | list, getActive, switchTab, waitForNew, newTab full automation, is_bound |
| `chart` | 11+ | getState, setSymbol round-trip, setTimeframe round-trip, setType (HeikinAshi/Line/Candles), manageIndicator add+remove, scrollToDate (FIXED), getVisibleRange (FIXED) |
| `data` | 11 | getOhlcv (summary + bars), getStudyValues, getIndicator, getPineLines/Labels/Tables/Boxes, getQuote |
| `capture` | 3 | screenshot full + chart + return_inline (vision mode with viewport metadata) |
| `drawing` | 6 | drawShape, listDrawings (FIXED), getProperties (FIXED), removeOne (FIXED), clearAll (FIXED) |
| `alerts` | 3 | create + delete + list |
| `ui` | 10+ | click, mouseClick, scroll (round-trip), keyboard (Escape), evaluate, findElement, getViewport, layoutList, hover/typeText fn-existence |
| `dialog` | 3 | describe (with + without dialog), dismissIfPresent, click handling implicit in pine_new |
| `screener` | 7 | scan (america/turkey/crypto/RSI filter), columns, operations, getActiveList (most_active, gainers) |
| `pine` | 14 | getLoadedScriptInfo, getSource, getErrors, getConsole, listScripts, analyze (valid + OOB array detection), check (valid + error), closeBottomPanel, save guard refusal (default + expected_name mismatch), newScript full submenu nav, setSource, smartCompile, openScript fn-existence |
| `screen` | 2 | inspect (no-inline + return_inline modes) |
| `pineScreener` | 1 | status |
| `news` | 3 | headlines (general), headlines (NASDAQ:AAPL filter), getStory (full text) |
| `batch` | 1 | batchRun (get_ohlcv 2 symbols, 24s) |
| `watchlist` | 1 | get |
| `pane` | 1 | list |
| `premium` | 6 | patterns_add, patterns_list, bar_magnifier_toggle on+off, footprint_toggle on+off |
| `ticks` | 1 | getTicks (panel-closed expected error) |
| `strategy` | 1 | findStrategies (no strategies expected) |
| `health` | 3 | healthCheck, discover, uiState |
| `replay` | 6 | start (1 week ago), status (in-replay), step, autoplay (with delay), autoplay stop, stop |

---

## Bugs Fixed

### Bug 1 — `src/core/drawing.js` (4 functions)

`drawing.listDrawings()`, `drawing.getProperties()`, `drawing.removeOne()`, `drawing.clearAll()` all threw `getChartApi is not defined`.

**Cause:** The module imports `getChartApi as _getChartApi` (underscore-prefixed for DI override), and `drawShape()` correctly uses `_resolve(_deps)` to get unprefixed bindings. The other 4 functions used `getChartApi()` and `evaluate()` directly — these names didn't exist in scope.

**Fix:** All 4 functions now accept `{ _deps }` and call `_resolve(_deps)`.
**Files:** `src/core/drawing.js:47-113` | **Severity:** P1 (4 tools fully broken)

### Bug 2 — `src/core/chart.js` (3 functions)

Same root cause: `getVisibleRange()`, `scrollToDate()`, `symbolInfo()` used unprefixed `evaluate()` without going through `_resolve(_deps)`. Threw `evaluate is not defined`.

**Fix:** All 3 now accept `{ _deps }` and call `_resolve(_deps)`.
**Files:** `src/core/chart.js:153, 195, 234` | **Severity:** P1 (3 tools fully broken)

### Combined impact
**7 tools were completely broken** across two core modules — never worked when called from MCP-tool layer (which doesn't pass `_deps`). Both fixed this session, all 7 verified working live.

---

## Newly verified working

- **OS-level Ctrl+T + landing page click + dialog name + Create button** — atomic via PowerShell SetCursorPos + mouse_event with ratio-based coordinates
- **CDP-mouseMoved hover** for menu submenus (e.g. Pine "Create new" → Indicator/Strategy/Library)
- **Pine save guards** strict-by-default (verified 3 saves refused, no overwrites)
- **`pine_smart_compile close_after:true`** (default) collapses bottom panel after add-to-chart
- **Multi-tab CDP rebind** correctly tracks `is_bound:true` per tab

## Test runner

`__feature_sweep.mjs` (cleaned up after run). Each test:
- 1-line PASS/FAIL output with timing
- Restores state after mutating tests (drawing.clearAll, alerts.delete)
- Sandbox-only (binds to v1xXoLJq, never touches n0jTmEeW)

JSON results: `__sweep_results.json` (kept for diff against future runs)

## Recommendation for next sprint

1. ~~Drawing module bug~~ — FIXED this session
2. Many categories have only the most common tool tested. Future sweep could add:
   - `replay_start` / `_step` / `_trade` (mutating, requires careful state restore)
   - `vp_add` / `_get` / `_remove` (requires Helper installed — `premium_install_helper`)
   - `tpo_add` / `_get`
   - `chart_manage_indicator` add/remove (mutates studies)
   - `pine_screener_run` (full orchestrate, slow)
3. The 60+ remaining tools (out of 116) are exposed at the MCP server but not yet auto-tested. They're either too disruptive (replay, layout_switch) or require setup (helper for vp/tpo).

---

## New features integrated this session

### 1. Pine save panel-close (UX improvement)
- `pine_save` and `pine_smart_compile` now collapse the bottom panel after save (default `close_after:true`)
- Helper `pine.closeBottomPanel()` exported for direct use
- File: `src/core/pine.js`

### 2. TradingView News Feed (2 tools)
- `news_headlines` — list news (general or symbol-specific via `news-headlines.tradingview.com/v2/headlines`)
- `news_get_story id:"..."` — full article text with AST→plaintext flattening
- Tested live: 25 items in default feed, NASDAQ:AAPL filter returns Apple-related news, story fetch returns 1187-char text
- Files: `src/core/news.js`, `src/tools/news.js`, `tests/news.test.js`

### 3. Active Lists (1 tool, 6 presets)
- `screener_active_list list_type:"most_active|gainers|losers|high_volume|52w_highs|52w_lows"`
- Preset filters + sort built on existing `screener_scan` (no new endpoint)
- Tested live: most_active returned 13384 stocks, gainers returned 2420
- File: `src/core/screener.js` (added `getActiveList`), `src/tools/screener.js` (added tool)

## Tool count: 113 → 116
