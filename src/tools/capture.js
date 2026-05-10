import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/capture.js';

export function registerCaptureTools(server) {
  server.tool(
    'capture_screenshot',
    'Take a screenshot of the TradingView chart. Default writes a PNG to screenshots/ and returns its file path. Set return_inline=true to receive the PNG inline as MCP image content (visible to the model directly) — useful for vision-based UI control. Response always includes viewport size + devicePixelRatio so screenshot pixel coordinates can be mapped back to CSS coordinates for ui_mouse_click.',
    {
      region: z.string().optional().describe('Region: full, chart, strategy_tester (default full)'),
      filename: z.string().optional().describe('Custom filename (without extension). Forces a disk write even with return_inline.'),
      method: z.string().optional().describe('cdp (Page.captureScreenshot) or api (chartWidgetCollection.takeScreenshot) (default cdp)'),
      return_inline: z.coerce.boolean().optional().describe('Return PNG inline as MCP image content for vision workflows (default false → file path only)'),
    },
    async ({ region, filename, method, return_inline }) => {
      try {
        const r = await core.captureScreenshot({ region, filename, method, return_inline });
        const inline = r._inline_image;
        delete r._inline_image;
        if (inline) {
          return {
            content: [
              { type: 'image', data: inline.data, mimeType: inline.mimeType },
              { type: 'text', text: JSON.stringify(r, null, 2) },
            ],
          };
        }
        return jsonResult(r);
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );
}
