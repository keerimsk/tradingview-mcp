import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/ticks.js';

export function registerTickTools(server) {
  server.tool('data_get_ticks',
    'Read recent tick prints from TradingView\'s Time & Sales panel. Returns last N ticks with price, size, side, time.',
    {
      limit: z.coerce.number().int().min(1).max(500).default(50).describe('Maximum ticks to return (1-500)'),
      since: z.string().optional().describe('ISO timestamp filter — only return ticks at or after this time'),
    },
    async ({ limit, since }) => {
      try { return jsonResult(await core.getTicks({ limit, since })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });
}
