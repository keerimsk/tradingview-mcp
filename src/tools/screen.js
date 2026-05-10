import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/screen.js';

export function registerScreenTools(server) {
  server.tool(
    'ui_screen_inspect',
    'Take an annotated screenshot: 100px coordinate grid + bounding-box overlays for every visible clickable element (button, link, role=button/checkbox/tab/menuitem, input). Default returns the PNG inline as MCP image content for vision-based UI control. Use the screenshot to estimate pixel coordinates, then call ui_mouse_click(coords_are: "screenshot_pixels") to act on them.',
    {
      grid: z.coerce.boolean().optional().describe('Draw coordinate grid (default true)'),
      grid_step: z.coerce.number().min(20).max(500).optional().describe('Grid step in CSS pixels (default 100)'),
      boxes: z.coerce.boolean().optional().describe('Draw clickable bounding boxes (default true)'),
      max_boxes: z.coerce.number().min(0).max(300).optional().describe('Cap the number of boxes drawn (default 80)'),
      labels: z.coerce.boolean().optional().describe('Label boxes with data-name/aria-label/text (default true)'),
      return_inline: z.coerce.boolean().optional().describe('Return PNG inline (default true). When false, writes to disk only.'),
      filename: z.string().optional().describe('Custom filename (forces a disk write even with return_inline)'),
    },
    async (args) => {
      try {
        const r = await core.inspect(args || {});
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
