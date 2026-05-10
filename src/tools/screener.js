import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/screener.js';

export function registerScreenerTools(server) {
  server.tool(
    'screener_scan',
    'Run a TradingView Screener scan across an entire market (america, crypto, forex, india, uk, global, etc.). Filters on 500+ fields including fundamentals (market_cap_basic, P/E), price, volume, technicals (RSI, MACD, EMA), performance and recommendations. Returns up to 500 symbols per call. Hits scanner.tradingview.com via the page session cookies — chart indicators are NOT touched.',
    {
      market: z.string().optional().describe('Market scope: america/crypto/forex/india/uk/turkey/germany/japan/global etc. (default america)'),
      filters: z.array(
        z.object({
          field: z.string().describe('Column name (use screener_columns to list)'),
          operation: z.string().describe('Operation (use screener_operations to list): greater/less/egreater/eless/equal/in_range/match/crosses_above etc.'),
          value: z.any().describe('Compare value: number, string, [low,high] for in_range, etc.'),
        }),
      ).optional().describe('Filters (AND-combined). Empty = no filter.'),
      columns: z.array(z.string()).optional().describe('Columns to return (default name/close/change/volume/market_cap_basic/sector/RSI/ATR/P/E)'),
      sort: z.object({
        by: z.string().optional(),
        order: z.enum(['asc', 'desc']).optional(),
      }).optional().describe('Sort spec (default: market_cap_basic desc)'),
      range: z.array(z.coerce.number()).length(2).optional().describe('[from, to] pagination — max span 500 (default [0, 50])'),
      tickers: z.array(z.string()).optional().describe('Restrict scan to these EXCHANGE:SYMBOL tickers (skip = scan whole market)'),
      lang: z.string().optional().describe('Response language (default "en")'),
    },
    async (args) => {
      try { return jsonResult(await core.scan(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_columns',
    'List common screener column names + descriptions (identity, price, fundamentals, technicals, performance). Reference for screener_scan columns parameter.',
    {},
    async () => {
      try { return jsonResult(core.listColumns()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_operations',
    'List supported screener filter operations + usage examples (greater, less, in_range, match, crosses_above, etc.).',
    {},
    async () => {
      try { return jsonResult(core.listOperations()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'screener_active_list',
    'TradingView "Top movers" preset — most_active / gainers / losers / high_volume / 52w_highs / 52w_lows. Built on screener_scan with predefined filters and sort.',
    {
      list_type: z.enum(['most_active', 'gainers', 'losers', 'high_volume', '52w_highs', '52w_lows']).describe('Preset list type'),
      market: z.string().optional().describe('Market scope (default america)'),
      range: z.array(z.coerce.number()).length(2).optional().describe('[from, to] (default [0, 50], max span 500)'),
      columns: z.array(z.string()).optional().describe('Columns to return (default name/close/change/volume/market_cap_basic/sector)'),
      min_volume: z.coerce.number().optional().describe('Minimum daily volume for gainers/losers (default 1M)'),
    },
    async (args) => {
      try { return jsonResult(await core.getActiveList(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
