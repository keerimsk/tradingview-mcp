# Epic #1 — Premium Chart Types

**Date:** 2026-05-09
**Status:** Draft (awaiting user review)
**Owner:** TradingView MCP maintainer
**Parent program:** TradingView Ultimate parity (9-epic decomposition)

---

## 1. Background

The `tradingview-mcp` server currently exposes 78 MCP tools that cover symbol/timeframe control, Pine Script development, replay, drawing, multi-pane layouts, watchlists, and basic alerts. This is the first epic in a 9-epic program to bring the server to feature-parity with the TradingView Ultimate plan.

Ultimate plan exposes a class of "premium chart types and analytical visuals" that are not currently addressable by the MCP server in a structured-data way. Concretely:

| Feature | Currently |
|---|---|
| Volume Profile (VRVP / FRVP / Session) | No structured POC/VAH/VAL/bins read |
| Footprint chart | Not toggleable from MCP |
| TPO (Time Price Opportunity) | No data path |
| Auto-detected patterns (candlestick / harmonic / auto-fib) | Indicator can be added by name, but pattern list is not parsed |
| Bar Magnifier | No toggle exposed |

LLM agents using this MCP can therefore visually inspect these features (via `capture_screenshot`) but cannot reason about POC, value-area, detected pattern names, or TPO letter rows numerically. This epic closes that gap.

## 2. Goals

- Add structured-data read for Volume Profile (POC, VAH, VAL, volume-by-price bins).
- Add structured-data read for auto-detected patterns (name, price, bar time).
- Add structured-data read for TPO (letter rows, value area, single prints, initial balance).
- Add control toggles for Footprint chart type and Bar Magnifier setting.
- Maintain mode parity: every new MCP tool also accessible as a `tv` CLI subcommand.
- Stay within the existing CDP-only architecture — no new external dependencies.

## 3. Non-goals

