import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/dialog.js';

export function registerDialogTools(server) {
  server.tool(
    'ui_dialog',
    'Inspect or interact with the active modal/dialog. Detects topmost visible dialog by role/class + z-index. Actions: describe (returns title/buttons/checkboxes/inputs with intent guesses), click_button (by intent or exact label), dismiss (auto-click discard/cancel button if present).',
    {
      action: z.enum(['describe', 'click_button', 'dismiss']).describe('Action: describe / click_button / dismiss'),
      intent: z.enum(['confirm', 'cancel', 'discard', 'save', 'ok', 'yes', 'no', 'close']).optional()
        .describe('For click_button: semantic intent. Maps to ranked button-text candidates (e.g., discard → ["Don\'t save", "Discard", "Open anyway"]).'),
      label: z.string().optional()
        .describe('For click_button: exact button label override (case-insensitive). Falls back to substring match.'),
      intents: z.array(z.string()).optional()
        .describe('For dismiss: ordered list of intents to try (default: ["discard", "cancel"]).'),
    },
    async ({ action, intent, label, intents }) => {
      try {
        if (action === 'describe') {
          return jsonResult(await core.describe());
        }
        if (action === 'click_button') {
          return jsonResult(await core.clickButton({ intent, label }));
        }
        if (action === 'dismiss') {
          return jsonResult(await core.dismissIfPresent({ intents }));
        }
        return jsonResult({ success: false, error: `Unknown action: ${action}` }, true);
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );
}
