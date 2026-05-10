# Epic #3a — Strategy Tester deep control

**Date:** 2026-05-10
**Status:** Draft (awaiting user review)
**Owner:** TradingView MCP maintainer
**Parent program:** TradingView Ultimate parity. Epic #3 was decomposed into:
- **#3a (this spec)**: settings + performance tabs + Deep Backtest toggle
- **#3b (deferred)**: Walk-Forward + Strategy Optimizer (separate spec when started)

---

## 1. Background

After Epics #1 and #2 the MCP exposes 89 tools. Strategy-related coverage today is read-only and shallow:

| Tool | Source | Coverage |
|---|---|---|
| `data_get_strategy_results` | `core/data.js` | Top-level metrics from `study.reportData()` |
| `data_get_trades` | `core/data.js` | Trade list (max 20) |
| `data_get_equity` | `core/data.js` | Equity curve points |

Missing for an LLM to actually drive a backtest:
- Read & write strategy settings (initial capital, commission, slippage, pyramiding)
- Read all three Strategy Tester tabs (Performance / Trades Analysis / Risk Ratios) as structured data
- Toggle Deep Backtest mode (Premium feature — re-runs each bar with lower-timeframe data for accurate fills)
- Choose which strategy is active when multiple are on chart

This epic adds 8 strategy-domain tools that close those gaps without disturbing the existing 3 read tools.

## 2. Goals

- Discover and enumerate strategies on the active chart.
- Read and write strategy properties (capital, commission, slippage, pyramiding, margin).
- Toggle Deep Backtest mode for the active strategy.
- Read the three Strategy Tester tabs as structured JSON.
- Maintain mode parity: every tool also a `tv strategy …` CLI subcommand.
- Stay within existing CDP-only architecture; no new dependencies.

## 3. Non-goals

- **Walk-Forward optimization** — Epic #3b.
- **Strategy Optimizer (parameter sweep)** — Epic #3b.
- **Live broker order placement** — Epic #10 (deferred indefinitely).
- **Adding new strategies** — `chart_manage_indicator` already adds Pine indicators by name; no need to specialize for strategies.

## 4. Architecture

```
Claude Code
  └── MCP server (stdio)
       └── src/tools/strategy.js       [NEW — 8 tool registrations]
            └── src/core/strategy.js   [NEW — CDP business logic]
                 ├── reuses data.js {getStrategyResults, getTrades, getEquity} where applicable
                 └── chrome-remote-interface
                      └── TradingView Desktop (Electron, port 9222)
                           └── strategy study via mainSeries.model().model().dataSources()
                                ├── study.metaInfo() — name, is_strategy
                                ├── study.properties().childs() — settings tree
                                ├── study.reportData() / study.performance() — backtest output
                                └── chart property tree — Deep Backtest setting (path probe-pending)
```

The existing `data_get_strategy_results` etc. stay where they are. `core/strategy.js` adds wrappers that filter to a specific strategy (when multiple are on chart) and adds new read paths for the trades-analysis and risk-ratios tabs.

## 5. File layout

| Path | Change |
|---|---|
| `src/core/strategy.js` | New — ~250 LoC, exports the 8 functions |
| `src/tools/strategy.js` | New — MCP registrations with Zod schemas |
| `src/cli/commands/strategy.js` | New — `tv strategy <subcommand>` |
| `src/server.js` | Modify — register `registerStrategyTools` |
| `src/cli/index.js` | Modify — import `commands/strategy.js` |
| `tests/strategy.test.js` | New — settings parser + metric extractor + multi-strategy locator |
| `package.json` | Modify — append new test file to scripts |

## 6. Tool specifications

### 6.1 `strategy_list`

Lists all strategies currently on the chart (filters indicators where `metaInfo().is_strategy === true` or which expose `reportData`).

**Input:** none.
**Output:**
```json
{
  "success": true,
  "count": 1,
  "strategies": [
    { "entity_id": "st_X1Y2", "name": "RSI Strategy" }
  ]
}
```

### 6.2 `strategy_get_settings`

Read all properties of a strategy.

**Input:**
- `entity_id`: optional — if omitted, uses the first strategy on chart.

**Output:**
```json
{
  "success": true,
  "entity_id": "st_X1Y2",
  "settings": {
    "initial_capital": 10000,
    "default_qty_type": "percent_of_equity",
    "default_qty_value": 100,
    "commission_type": "percent",
    "commission_value": 0.075,
    "slippage": 1,
    "pyramiding": 0,
    "margin_long": 0,
    "margin_short": 0
  },
  "raw_property_keys": ["..."]
}
```

