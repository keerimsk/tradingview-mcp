import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/news.js';

export function registerNewsTools(server) {
  server.tool(
    'news_headlines',
    'Fetch TradingView news headlines from news-headlines.tradingview.com. By default returns the same general feed as TV\'s right-panel news widget. Pass symbol="EXCH:SYM" (e.g., "NASDAQ:AAPL") for symbol-specific news. Each item has id (use with news_get_story for full text), title, source, published timestamp, and related symbols.',
    {
      symbol: z.string().optional().describe('EXCH:SYMBOL — limit to news related to this symbol'),
      client: z.enum(['web', 'overview']).optional().describe('TV news feed flavor (default overview)'),
      lang: z.string().optional().describe('Language code (default en)'),
      limit: z.coerce.number().min(1).max(200).optional().describe('Max items returned (default 50)'),
    },
    async (args) => {
      try { return jsonResult(await core.getHeadlines(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'news_get_story',
    'Fetch the full text of a news story by id (id comes from news_headlines.items[].id). Returns plaintext-flattened content + short description + related symbols.',
    {
      id: z.string().describe('News story id from news_headlines (e.g., "cnbctv:26a2bc84e094b:0")'),
      lang: z.string().optional().describe('Language code (default en)'),
    },
    async (args) => {
      try { return jsonResult(await core.getStory(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
