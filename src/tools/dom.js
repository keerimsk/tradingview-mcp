import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/dom.js';

export function registerDomTools(server) {
  server.tool(
    'dom_read',
    'Read the Depth of Market (DOM / Piyasa Derinliği) ladder. Returns best_bid, best_ask, spread, total sizes, plus per-level bids[] + asks[] (sorted best-first). Pre-condition: DOM panel must be open in TradingView. DOM is a Premium/Ultimate broker-bound widget — Paper Trading does NOT have DOM data; you need a real broker connection (TradeStation, IBKR, AMP, OANDA, etc.) and to select "DOM" mode in the bottom-left Trade button.',
    {
      depth: z.coerce.number().min(1).max(100).optional().describe('Max bids/asks levels to return (default 20)'),
    },
    async ({ depth }) => {
      try { return jsonResult(await core.read({ depth })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
