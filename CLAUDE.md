# TradingView MCP — Claude Instructions

117 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"

**Safe write flow (DO NOT skip steps):** TV Pine Editor binds the editor to a single saved-script slot. A blind Ctrl+S writes to whatever script is currently loaded — risk of overwriting the user's existing indicator. The tools enforce strict-by-default guards.

1. `pine_get_loaded_info` → see what's currently loaded (`scriptName`, `isUntitled`, `hasUnsavedChanges`)
2. `pine_new kind:"indicator"` → properly detach + create fresh untitled (refuses if unsaved changes; pass `force_discard:true` only when intentional)
3. `pine_set_source source:"..."` → inject your Pine code
4. `pine_smart_compile` → compiles + adds to chart. Strict-by-default save guard: passes only on untitled state. If you're updating a saved script, pass `expected_name:"<exact loaded name>"` or `force:true`.
5. `pine_save` → same strict guard. Pass `expected_name` to update an existing script, or omit (default = untitled-only).

**Read flow:**
- `pine_get_errors` → compilation markers
- `pine_get_console` → log.info() output
- `pine_get_source` → current editor source (WARNING: 200KB+ for complex scripts; avoid unless editing)
- `pine_open name:"X"` → load a saved script by name
- `pine_list_scripts` → list saved scripts

**Static/offline checks (no chart needed):**
- `pine_analyze` → static analysis (array OOB, unguarded array.first(), bad loops, implicit bool)
- `pine_check` → server-side compile validation

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Read TradingView news"

`news_headlines` and `news_get_story` hit `news-headlines.tradingview.com` via the user's session cookies — same general feed as TV's right-panel news widget.

- `news_headlines` → general feed (default 50 items)
- `news_headlines symbol:"NASDAQ:AAPL"` → symbol-specific (Apple-related news)
- Each item: `{id, title, source, published, published_iso, related_symbols, story_path}`
- `news_get_story id:"<from headlines>"` → full plaintext + short_description
- No chart side-effects — pure REST data fetch

### "Screener / Tarayıcı (whole-market filter)"

**Classic Screener (REST, fast):** scans the whole market against any combination of fundamentals/price/technicals.
1. `screener_columns` → see column names (RSI, market_cap_basic, sector, P/E, etc.)
2. `screener_operations` → see filter ops (greater, less, in_range, match, crosses_above, etc.)
3. `screener_scan` with filters/columns/sort/range. Examples:
   - Oversold US stocks: `market:"america" filters:[{field:"RSI",operation:"less",value:30}]`
   - Mid-cap tech: `market:"america" filters:[{field:"market_cap_basic",operation:"egreater",value:2e9},{field:"sector",operation:"match",value:"Technology Services"}]`
   - Large-cap crypto: `market:"crypto" filters:[{field:"market_cap_basic",operation:"egreater",value:1e9}] sort:{by:"market_cap_basic",order:"desc"}`
4. `screener_active_list list_type:"most_active|gainers|losers|high_volume|52w_highs|52w_lows"` — preset filters for top-movers

Markets: `america`, `crypto`, `forex`, `india`, `uk`, `germany`, `japan`, `turkey`, `brazil`, `canada`, `australia`, `france`, `spain`, `italy`, `china`, `hongkong`, `korea`, `mexico`, `cfd`, `global`. Range capped at 500 rows per call. **Does NOT touch chart indicators.**

### "Run a Pine indicator across many symbols (Pine Screener)"

Pine Screener runs a saved Pine indicator against a scan list and returns per-symbol outputs. Premium/Ultimate. UI-orchestrated; reliability depends on TV's panel layout.

1. `pine_screener_open` → open the bottom panel
2. `pine_screener_run script_name:"My RSI Alert" scan_list:"All US Stocks" max_rows:50` → end-to-end: select script + list, run, scrape table
3. `pine_screener_status` → progress / row count while running
4. `pine_screener_close` → close panel

If table scraping fails, the result includes `fallback.file_path` to an annotated screenshot for manual diagnosis. **Does NOT add the script as a chart indicator.**

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

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

### "Read DOM (Depth of Market / Piyasa Derinliği) ladder"

1. **Pre-condition:** Connect a live broker (TradeStation, IBKR, AMP, OANDA — Paper Trading does NOT support DOM) and select "DOM" mode in the bottom-left Trade button.
2. `dom_read depth:20` → returns `{best_bid, best_ask, spread, total_bid_size, total_ask_size, asks:[{price,size}], bids:[{price,size}]}` sorted best-first.

If panel not visible: returns `{success:false, panel_open:false, error:"DOM panel not visible..."}` with guidance.

### "Read recent tick prints"

1. `data_get_ticks` with `limit: 50` → returns last 50 ticks (price, size, side, time)

Pre-condition: TradingView's Time & Sales panel must be open (or auto-openable). If `panel_open: false` in response, instruct the user to open it manually.