- **Footprint cell data extraction** (bid/ask volume per price-level cell). Phase 2 / separate epic — requires deep internal probe.
- **Multi-instance Volume Profile** (two VRVPs simultaneously with distinct settings). Single instance only in v1.
- Real broker / live trading control (Epic #10, deferred indefinitely).
- Replacing existing `chart_manage_indicator` with a new generic mechanism.

## 4. Architecture

```
Claude Code
  └── MCP server (stdio)
       └── src/tools/premium_chart.js          [NEW — MCP tool registrations]
            └── src/core/premium_chart.js      [NEW — CDP business logic]
                 └── chrome-remote-interface
                      └── TradingView Desktop (Electron, port 9222)
                           ├── Built-in studies (Candlestick Patterns, Harmonic Patterns, Auto Fib Retracement)
                           └── pine/mcp-helper.pine                  [NEW — user-installed indicator]
                                ├── Volume Profile emitter (uses ta.vvp)
                                └── TPO emitter (period-based letter rows)
```

`mcp-helper.pine` is a single Pine v5 `indicator(...)` script (not a Pine `library(...)`) that the user installs once into their TradingView account. It has a `mode` input switching between Volume Profile and TPO emission. Its responsibility is to compute these structures using built-in Pine functions (`ta.vvp()`, time-bucketed price aggregation) and emit the result via `table.new()` with a magic-string header for parser identification (`MCP_VP_v1`, `MCP_TPO_v1`).

This keeps the MCP server's reading path consistent with the existing `data_get_pine_tables` infrastructure, so we don't reverse-engineer TradingView internals for these two features.

For auto-patterns, we add the built-in pattern study (which already emits `label.new()` entries) and read via the existing `data_get_pine_labels`.

For Footprint and Bar Magnifier, no data extraction — they are control toggles.

## 5. File layout

| Path | Purpose |
|---|---|
| `src/core/premium_chart.js` | CDP implementations: `vpAdd`, `vpGet`, `vpRemove`, `patternsAdd`, `patternsList`, `tpoAdd`, `tpoGet`, `footprintToggle`, `barMagnifierToggle` |
| `src/tools/premium_chart.js` | MCP tool registrations (9 tools), Zod schemas, output sanitization |
| `src/cli/commands/premium.js` | CLI mirror — `tv premium vp add/get/remove`, `tv premium patterns add/list`, `tv premium tpo add/get`, `tv premium footprint`, `tv premium magnifier` |
| `pine/mcp-helper.pine` | Pine v5 indicator — Volume Profile emitter + TPO emitter (single file, `mode` input) |
| `tests/premium_chart.test.js` | Unit tests for output schema + Pine helper output parsing |
| `tests/e2e.test.js` | Add e2e cases for each tool (happy path + error path) |
| `src/server.js` | Register new tools file |
| `src/cli/router.js` | Wire `premium` command group |

## 6. Tool specifications

### 6.1 `vp_add`

Adds a Volume Profile via the Pine helper library.

**Input:**
- `variant`: `"visible_range"` | `"fixed_range"` | `"session"` (required)
- `rows`: integer, default 24 — number of price rows
- `va_pct`: number 0–1, default 0.7 — value area percent
- `range_start`, `range_end`: ISO date strings, only when `variant="fixed_range"`

**Output:**
- `{ success: true, study_id: string, variant: string }`

**Behavior:** Injects the helper's `vp_emitter()` indicator with the given params, runs `pine_smart_compile`, returns the new study's entity ID. If a previous MCP-VP indicator exists, it is replaced (single-instance constraint).

### 6.2 `vp_get`

Returns structured Volume Profile data.

**Input:**
- `study_id`: optional — if omitted, finds the most recent MCP-VP study by magic string
- `bins_limit`: integer, default 100 — cap on returned bins

**Output:**
```json
{
  "success": true,
  "variant": "visible_range",
  "poc": 24530.0,
  "vah": 24580.0,
  "val": 24470.0,
  "value_area_pct": 0.7,
  "bins": [
    { "price": 24580.0, "volume": 12450 },
    { "price": 24560.0, "volume": 18200 }
  ],
  "total_volume": 245800
}
```

**Behavior:** Reads the helper's emitted table via `data_get_pine_tables`, validates magic header `MCP_VP_v1`, parses rows. Errors if no MCP-VP study found.

### 6.3 `vp_remove`

Removes the active MCP Volume Profile indicator.

**Input:** none.
**Output:** `{ success: true, removed: boolean }` — `removed: false` if no MCP-VP study was present (idempotent, not an error).

### 6.4 `patterns_add`

Adds one or more built-in pattern detection studies.

**Input:**
- `kinds`: array of `"candlestick"` | `"harmonic"` | `"auto_fib"` (required, ≥1)

**Output:**
- `{ success: true, added: [{ kind, study_id, name }, ...] }`

**Behavior:** Maps kinds to TradingView built-in study full names (e.g., `"All Candlestick Patterns"`, `"Harmonic Patterns"`, `"Auto Fib Retracement"`), uses `chart_manage_indicator` under the hood.

### 6.5 `patterns_list`

Returns currently detected patterns.

**Input:**
- `kinds`: optional filter — same enum as `patterns_add`
- `max_per_kind`: integer, default 25

**Output:**
```json
{
  "success": true,
  "patterns": [
    { "kind": "candlestick", "name": "Bullish Engulfing", "price": 24512.5, "bar_time": "2026-05-09T13:30:00Z" },
    { "kind": "harmonic", "name": "Bullish Gartley", "price": 24470.0, "bar_time": "2026-05-09T11:00:00Z" }
  ]
}
```

**Behavior:** Reads labels via `data_get_pine_labels` filtered to pattern study IDs; parses label text into `{ name, price, bar_time }`.

### 6.6 `tpo_add`

Adds the Pine helper's TPO emitter.

**Input:**
- `period_min`: integer, default 30 — TPO bracket period in minutes
- `session`: `"RTH"` | `"ETH"`, default `"RTH"`
- `va_pct`: number 0–1, default 0.7

**Output:** `{ success: true, study_id: string }`

### 6.7 `tpo_get`

Returns structured TPO data.

**Input:**
- `study_id`: optional — finds most recent MCP-TPO if omitted

**Output:**
```json
{
  "success": true,
  "session_date": "2026-05-09",
  "period_min": 30,
  "letter_rows": [
    { "price": 24580.0, "letters": "ABCD" },
    { "price": 24560.0, "letters": "ABCDEF" }
  ],
  "value_area": { "vah": 24560.0, "val": 24470.0 },
  "poc": 24520.0,
  "initial_balance": { "high": 24580.0, "low": 24500.0 },
  "single_prints": [{ "price": 24600.0, "letter": "K" }]
}
```

### 6.8 `footprint_toggle`

Toggles chart type to/from Volume Footprint.

**Input:**
- `enable`: boolean — `true` switch to Footprint, `false` revert to previous type

**Output:** `{ success: true, current_type: string, previous_type: string }`

**Behavior:** Calls `chart_set_type` with `"VolumeFootprint"`. Caches previous type in module-local state for reversion. No data extraction.

### 6.9 `bar_magnifier_toggle`

Toggles Bar Magnifier in chart settings.

**Input:**
- `enable`: boolean

**Output:** `{ success: true, enabled: boolean }`

**Behavior:** Opens chart settings panel, finds Bar Magnifier checkbox, clicks if state mismatch, closes panel. Sequence: `ui_open_panel("chart-settings")` → `ui_find_element` → `ui_click` → close.

## 7. Pine helper indicator (`pine/mcp-helper.pine`)

Single Pine v5 `indicator(...)` file the user installs once. Two emitters selected via `mode` input:

```pine
//@version=5
indicator("TV-MCP Helper", overlay=false, max_labels_count=500, max_lines_count=500)

mode = input.string("vp", options=["vp", "tpo"], title="Mode")

// — Volume Profile emitter
vp_variant = input.string("visible_range", options=["visible_range", "fixed_range", "session"])
vp_rows    = input.int(24, minval=4, maxval=200)
vp_va_pct  = input.float(0.7, minval=0.1, maxval=0.99)
// uses ta.vvp() or hand-rolled bin aggregation
// emits a table whose first cell == "MCP_VP_v1" and subsequent rows encode poc/vah/val/bins

// — TPO emitter
tpo_period = input.int(30)
tpo_session = input.string("RTH", options=["RTH", "ETH"])
// emits a table whose first cell == "MCP_TPO_v1"
```

The MCP server identifies these tables by their magic header so that they don't collide with other table-emitting Pine indicators (e.g., user's own dashboards).

