# TradingView MCP Bridge

Personal AI assistant for your TradingView Desktop charts. Connects Claude Code to your locally running TradingView app via Chrome DevTools Protocol for AI-assisted chart analysis, Pine Script development, and workflow automation.

> [!WARNING]
> **This tool is not affiliated with, endorsed by, or associated with TradingView Inc.** It interacts with your locally running TradingView Desktop application via Chrome DevTools Protocol. Review the [Disclaimer](#disclaimer) before use.

> [!IMPORTANT]
> **Requires a valid TradingView subscription.** This tool does not bypass or circumvent any TradingView paywall or access control. It reads from and controls the TradingView Desktop app already running on your machine.

> [!NOTE]
> **All data processing occurs locally on your machine.** No TradingView data is transmitted, stored, or redistributed externally by this tool.

> [!CAUTION]
> This tool accesses undocumented internal TradingView APIs via the Electron debug interface. These can change or break without notice in any TradingView update. Pin your TradingView Desktop version if stability matters to you.

## How It Works (and why it's safe to run)

This tool does not connect to TradingView's servers, modify any TradingView files, or intercept any network traffic. It communicates exclusively with your locally running TradingView Desktop instance via Chrome DevTools Protocol (CDP) — a standard debugging interface built into all Chromium/Electron applications by Google, including VS Code, Slack, and Discord.

The debug port is disabled by default and must be explicitly enabled by you using a standard Chromium flag (`--remote-debugging-port=9222`). Nothing happens without that deliberate step.

## What This Tool Does Not Do

- Connect to TradingView's servers or APIs
- Store, transmit, or redistribute any market data
- Work without a valid TradingView subscription and installed Desktop app
- Bypass any TradingView paywall or access restriction
- Execute real trades (chart interaction only)
- Work if TradingView changes their internal Electron structure

## Research Context

This project explores an open research question: **how can LLM-based agents interact with professional trading interfaces to support human decision-making?**

Specifically it investigates:

- How structured tool APIs (MCP) can bridge LLMs and stateful desktop financial applications
- What latency, context, and reliability constraints emerge when an agent operates on live chart data
- How agents handle ambiguous financial UI state (e.g. interpreting Pine Script output, reading indicator tables)
- Whether natural language is an effective interface for chart navigation and Pine Script development
- The failure modes of LLM agents operating in real-time data environments

This is not a trading bot. It is an interface layer that makes a trading application legible to an LLM agent, allowing researchers and developers to study human-AI collaboration in financial workflows.

See [RESEARCH.md](RESEARCH.md) for open questions, findings, and related work.

## Prerequisites

- **TradingView Desktop app** (paid subscription required for real-time data)
- **Node.js 18+**
- **Claude Code** with MCP support (for MCP tools) or any terminal (for CLI)
- **macOS, Windows, or Linux**

## What It Does

Gives your AI assistant eyes and hands on your own chart:

- **Pine Script development** — write, inject, compile, debug, iterate. Strict-by-default save guards prevent accidentally overwriting your existing indicators.
- **Chart navigation** — change symbols, timeframes, scroll to dates, add/remove indicators
- **Visual analysis** — read indicator values, price levels, annotations from any visible Pine indicator
- **Multi-tab orchestration** — open new chart tabs end-to-end automated (Ctrl+T at OS level → "Create new layout" click → name dialog → symbol set), CDP rebinding correctly tracks bound tab
- **Vision-based UI control** — annotated screenshots (grid + clickable bounding boxes) returned inline so the model can drive UI by pixel coordinates when DOM selectors fail
- **Modal/dialog management** — describe / click-by-intent / dismiss any visible TradingView modal
- **Screener integration** — full whole-market REST scan (50+ countries, 500+ filters), 6 preset top-mover lists (gainers/losers/most_active/etc.), Pine Screener UI driver
- **News feed** — TradingView news REST integration, per-symbol or general headlines, full-text article fetch
- **Replay practice** — step through historical bars, practice entries/exits
- **Drawing & alerts** — shapes, levels, price alerts CRUD
- **Screenshots** — capture chart state, with inline-image mode for vision workflows
- **Multi-pane layouts** — set up 2x2, 3x1 grids with different symbols per pane
- **Monitor your chart** — stream JSONL from your locally running chart for monitoring scripts
- **CLI access** — every MCP tool is also a `tv` CLI command, pipe-friendly JSON output
- **Launch TradingView** — auto-detect and launch with debug mode from any platform

## Install with Claude Code

Paste this into Claude Code and it will handle the rest:

> Install the TradingView MCP server. Clone https://github.com/tradesdontlie/tradingview-mcp.git, run npm install, add it to my MCP config at ~/.claude/.mcp.json, and launch TradingView with the debug port. Then verify the connection with tv_health_check.

Or follow the manual steps below.

## Quick Start

### 1. Install

```bash
git clone https://github.com/tradesdontlie/tradingview-mcp.git
cd tradingview-mcp
npm install
```

### 2. Launch TradingView with CDP

TradingView Desktop must be running with Chrome DevTools Protocol enabled on port 9222.

**Mac:**
```bash
./scripts/launch_tv_debug_mac.sh
```

**Windows:**
```bash
scripts\launch_tv_debug.bat
```

**Linux:**
```bash
./scripts/launch_tv_debug_linux.sh
```

**Or launch manually on any platform:**
```bash
/path/to/TradingView --remote-debugging-port=9222
```

**Or use the MCP tool** (auto-detects your install):
> "Use tv_launch to start TradingView in debug mode"

### 3. Add to Claude Code

Add to your Claude Code MCP config (`~/.claude/.mcp.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/path/to/tradingview-mcp/src/server.js"]
    }
  }
}
```

Replace `/path/to/tradingview-mcp` with your actual path.

### 4. Verify

Ask Claude: *"Use tv_health_check to verify TradingView is connected"*

## CLI

Every MCP tool is also accessible as a `tv` CLI command. All output is JSON for piping with `jq`.

```bash
# Install globally (optional)
npm link

# Or run directly
node src/cli/index.js <command>
```

### Quick Examples

```bash
tv status                          # check connection
tv quote                           # current price
tv symbol AAPL                     # change symbol
tv ohlcv --summary                 # price summary
tv screenshot -r chart             # capture chart
tv pine compile                    # compile Pine Script
tv pane layout 2x2                 # 4-chart grid
tv pane symbol 1 ES1!              # set pane symbol
tv stream quote | jq '.close'      # monitor price changes
```

### All Commands

```
tv status / launch / state / symbol / timeframe / type / info / search
tv quote / ohlcv / values
tv data lines/labels/tables/boxes/strategy/trades/equity/depth/indicator
tv pine get/set/compile/analyze/check/save/new/open/list/errors/console
tv draw shape/list/get/remove/clear
tv alert list/create/delete
tv watchlist get/add
tv indicator add/remove/toggle/set/get
tv layout list/switch
tv pane list/layout/focus/symbol
tv tab list/new/close/switch
tv replay start/step/stop/status/autoplay/trade
tv stream quote/bars/values/lines/labels/tables/all
tv ui click/keyboard/hover/scroll/find/eval/type/panel/fullscreen/mouse
tv screenshot / discover / ui-state / range / scroll
```

## Streaming

The `tv stream` commands poll your locally running TradingView Desktop instance at regular intervals via Chrome DevTools Protocol on localhost.

No connection is made to TradingView's servers. All data stays on your machine.

> [!WARNING]
> Programmatic consumption of TradingView data may conflict with their Terms of Use regardless of the data source. You are solely responsible for ensuring your usage complies.

```bash
tv stream quote                          # price tick monitoring
tv stream bars                           # bar-by-bar updates
tv stream values                         # indicator value monitoring
tv stream lines --filter "NY Levels"     # price level monitoring
tv stream tables --filter Profiler       # table data monitoring
tv stream all                            # all panes at once (multi-symbol)
```

## How Claude Knows Which Tool to Use

Claude reads [`CLAUDE.md`](CLAUDE.md) automatically when working in this project. It contains a complete decision tree:

| You say... | Claude uses... |
|------------|---------------|
| "What's on my chart?" | `chart_get_state` → `data_get_study_values` → `quote_get` |
| "What levels are showing?" | `data_get_pine_lines` → `data_get_pine_labels` |
| "Read the session table" | `data_get_pine_tables` with `study_filter` |
| "Give me a full analysis" | `quote_get` → `data_get_study_values` → `data_get_pine_lines` → `data_get_pine_labels` → `data_get_pine_tables` → `data_get_ohlcv` (summary) → `capture_screenshot` |
| "Switch to AAPL daily" | `chart_set_symbol` → `chart_set_timeframe` |
| "Write a Pine Script for..." | `pine_set_source` → `pine_smart_compile` → `pine_get_errors` |
| "Start replay at March 1st" | `replay_start` → `replay_step` → `replay_trade` |
| "Set up a 4-chart grid" | `pane_set_layout` → `pane_set_symbol` for each pane |
| "Draw a level at 24500" | `draw_shape` (horizontal_line) |
| "Take a screenshot" | `capture_screenshot` |
| "What's the value area / POC?" | `vp_add` → `vp_get` |
| "Show me detected candlestick patterns" | `patterns_add` → `patterns_list` |
| "Read the TPO profile" | `tpo_add` → `tpo_get` |
| "Switch to footprint" | `footprint_toggle` |
| "Show me last 50 ticks" | `data_get_ticks` |
| "Switch to 5-second bars" | `chart_set_timeframe` with `"5S"` |
| "Get me 10000 daily bars" | `data_get_ohlcv` with `count: 10000` |
| "What strategies are on the chart?" | `strategy_list` |
| "Set commission to 0.1% and re-run" | `strategy_set_settings` → `strategy_get_performance_summary` |
| "What's my Sharpe ratio?" | `strategy_get_risk_ratios` |
| "Open BTCUSDT in a new tab" | `tab_new auto_navigate_to:"BINANCE:BTCUSDT"` |
| "Show me oversold US stocks" | `screener_scan market:"america" filters:[{field:"RSI",operation:"less",value:30}]` |
| "Top gainers today?" | `screener_active_list list_type:"gainers"` |
| "Latest news on Apple?" | `news_headlines symbol:"NASDAQ:AAPL"` |
| "Read this news article" | `news_get_story id:"<from headlines>"` |
| "Click that button on screen" (when DOM fails) | `ui_screen_inspect` → `ui_mouse_click coords_are:"screenshot_pixels"` |
| "Save my Pine indicator without overwriting old one" | `pine_new` → `pine_set_source` → `pine_smart_compile` (strict-by-default refuses to overwrite) |
| "Dismiss this 'Save changes?' dialog" | `ui_dialog action:"click_button" intent:"discard"` |

## Tool Reference (116 MCP tools)

### Chart Reading

| Tool | When to use | Output size |
|------|------------|-------------|
| `chart_get_state` | First call — get symbol, timeframe, all indicator names + IDs | ~500B |
| `data_get_study_values` | Read current RSI, MACD, BB, EMA values from all indicators | ~500B |
| `quote_get` | Get latest price, OHLC, volume | ~200B |
| `data_get_ohlcv` | Get price bars (up to 40,000). **Use `summary: true`** for compact stats. Triggers history load if requested count exceeds chart cache. | 500B (summary) / 8KB (100 bars) |

### Custom Indicator Data (Pine Drawings)

Read `line.new()`, `label.new()`, `table.new()`, `box.new()` output from any visible Pine indicator.

| Tool | When to use | Output size |
|------|------------|-------------|
| `data_get_pine_lines` | Read horizontal price levels (support/resistance, session levels) | ~1-3KB |
| `data_get_pine_labels` | Read text annotations + prices ("PDH 24550", "Bias Long") | ~2-5KB |
| `data_get_pine_tables` | Read data tables (session stats, analytics dashboards) | ~1-4KB |
| `data_get_pine_boxes` | Read price zones / ranges as {high, low} pairs | ~1-2KB |

**Always use `study_filter`** to target a specific indicator: `study_filter: "Profiler"`.

### Chart Control

| Tool | What it does |
|------|-------------|
| `chart_set_symbol` | Change ticker (BTCUSD, AAPL, ES1!, NYMEX:CL1!) |
| `chart_set_timeframe` | Change resolution. Accepts seconds (`1S`, `5S`, `30S`), minutes (`1`, `15`, `60`), `D`, `W`, `M`. Symbol must support requested resolution. |
| `chart_set_type` | Change style (Candles, HeikinAshi, Line, Area, Renko) |
| `chart_manage_indicator` | Add/remove indicators. **Use full names**: "Relative Strength Index" not "RSI" |
| `chart_scroll_to_date` | Jump to a date (ISO: "2025-01-15") |
| `chart_set_visible_range` | Zoom to exact range (unix timestamps) |
| `symbol_info` / `symbol_search` | Symbol metadata and search |
| `indicator_set_inputs` / `indicator_toggle_visibility` | Change indicator settings, show/hide |

### Multi-Pane Layouts

| Tool | What it does |
|------|-------------|
| `pane_list` | List all panes with symbols and active state |
| `pane_set_layout` | Change grid: `s`, `2h`, `2v`, `2x2`, `4`, `6`, `8` |
| `pane_focus` | Focus a specific pane by index |
| `pane_set_symbol` | Set symbol on any pane |

### Tab Management

| Tool | What it does |
|------|-------------|
| `tab_list` | List open chart tabs |
| `tab_new` / `tab_close` | Open/close tabs |
| `tab_switch` | Switch to a tab by index |

### Pine Script Development

| Tool | Step |
|------|------|
| `pine_set_source` | 1. Inject code into editor |
| `pine_smart_compile` | 2. Compile with auto-detection + error check |
| `pine_get_errors` | 3. Read compilation errors if any |
| `pine_get_console` | 4. Read log.info() output |
| `pine_save` | 5. Save to TradingView cloud |
| `pine_get_source` | Read current script (**warning: can be 200KB+ for complex scripts**) |
| `pine_new` | Create blank indicator/strategy/library |
| `pine_open` / `pine_list_scripts` | Open or list saved scripts |
| `pine_analyze` | Offline static analysis (no chart needed) |
| `pine_check` | Server-side compile check (no chart needed) |

### Replay Mode

| Tool | Step |
|------|------|
| `replay_start` | Enter replay at a date |
| `replay_step` | Advance one bar |
| `replay_autoplay` | Auto-advance (set speed in ms) |
| `replay_trade` | Buy/sell/close positions |
| `replay_status` | Check position, P&L, date |
| `replay_stop` | Return to realtime |

### Drawing, Alerts, UI Automation

| Tool | What it does |
|------|-------------|
| `draw_shape` | Draw horizontal_line, trend_line, rectangle, text |
| `draw_list` / `draw_remove_one` / `draw_clear` | Manage drawings |
| `alert_create` / `alert_list` / `alert_delete` | Manage price alerts |
| `capture_screenshot` | Screenshot (regions: full, chart, strategy_tester) |
| `batch_run` | Run action across multiple symbols/timeframes |
| `watchlist_get` / `watchlist_add` | Read/modify watchlist |
| `layout_list` / `layout_switch` | Manage saved layouts |
| `ui_open_panel` / `ui_click` / `ui_evaluate` | UI automation |
| `tv_launch` / `tv_health_check` / `tv_discover` | Connection management |

### Premium Chart Types (Ultimate)

| Tool | What it does |
|------|-------------|
| `premium_install_helper` | One-time: install `pine/mcp-helper.pine` indicator |
| `vp_add` / `vp_get` / `vp_remove` | Volume Profile (POC, VAH, VAL, bins) — variants: visible_range / fixed_range / session |
| `patterns_add` / `patterns_list` | Auto-detected candlestick, harmonic, auto-fib patterns |
| `tpo_add` / `tpo_get` | TPO Market Profile (letter rows, value area, IB, single prints) |
| `footprint_toggle` | Toggle Volume Footprint chart type |
| `bar_magnifier_toggle` | Toggle Bar Magnifier setting |

### Tick Data (Premium / Ultimate)

| Tool | What it does |
|------|-------------|
| `data_get_ticks` | Read recent tick prints from Time & Sales panel (price, size, side, time). Requires panel to be openable. |

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

### Screener (whole-market filter, REST)

Hits `scanner.tradingview.com` via the user's session cookies — no chart side-effects.

| Tool | What it does |
|------|-------------|
| `screener_scan` | Run a scan over any market (america/crypto/forex/india/uk/turkey/germany/japan/global). 500+ filterable columns (P/E, RSI, market_cap_basic, sector, ...). Up to 500 rows per call. |
| `screener_columns` | List 50+ common columns with descriptions |
| `screener_operations` | List filter ops: `greater`, `less`, `egreater`, `in_range`, `match`, `crosses_above`, etc. |
| `screener_active_list` | Preset Top Movers: `most_active`, `gainers`, `losers`, `high_volume`, `52w_highs`, `52w_lows` |

Examples:
```
screener_scan market:"america" filters:[{field:"RSI",operation:"less",value:30}]   # oversold US
screener_active_list list_type:"gainers" range:[0,20]                              # top 20 gainers
screener_scan market:"crypto" sort:{by:"market_cap_basic",order:"desc"}            # top crypto
```

### Pine Screener (UI-driven, Premium/Ultimate)

| Tool | What it does |
|------|-------------|
| `pine_screener_open` / `pine_screener_close` | Open / close TradingView's Screener side panel |
| `pine_screener_status` | Read current state: panel_open, screen_name, filter pill count, row count |
| `pine_screener_run screen_name:"My Pine Screen"` | Switch to a saved Pine screen + scrape result table |

### News Feed (REST)

Hits `news-headlines.tradingview.com` via session cookies. No chart side-effects.

| Tool | What it does |
|------|-------------|
| `news_headlines` | General feed (default 50 items) — pass `symbol:"NASDAQ:AAPL"` for symbol-specific |
| `news_get_story id:"<from headlines>"` | Full article text (AST → plaintext) + short description |

### Multi-Tab (CDP target binding + OS-level new tab)

| Tool | What it does |
|------|-------------|
| `tab_list` | List all chart tabs with `is_bound:true` flag for current target |
| `tab_get_active` | "Which tab am I on?" — returns id, index, url, chart_id of bound tab |
| `tab_switch index:N` | Activate tab N visually + rebind CDP client. All subsequent calls go there. |
| `tab_new auto_navigate_to:"BINANCE:AVAXUSDT.P"` | **Full automation:** OS-level Ctrl+T (PowerShell SendKeys / osascript / xdotool) → click "Create new layout" tile → type unique name → click "Create" → set symbol via CDP. End-to-end one call. |
| `tab_wait_for_new` | Poll until a new tab appears + auto-bind. Use after manually pressing Ctrl+T (fallback when full auto fails). |
| `tab_close` | Close current bound tab (rebinds to first remaining) |

Multi-tab note: Each TV tab is its own CDP target. The MCP client binds to ONE target at a time. `tab_switch` correctly rebinds — without that, calls would silently land on the wrong tab.

### Vision-based UI Control (when DOM selectors fail)

| Tool | What it does |
|------|-------------|
| `capture_screenshot return_inline:true` | PNG returned inline as MCP image content (visible to the model) + viewport size + devicePixelRatio |
| `ui_screen_inspect` | Annotated screenshot — coordinate grid + bounding boxes around every clickable element |
| `ui_mouse_click coords_are:"screenshot_pixels"` | Click at pixel coords from a screenshot, with automatic DPR calibration |
| `ui_viewport` | Get viewport dimensions + devicePixelRatio for coordinate mapping |
| `ui_drag from_x/y to_x/y` | Drag with interpolated mouseMoved events |

### Dialog & Modal Management

| Tool | What it does |
|------|-------------|
| `ui_dialog action:"describe"` | Detect topmost visible modal — returns title, buttons (with intent guess), checkboxes, inputs |
| `ui_dialog action:"click_button" intent:"discard"` | Click button by semantic intent: `confirm/cancel/discard/save/ok/yes/no/close`. Each maps to a ranked list of button-text candidates ("Don't save", "Discard", "Open anyway" for `discard` etc.) |
| `ui_dialog action:"dismiss"` | Auto-dismiss any visible dialog with discard/cancel intent |

### Pine Editor Safety (strict-by-default save guards)

`pine_save` and `pine_smart_compile` refuse to write unless the editor is on a fresh untitled script — preventing silent overwrites of user scripts. Pass `expected_name:"<exact loaded name>"` or `force:true` to opt into overwriting.

| Tool | Safety |
|------|--------|
| `pine_get_loaded_info` | Read currently-loaded script: name, isUntitled, hasUnsavedChanges |
| `pine_new kind:"indicator"` | **Real fresh untitled script** (clicks TV's "Create new" → submenu → kind option). Refuses if unsaved changes (force_discard:true to override). |
| `pine_save` / `pine_smart_compile` | Strict-by-default. `expected_untitled:true` (default), `expected_name:"X"`, or `force:true`. `close_after:true` (default) collapses bottom panel after compile. |

### Enhanced UI Tools

| Tool | What it does |
|------|-------------|
| `ui_click` | DOM click with `wait_ms:N` polling + `retries:N` + shadow-DOM piercing |
| `ui_set_checkbox label:"X" checked:true` | Idempotent toggle — reads state, only clicks if mismatched |
| `ui_hover_and_click` | Composite: hover trigger + wait + click target (for hover-revealed menus) |
| `ui_keyboard` / `ui_type_text` | Keystroke + text input |
| `ui_evaluate` | Execute arbitrary JS in page context (escape hatch) |

## Ultimate Plan Coverage

How much of [TradingView Ultimate's feature surface](tradingview-ultimate-features.md) is reachable from this MCP:

| Category | Coverage |
|---|---|
| Charts (read/control symbols, timeframes, types, replay, history, screenshots) | ✅ ~95% |
| Pine Script (write/compile/save with safety, static analysis, server check, screener) | ✅ ~95% |
| Strategy Tester (settings + performance/risk/trades) | ✅ 100% |
| Premium chart features (Volume Profile, TPO, Footprint, Patterns, Bar Magnifier) | ✅ 100% (helper req) |
| Screener (REST + presets) | ✅ 95% |
| Multi-tab navigation (incl. OS-level new-tab automation) | ✅ 100% |
| Vision-based UI control (annotated screenshots + DPR-aware coord clicks) | ✅ 90% |
| Modal/dialog management | ✅ 95% |
| News feed (general + symbol-specific + full article) | ✅ 95% |
| Drawing tools (shape CRUD) | ✅ 90% |
| Alerts (price + technical CRUD) | 🟡 50% (no webhooks, no multi-condition, no watchlist alerts) |
| Watchlists (read + add) | 🟡 40% (no remove, no multi-list, no colors, no import/export) |
| Live broker trading | ❌ 0% (replay paper trade only) |
| Portfolios | ❌ 0% (TV portfolio service not wrapped) |
| Economic / earnings calendar | ❌ 0% (CORS-blocked endpoints) |
| Yield curves | 🟡 manual (symbol-based access) |
| Social publishing (Pine publish, opinions, ideas) | ❌ 0% |

See [TEST_REPORT.md](TEST_REPORT.md) for the full live-test matrix and ~95 verified tool calls.

## Context Management

Tools return compact output by default to minimize context usage. For a typical "analyze my chart" workflow, total context is ~5-10KB instead of ~80KB.

| Feature | How it saves context |
|---------|---------------------|
| Pine lines | Returns deduplicated price levels only, not every line object |
| Pine labels | Capped at 50 per study, text+price only |
| Pine tables | Pre-formatted row strings, no cell metadata |
| Pine boxes | Deduplicated {high, low} zones only |
| OHLCV summary mode | Stats + last 5 bars instead of all bars |
| Indicator inputs | Encrypted/encoded blobs auto-filtered |
| `verbose: true` | Pass on any pine tool to get raw data with IDs/colors when needed |
| `study_filter` | Target one indicator instead of scanning all |

## Finding TradingView on Your System

Launch scripts and `tv_launch` auto-detect TradingView. If auto-detection fails:

| Platform | Common Locations |
|----------|-----------------|
| **Mac** | `/Applications/TradingView.app/Contents/MacOS/TradingView` |
| **Windows** | `%LOCALAPPDATA%\TradingView\TradingView.exe`, `%PROGRAMFILES%\WindowsApps\TradingView*\TradingView.exe` |
| **Linux** | `/opt/TradingView/tradingview`, `~/.local/share/TradingView/TradingView`, `/snap/tradingview/current/tradingview` |

The key flag: `--remote-debugging-port=9222`

## Testing

```bash
# Requires TradingView running with --remote-debugging-port=9222
npm test
```

60+ unit tests covering: Pine Script static analysis, server-side compilation, CLI routing, dialog intent mapping, save-guard policy, screener payload shape, news input validation, tab list flag shape, multi-target reconnect logic. Plus comprehensive live sweep (~95 unique tool calls validated end-to-end against a running TradingView Desktop).

## Architecture

```
Claude Code  ←→  MCP Server (stdio)  ←→  CDP (port 9222)  ←→  TradingView Desktop (Electron)
```

- **Transport**: MCP over stdio (116 tools) + CLI (`tv` command)
- **Connection**: Chrome DevTools Protocol on localhost:9222
- **Streaming**: Poll-and-diff loop with deduplication, JSONL output to stdout
- **No dependencies** beyond `@modelcontextprotocol/sdk` and `chrome-remote-interface`

## Attributions

This project is not affiliated with, endorsed by, or associated with:
- **TradingView Inc.** — TradingView is a trademark of TradingView Inc.
- **Anthropic** — Claude and Claude Code are trademarks of Anthropic, PBC.

This tool is an independent MCP server that connects to Claude Code via the standard MCP protocol. It does not contain or modify any Anthropic software.

## Disclaimer

This project is provided **for personal, educational, and research purposes only**.

**How this tool works:** This tool uses the Chrome DevTools Protocol (CDP), a standard debugging interface built into all Chromium-based applications by Google. It does not reverse engineer any proprietary TradingView protocol, connect to TradingView's servers, or bypass any access controls. The debug port must be explicitly enabled by the user via a standard Chromium command-line flag (`--remote-debugging-port=9222`).

By using this software, you acknowledge and agree that:

1. **You are solely responsible** for ensuring your use of this tool complies with [TradingView's Terms of Use](https://www.tradingview.com/policies/) and all applicable laws.
2. TradingView's Terms of Use **restrict automated data collection, scraping, and non-display usage** of their platform and data. This tool uses Chrome DevTools Protocol to programmatically interact with the TradingView Desktop app, which may conflict with those terms.
3. **You assume all risk** associated with using this tool. The authors are not responsible for any account bans, suspensions, legal actions, or other consequences resulting from its use.
4. This tool **must not be used** for, including but not limited to:
   - Redistributing, reselling, or commercially exploiting TradingView's market data
   - Circumventing TradingView's access controls or subscription restrictions
   - Performing automated trading or algorithmic decision-making using extracted data
   - Violating the intellectual property rights of Pine Script indicator authors
   - Connecting to TradingView's servers or infrastructure (all access is via the locally running Desktop app)
5. The streaming functionality monitors your locally running TradingView Desktop instance only. It does not connect to TradingView's servers or extract data from TradingView's infrastructure.
6. Market data accessed through this tool remains subject to exchange and data provider licensing terms. **Do not redistribute, store, or commercially exploit any data obtained through this tool.**
7. This tool accesses internal, undocumented TradingView application interfaces that may change or break at any time without notice.

**Use at your own risk.** If you are unsure whether your intended use complies with TradingView's terms, do not use this tool.

## License

MIT — see [LICENSE](LICENSE) for details.

The MIT license applies to the source code of this project only. It does not grant any rights to TradingView's software, data, trademarks, or intellectual property.