`raw_property_keys` is included for debugging — the full list of property names TV exposes on the strategy. Settings whose internal names don't map to known canonical fields are skipped (with their raw key listed).

### 6.3 `strategy_set_settings`

Write settings on a strategy. Partial updates supported.

**Input:**
- `entity_id`: optional (defaults to first strategy)
- `settings`: object with any of these keys (Zod-validated):
  - `initial_capital: number` (≥ 0)
  - `default_qty_type: "fixed" | "percent_of_equity" | "cash"`
  - `default_qty_value: number` (≥ 0)
  - `commission_type: "percent" | "cash_per_order" | "cash_per_contract"`
  - `commission_value: number` (≥ 0)
  - `slippage: integer` (≥ 0)
  - `pyramiding: integer` (≥ 0)
  - `margin_long: number` (0–100)
  - `margin_short: number` (0–100)

**Output:**
```json
{
  "success": true,
  "entity_id": "st_X1Y2",
  "applied": { "commission_value": 0.1 },
  "skipped": [],
  "current_settings": { ... }
}
```

### 6.4 `strategy_deep_backtest_toggle`

Toggle Deep Backtest mode (Premium/Ultimate feature) on the active strategy.

**Input:**
- `enable`: boolean (default `true`)
- `entity_id`: optional

**Output:** `{ success: true, enabled: boolean }`

