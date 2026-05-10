import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/tab.js';

export function registerTabTools(server) {
  server.tool(
    'tab_list',
    'List all open TradingView chart tabs. Each tab includes is_bound:true|false marking which one the MCP CDP client is currently driving.',
    {},
    async () => {
      try { return jsonResult(await core.list()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'tab_new',
    'Open a new chart tab in TradingView Desktop. Tries CDP Target.createTarget first; falls back to OS-level Ctrl+T keystroke (PowerShell SendKeys / osascript / xdotool) which the native menu DOES handle. The keystroke opens TV\'s "New tab" landing page (file:// URL, not CDP-bindable). Pass auto_navigate_to:"BINANCE:AVAXUSDT.P" to also type the symbol via OS keystrokes — TV\'s search box auto-focuses, so this navigates the landing page to a regular bindable chart URL.',
    {
      auto_keystroke: z.coerce.boolean().optional().describe('Allow OS-level keystroke fallback when CDP fails (default true)'),
      auto_navigate_to: z.string().optional().describe('Symbol (e.g., "BINANCE:AVAXUSDT.P") — type into the new tab\'s search box via OS keystrokes after Ctrl+T, navigating to a bindable chart URL'),
      timeout_ms: z.coerce.number().min(1000).max(60000).optional().describe('Max wait for new tab (default 15000)'),
    },
    async (args) => {
      try { return jsonResult(await core.newTab(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'tab_wait_for_new',
    'Poll /json/list waiting for a new TradingView tab to appear, then auto-rebind. Detects both chart URLs AND TV Desktop "New tab" landing pages (file://). expect_chart_url:true (default) keeps waiting until the new tab is on a tradingview.com/chart URL (bindable); set false to accept landing pages (informational, not bindable).',
    {
      timeout_ms: z.coerce.number().min(1000).max(600000).optional().describe('Max wait in ms (default 30000)'),
      poll_interval_ms: z.coerce.number().min(100).max(5000).optional().describe('Polling cadence (default 500)'),
      expect_chart_url: z.coerce.boolean().optional().describe('Require URL to become a chart (default true)'),
    },
    async (args) => {
      try { return jsonResult(await core.waitForNew(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'tab_close',
    'Close the current chart tab via Ctrl+W / Cmd+W. If the bound tab disappears, rebinds the CDP client to the first remaining tab.',
    {},
    async () => {
      try { return jsonResult(await core.closeTab()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'tab_switch',
    'Switch to a chart tab by index. Brings it to the foreground AND rebinds the MCP CDP client to its target — subsequent chart/data/UI/vision calls operate on the newly active tab.',
    {
      index: z.coerce.number().describe('Tab index (0-based, from tab_list)'),
    },
    async ({ index }) => {
      try { return jsonResult(await core.switchTab({ index })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'tab_get_active',
    'Return which tab the MCP CDP client is currently bound to (id, index, url, chart_id). Use to verify a tab_switch / tab_new actually rebound, or to answer "which tab am I on?" before issuing chart commands.',
    {},
    async () => {
      try { return jsonResult(await core.getActive()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );
}
