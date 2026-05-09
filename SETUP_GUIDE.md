# Setup Guide for Claude Code

This file is a step-by-step guide for Claude Code (or any LLM agent) to install and configure the TradingView MCP server. If a user asks you to install or set up this project, follow these steps exactly.

## Step 1: Clone and Install

```bash
git clone https://github.com/tradesdontlie/tradingview-mcp.git ~/tradingview-mcp
cd ~/tradingview-mcp
npm install
```

If the user specifies a different install path, use that instead of `~/tradingview-mcp`.

## Step 2: Add to MCP Config

Add the server to the user's Claude Code MCP configuration. The config file is at `~/.claude/.mcp.json` (global) or `.mcp.json` (project-level).

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["<INSTALL_PATH>/src/server.js"]
    }
  }
}
```

Replace `<INSTALL_PATH>` with the actual path where the repo was cloned (e.g., `/Users/username/tradingview-mcp`).

If the config file already exists and has other servers, merge the `tradingview` entry into the existing `mcpServers` object. Do not overwrite other servers.

## Step 3: Launch TradingView Desktop

TradingView Desktop must be running with Chrome DevTools Protocol enabled.

**Auto-detect and launch (recommended):**
After the MCP server is connected, use the `tv_launch` tool — it auto-detects TradingView on Mac, Windows, and Linux.

**Manual launch by platform:**

Mac:
```bash
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222
```

Windows:
```bash
%LOCALAPPDATA%\TradingView\TradingView.exe --remote-debugging-port=9222
```

Linux:
```bash
/opt/TradingView/tradingview --remote-debugging-port=9222
# or: tradingview --remote-debugging-port=9222
```

## Step 4: Restart Claude Code

The MCP server only loads when Claude Code starts. After adding the config:

1. Exit Claude Code (Ctrl+C)
2. Relaunch Claude Code
3. The tradingview MCP server should connect automatically

## Step 5: Verify Connection

Use the `tv_health_check` tool. Expected response:

```json
{
  "success": true,
  "cdp_connected": true,
  "chart_symbol": "...",
  "api_available": true
}
```

If `cdp_connected: false`, TradingView is not running with `--remote-debugging-port=9222`.

## Step 6: Install CLI (Optional)

To use the `tv` CLI command globally:

```bash
cd ~/tradingview-mcp
npm link
```

Then `tv status`, `tv quote`, `tv pine compile`, etc. work from anywhere.

## Premium Chart Types (Ultimate plan only)

For Volume Profile (`vp_*`) and TPO (`tpo_*`) tools, install the Pine helper indicator **manually** — automated install was removed because it risked overwriting your other saved Pine scripts.

**One-time manual install:**

1. Open Pine Editor in TradingView (chart toolbar → Pine icon).
2. Click the script picker (top-left of editor) → **New** → **Indicator**.
3. Paste the full contents of `pine/mcp-helper.pine` into the editor (replace the default template).
4. Press `Ctrl+S`, set the name to exactly `TV-MCP Helper`, save.
5. Click **Add to chart** (or **Save and add to chart**).
6. Verify with `tv premium vp-add --variant visible_range && tv premium vp-get` — should return POC/VAH/VAL.

`tv premium install-helper` (or the `premium_install_helper` MCP tool) checks whether the helper is already on chart; if not, it returns these manual instructions.

**Cleanup:** to remove, use `vp_remove` MCP tool or remove `TV-MCP Helper` from the chart's indicators panel.

**Tools that need the helper:** `vp_add`, `vp_get`, `vp_remove`, `tpo_add`, `tpo_get`. Other premium tools (`patterns_*`, `footprint_toggle`) work without the helper.

### Known limitations

- **`bar_magnifier_toggle`** — TradingView's Bar Magnifier setting is UI-only on Premium/Ultimate; its toggle state is not exposed in the CDP-accessible property tree. Use the Chart Settings dialog manually if needed.
- **Harmonic Patterns** — `patterns_add --kinds harmonic` uses an unverified scriptIdPart guess. May fail until probed live.
- **`VolumeFootprint` chart type** — works on Premium/Ultimate (ID 17). On lower-tier plans `footprint_toggle --enable true` will silently fail.

## Tick Data (Premium / Ultimate plans)

For `data_get_ticks` to work, TradingView's Time & Sales panel must be available. On Premium/Ultimate plans this panel is included; on lower tiers it may be locked.

**One-time:** open the Time & Sales panel from TradingView's right sidebar (look for the bid/ask/last icon). The MCP server attempts auto-open before each call but will return `{success:false, error:"Time & Sales panel could not be opened"}` if the click fails.

**Sub-minute resolutions** (`chart_set_timeframe` with `"1S"`, `"5S"`, `"30S"`) require the symbol to support seconds-based intervals. Crypto exchanges (BINANCE, COINBASE) generally do; equities and forex usually do not.

**40,000-bar history** is fetched lazily — `data_get_ohlcv` with high `count` triggers TradingView to load older data. Some symbols may have shorter histories; in that case the tool returns `partial: true` with `returned < requested`.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `cdp_connected: false` | Launch TradingView with `--remote-debugging-port=9222` |
| `ECONNREFUSED` | TradingView isn't running or port 9222 is blocked |
| MCP server not showing in Claude Code | Check `~/.claude/.mcp.json` syntax, restart Claude Code |
| `tv` command not found | Run `npm link` from the project directory |
| Tools return stale data | TradingView may still be loading — wait a few seconds |
| Pine Editor tools fail | Open the Pine Editor panel first (`ui_open_panel pine-editor open`) |

## What to Read Next

- `CLAUDE.md` — Decision tree for which tool to use when (auto-loaded by Claude Code)
- `README.md` — Full tool reference (78 MCP tools, 30 CLI commands)
- `RESEARCH.md` — Research context and open questions