The library file is shipped in the repo. The user installs it via either:
1. `pine_set_source` + `pine_save` (one-time bootstrap helper command: `tv premium install-helper`),
2. or manual paste into TradingView's Pine editor.

Installation flow is documented in `SETUP_GUIDE.md` (update required).

## 8. Data flow examples

**Example A — Full VP analysis:**
```
User: "What's the value area on my chart?"
LLM: vp_add(variant="visible_range", rows=24, va_pct=0.7)
     → { success, study_id }
     vp_get()
     → { poc: 24530, vah: 24580, val: 24470, bins: [...] }
LLM responds: "POC at 24530, VA between 24470–24580 (70%)."
```

**Example B — Pattern scan:**
```
User: "Any candlestick patterns I should know about?"
LLM: patterns_add(kinds=["candlestick"])
     patterns_list(kinds=["candlestick"], max_per_kind=10)
     → { patterns: [{name: "Bullish Engulfing", price: 24512, bar_time: "..."}] }
LLM responds: "Bullish Engulfing detected at 24512 around 13:30."
```

## 9. Error handling

All tools follow the existing `{ success: boolean, ... }` convention.

| Condition | Response |
|---|---|
| TV not connected | `{ success: false, error: "TradingView not reachable on port 9222" }` |
| `vp_get` called before `vp_add` (no MCP-VP study found) | `{ success: false, error: "No MCP Volume Profile found. Call vp_add first." }` |
| Pine helper library not installed | `{ success: false, error: "TV-MCP Helper indicator not found. Run 'tv premium install-helper'." }` |
| `patterns_list` with no pattern studies on chart | `{ success: true, patterns: [] }` (not an error) |
| Footprint type unsupported on current symbol | `{ success: false, error: "VolumeFootprint not available for SYMBOL" }` |
| Bar Magnifier checkbox not found (UI changed) | `{ success: false, error: "Bar Magnifier toggle not found in chart settings" }` |

Sanitization: re-use `src/tools/_format.js` — every output schema runs through Zod-based validator before returning.

## 10. Testing strategy

**Unit (`tests/premium_chart.test.js`):**
- Pine helper output parser: given a known table-string from the helper, produces correct VP/TPO struct.
- Magic-header validator: rejects non-MCP tables.
- Schema validation: every tool's output passes `_format.js` sanitization.

**E2E (`tests/e2e.test.js`):**
- Each tool: 1 happy path + 1 error path (TV-not-running, helper-missing, etc.).
- Footprint smoke test: toggle on, capture screenshot, toggle off — assert no crash.

**Manual / acceptance:**
- Full VP workflow on ES1!: `vp_add` → `vp_get` → manually verify POC/VAH/VAL match TradingView's built-in VRVP.
- TPO on ES1! 30min session: compare letter rows to a reference TPO chart.
- Pattern detection on a known historical bar: verify name + price match.

CI: existing `npm test` invocation. New e2e tests gated by TV-running env (already pattern-established by `tests/e2e.test.js`).

## 11. Phase 2 / separate tickets

- **Footprint cell data extraction** — internal CDP probe research, separate epic.
- **Multi-instance Volume Profile** — second VRVP with distinct settings.
- **VP horizontal lines export** — convert POC/VAH/VAL to drawn horizontal lines via `draw_shape`.
- **Pattern alerts** — wire `patterns_list` output into `alert_create`.

## 12. Open questions

1. **Pine helper packaging:** ship as single indicator with `mode` input, or as two separate scripts (`tv-mcp-vp.pine`, `tv-mcp-tpo.pine`)? Single is simpler to install, two are easier to debug. **Default: single, with `mode` switch.**
2. **`ta.vvp()` availability on user's plan:** confirm it works at Ultimate tier (it should — Volume Profile is built into Pine v5). Verify before building.
3. **Footprint chart type identifier:** the exact `chart_set_type` enum value for Volume Footprint — needs `tv_discover` run on user's instance to confirm.

## 13. Acceptance criteria

- [ ] All 9 tools registered in MCP server, listed by `tv_discover` and CLI `tv premium --help`.
- [ ] `pine/mcp-helper.pine` shipped in repo + `tv premium install-helper` bootstrap command works end-to-end.
- [ ] On a live TradingView session with a futures symbol (e.g., ES1!), the documented data-flow examples (Section 8) return correct values verified manually against TradingView's native UI.
- [ ] Unit + e2e tests pass via `npm test`.
- [ ] Tool reference table in `README.md` updated to reflect new tool count (78 → 87).
- [ ] `CLAUDE.md` decision tree updated with the new "premium chart types" workflows.
