import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/pine_screener.js';

export function registerPineScreenerTools(server) {
  server.tool(
    'pine_screener_open',
    'Open the TradingView Screener side panel (header toolbar [data-name="screener-dialog-button"]). The panel hosts both Classic and Pine Screener saved screens. Does NOT touch chart indicators. For pure REST scanning prefer screener_scan; use this only when you need UI-side state or saved Pine Screener screens.',
    {},
    async () => {
      try { return jsonResult(await core.open()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'pine_screener_close',
    'Close the Screener side panel (toggles the same header button).',
    {},
    async () => {
      try { return jsonResult(await core.close()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'pine_screener_status',
    'Read current Screener panel state from the DOM: panel_open, screen_name (e.g. "All stocks" or your saved Pine screen), filter_pill_count, row_count (visible results), running.',
    {},
    async () => {
      try { return jsonResult(await core.status()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'pine_screener_run',
    'Open the Screener panel, optionally switch to a saved screen by name (Pine Screener screens supported on Premium/Ultimate), wait for results, scrape the visible table. If UI selectors fail, the response includes a screenshot at result.fallback.file_path for visual diagnosis. Does NOT add anything to the chart.',
    {
      screen_name: z.string().optional().describe('Saved screen name to switch to (e.g. a Pine Screener screen you saved). Skip to read whatever screen is currently active.'),
      timeout_ms: z.coerce.number().min(5000).max(180000).optional().describe('Max time to wait for results to populate (default 30000)'),
      max_rows: z.coerce.number().min(1).max(500).optional().describe('Cap rows returned (default 100)'),
    },
    async (args) => {
      try { return jsonResult(await core.run(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