### "Sub-minute resolution analysis"

1. `chart_set_timeframe` with `"1S"`, `"5S"`, or `"30S"` (seconds intervals — Ultimate feature, requires symbol to support seconds).
2. `data_get_ohlcv` to read the resulting fast bars.

If chart_set_timeframe returns `success: false` with "Symbol does not support", fall back to a higher resolution.

### "Deep history backtest data"

`data_get_ohlcv` with `count: 10000` (or up to 40,000) — the tool transparently triggers TradingView to load older bars if the chart cache has fewer than requested. Returns `partial: true` with `requested` / `returned` if loading times out.

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

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name. Optional `wait_ms`/`retries`/`wait_after_ms` for flaky targets. Walks open shadow roots.
- `ui_set_checkbox` → idempotent toggle (reads current state, only clicks if mismatched)
- `ui_hover_and_click` → hover trigger then click target (for hover-revealed menus)
- `ui_drag` → drag from→to with interpolation (chart drawing, pan)
- `ui_dialog` → describe / click_button (by intent or label) / dismiss the active modal
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → screenshot (regions: full/chart/strategy_tester). `return_inline:true` returns PNG inline as MCP image content for vision workflows.
- `ui_screen_inspect` → annotated screenshot (grid + clickable bounding boxes, inline) — vision fallback

### "UI'da takıldığında — çözüm sırası"
When DOM-based selectors fail, escalate in this order:

1. **Dialog kontrolü:** `ui_dialog action:"describe"` — aktif modal var mı? Varsa `ui_dialog action:"click_button" intent:"discard|cancel|confirm|save"`
2. **Wait + retry:** `ui_click` çağrısına `wait_ms:2000, retries:2` ekle — element geç render oluyor olabilir
3. **Hover-trigger:** Element hover ile beliriyor mu? `ui_hover_and_click hover_value:"..." click_value:"..."`
4. **Bounding box:** `ui_find_element query:"..."` — hangi elementler nerede? Koordinat döner.
5. **Vision fallback (DOM çözümlenemiyorsa):**
   - `ui_screen_inspect` → annotated screenshot (grid + clickable bounding boxes, inline)
   - Screenshot'tan koordinat tahmin et
   - `ui_mouse_click x:.. y:.. coords_are:"screenshot_pixels"` → DPR otomatik kalibrasyon
6. **Son çare:** `ui_evaluate expression:"..."` — sayfa context'inde rastgele JS

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working

### "Multiple chart tabs open"

TradingView Desktop can have many tabs open at once; each tab is its own CDP target. The MCP CDP client is bound to one target at a time, so switching tabs requires both a visual switch AND a client rebind — these tools handle both:

- `tab_list` → see every tab; each entry has `is_bound:true` for the one MCP is currently driving
- `tab_get_active` → "which tab am I on?" — returns id, index, url, chart_id of the bound tab
- `tab_switch index:N` → activate tab N visually + rebind the CDP client. Subsequent `chart_*`, `data_*`, `pine_*`, `ui_*`, `capture_*` calls operate on the new tab.
- `tab_new` → **best-effort** new tab. Returns honest error in TV Desktop (Electron blocks Ctrl+T to renderer and CDP Target.createTarget). Use the `tab_wait_for_new` workflow instead.
- `tab_wait_for_new timeout_ms:30000` → polls until a new TradingView chart tab appears, then auto-binds. Use **after** manually pressing Ctrl+T or clicking the + tab button.
- `tab_close` → close current tab (Ctrl+W / Cmd+W); if it was the bound one, MCP rebinds to first remaining tab

**New-tab workflow (Electron limitation):**
1. Call `tab_new` — likely returns error explaining Electron blocked it
2. User (or you, via instructions) presses **Ctrl+T** in TradingView Desktop, or clicks the **+** button in the tab bar
3. Call `tab_wait_for_new` — auto-detects the new tab and binds the MCP client to it
4. Continue with `chart_set_symbol` etc. — all subsequent calls go to the new tab

Always call `tab_get_active` (or check `is_bound` in `tab_list`) before issuing chart commands when working with multi-tab workspaces — confirms the MCP is talking to the tab the user expects.

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |
| `vp_get` | ~2-4 KB (depends on `bins_limit`) |
| `tpo_get` | ~2-5 KB (depends on level count) |
| `patterns_list` | ~1-3 KB |
| `data_get_ticks` (50 ticks) | ~3-5 KB |
| `data_get_ohlcv` (10000 bars) | ~800 KB — use `summary: true` instead unless raw bars needed |
| `strategy_list` | ~200 B per strategy |
| `strategy_get_settings` | ~500 B (incl. raw_property_keys) |
| `strategy_get_performance_summary` / `_trades_analysis` / `_risk_ratios` | ~500 B each |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`