**Implementation note:** Bar Magnifier had no exposed property tree path (Epic #1 documented this). Deep Backtest may have the same limitation. The implementation walks the strategy's properties tree for `*deep*backtest*`, `*deepbacktest*`, `*useDeepBacktest*` keys; if none found, returns `{success:false, error:"Deep Backtest property not found in this TV version"}`.

### 6.5 `strategy_get_performance_summary`

Performance Summary tab metrics — wraps existing `getStrategyResults` and normalizes the field set:

**Input:** `entity_id` optional.
**Output:**
```json
{
  "success": true,
  "entity_id": "st_X1Y2",
  "metrics": {
    "net_profit": 1234.56,
    "net_profit_pct": "12.35%",
    "gross_profit": 2345.0,
    "gross_loss": -1110.4,
    "total_trades": 42,
    "winning_trades": 25,
    "losing_trades": 17,
    "percent_profitable": "59.52%",
    "max_drawdown": -456.78,
    "max_drawdown_pct": "-4.57%",
    "buy_hold_return": 234.5,
    "buy_hold_return_pct": "2.35%"
  },
  "raw": { ...full reportData() object... }
}
```

### 6.6 `strategy_get_trades_analysis`

Trades Analysis tab metrics. TradingView's strategy reportData typically nests these under a separate sub-object (probe required to confirm exact field path).

**Input:** `entity_id` optional.
**Output:**
```json
{
  "success": true,
  "entity_id": "st_X1Y2",
  "metrics": {
    "avg_trade": 29.4,
    "avg_winning_trade": 93.8,
    "avg_losing_trade": -65.3,
    "ratio_avg_win_loss": 1.44,
    "largest_winning_trade": 425.0,
    "largest_losing_trade": -250.5,
    "max_consecutive_wins": 6,
    "max_consecutive_losses": 4,
    "avg_bars_in_winning_trade": 12.3,
    "avg_bars_in_losing_trade": 8.7
  }
}
```

Fields not present in the source object are omitted (no zero-fills).

### 6.7 `strategy_get_risk_ratios`

Risk-Performance Ratios tab.

**Input:** `entity_id` optional.
**Output:**
```json
{
  "success": true,
  "entity_id": "st_X1Y2",
  "metrics": {
    "sharpe_ratio": 1.42,
    "sortino_ratio": 2.01,
    "profit_factor": 2.11,
    "calmar_ratio": 0.85,
    "recovery_factor": 3.04,
    "max_drawdown": -456.78,
    "max_drawdown_pct": "-4.57%"
  }
}
```

### 6.8 `strategy_set_active`

When multiple strategies are on chart, choose which one the Strategy Tester displays.

**Input:** `entity_id` (required).
**Output:** `{ success: true, active_entity_id: "st_X1Y2" }`

**Implementation note:** TradingView's "active strategy" concept may not exist in older versions — instead, the Tester might always show the first / most recent strategy. If the underlying API call (e.g., `chart.setActiveStudy(id)`) is unavailable, this returns `{success:false, error:"Active-strategy selection not supported in this TV version. Tester shows the most recent strategy automatically."}`.

## 7. Data flow examples

**Example A — Backtest tuning:**
```
LLM: "What's my current commission and total trades?"
  → strategy_list → [{entity_id:"st_X", name:"RSI Strategy"}]
  → strategy_get_settings(entity_id:"st_X") → settings.commission_value: 0.075
  → strategy_get_performance_summary() → metrics.total_trades: 42

LLM: "Set commission to 0.1% and re-check"
  → strategy_set_settings({entity_id:"st_X", settings:{commission_value: 0.1}})
  → strategy_get_performance_summary() → metrics.net_profit dropped from 1234 to 1180
```

**Example B — Deep Backtest comparison:**
```
LLM: strategy_get_performance_summary()       → metrics.net_profit: 1234
     strategy_deep_backtest_toggle(enable=true)
     strategy_get_performance_summary()       → metrics.net_profit: 1187 (LTF rebacktest more accurate)
```

**Example C — Risk view:**
```
LLM: strategy_get_risk_ratios() → {sharpe: 1.42, sortino: 2.01, profit_factor: 2.11}
LLM responds: "Sharpe 1.42 = decent, Sortino > Sharpe means downside-skewed returns are not the issue."
```

## 8. Error handling

| Condition | Response |
|---|---|
| No strategy on chart | `{success:false, error:"No strategy on chart. Add a Pine strategy first."}` |
| Multiple strategies, no `entity_id` provided | Defaults to first; result includes `defaulted_to: "st_X"` field |
| Unknown setting key | `{success:false, error:"Unknown setting: xyz. Allowed: <list>"}` |
| Setting value out of range | Zod schema validation rejects at MCP boundary |
| Deep Backtest property not found | `{success:false, error:"Deep Backtest property not found in this TV version"}` |
| Set settings TV API rejects | `{success:false, error:"TV rejected setting change: <message>"}` |
| `set_active` not supported | `{success:false, error:"Active-strategy selection not supported in this TV version"}` |

## 9. Testing strategy

**Unit (no TV needed):**
- `tests/strategy.test.js`:
  - `parseSettingsTree` — given a fake `properties().childs()` shape, extracts canonical setting names
  - `findStrategyByEntityId` / `findFirstStrategy` — locator helpers
  - `extractPerformanceSummary`, `extractTradesAnalysis`, `extractRiskRatios` — given fake reportData objects, normalize fields

**E2E live (TV with strategy on chart):**
- Add a built-in strategy (e.g., "RSI Strategy" pine template) to chart
- `strategy_list` returns it
- `strategy_get_settings` returns initial_capital=10000 (TV default)
- `strategy_set_settings({commission_value: 0.1})` then `strategy_get_settings` shows the change
- `strategy_get_performance_summary`, `_trades_analysis`, `_risk_ratios` each return non-empty metrics

**Manual / acceptance:**
- All Section 7 examples produce reasonable output on Ultimate-tier account.

## 10. Open questions (implementation will resolve)

1. **Strategy property internal field names** — TradingView uses internal property names like `pyramidingProperty`, `commission.value`, `defaultQtyValue` etc. Live probe required to map canonical names ↔ TV keys.
2. **Performance tabs source object structure** — does `reportData()` contain all three tabs' data, or are they on separate objects (e.g., `tradesData`, `riskData`)?
3. **Deep Backtest property path** — likely under `study.properties().childs()` somewhere; specific key name unknown.
4. **Multi-strategy active-selection API** — `chart.setActiveStudy(id)` or similar. May be unavailable; tool degrades gracefully.

These are similar in nature to Epic #1's Open Questions (which were resolved during smoke testing). Plan should include a controller-driven probe phase before implementation tasks.

## 11. Acceptance criteria

- [ ] `strategy_list` returns at least one strategy when one is on chart.
- [ ] `strategy_get_settings` returns canonical fields for a built-in Pine strategy.
- [ ] `strategy_set_settings` mutation visible via subsequent `strategy_get_settings`.
- [ ] `strategy_get_performance_summary` returns non-zero metrics for a strategy with executed trades.
- [ ] `strategy_get_trades_analysis` returns avg_trade and consecutive-win/loss fields.
- [ ] `strategy_get_risk_ratios` returns Sharpe + Profit Factor.
- [ ] `strategy_deep_backtest_toggle` either toggles successfully or returns the documented "not found" error.
- [ ] `strategy_set_active` either selects successfully or returns the documented "not supported" error.
- [ ] Existing 89 tools still work (regression-free).
- [ ] Unit tests pass via `npm test`.
- [ ] README + CLAUDE.md decision tree updated.
- [ ] Tool count: 89 → 97 (8 new).
