import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/ui.js';

export function registerUiTools(server) {
  server.tool('ui_click', 'Click a UI element by aria-label, data-name, text content, or class substring. Walks open shadow roots. Optional wait_ms polls for the element to appear; retries re-attempt the click if it failed; wait_after_ms holds before returning so the caller sees the post-click DOM.', {
    by: z.enum(['aria-label', 'data-name', 'text', 'class-contains']).describe('Selector strategy'),
    value: z.string().describe('Value to match against the chosen selector strategy'),
    wait_ms: z.coerce.number().min(0).max(5000).optional().describe('Poll up to N ms for element to appear (default 0)'),
    retries: z.coerce.number().min(0).max(3).optional().describe('Re-attempt click on failure (default 0)'),
    wait_after_ms: z.coerce.number().min(0).max(2000).optional().describe('Wait N ms after click for UI to settle (default 0)'),
  }, async ({ by, value, wait_ms, retries, wait_after_ms }) => {
    try { return jsonResult(await core.click({ by, value, wait_ms, retries, wait_after_ms })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_set_checkbox', 'Idempotently set a checkbox to checked/unchecked. Reads current state and only clicks if mismatched. Locates by visible label (associated <label for=...>, ancestor <label>, aria-label, or proximity), or by selector strategy.', {
    label: z.string().optional().describe('Visible label text near the checkbox'),
    by: z.enum(['aria-label', 'data-name', 'class-contains']).optional().describe('Alternative: selector strategy'),
    value: z.string().optional().describe('Selector value (required if by is given)'),
    checked: z.coerce.boolean().describe('Desired state'),
  }, async ({ label, by, value, checked }) => {
    try { return jsonResult(await core.setCheckbox({ label, by, value, checked })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_hover_and_click', 'Composite: hover a trigger element, then click a target that appears after hover (e.g., menu items). Waits for the target up to wait_ms.', {
    hover_by: z.enum(['aria-label', 'data-name', 'text', 'class-contains']).describe('Hover trigger selector strategy'),
    hover_value: z.string().describe('Hover trigger value'),
    click_by: z.enum(['aria-label', 'data-name', 'text', 'class-contains']).describe('Click target selector strategy'),
    click_value: z.string().describe('Click target value'),
    wait_ms: z.coerce.number().min(0).max(5000).optional().describe('Wait up to N ms for click target after hover (default 1000)'),
  }, async ({ hover_by, hover_value, click_by, click_value, wait_ms }) => {
    try { return jsonResult(await core.hoverAndClick({ hover_by, hover_value, click_by, click_value, wait_ms })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_drag', 'Drag from (from_x, from_y) to (to_x, to_y) with interpolated mouseMoved events. Useful for chart drawing tools and pan operations. coords_are="screenshot_pixels" if coordinates were read off a screenshot at devicePixelRatio>1.', {
    from_x: z.coerce.number().describe('Start X (CSS pixels by default)'),
    from_y: z.coerce.number().describe('Start Y'),
    to_x: z.coerce.number().describe('End X'),
    to_y: z.coerce.number().describe('End Y'),
    button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default left)'),
    steps: z.coerce.number().min(2).max(100).optional().describe('Interpolation steps (default 20)'),
    coords_are: z.enum(['css', 'screenshot_pixels']).optional().describe('Coordinate space (default css)'),
  }, async ({ from_x, from_y, to_x, to_y, button, steps, coords_are }) => {
    try { return jsonResult(await core.drag({ from_x, from_y, to_x, to_y, button, steps, coords_are })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_viewport', 'Get the chart window viewport size and devicePixelRatio. Use to map screenshot pixels back to CSS coordinates for ui_mouse_click.', {}, async () => {
    try { return jsonResult(await core.getViewport()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_open_panel', 'Open, close, or toggle TradingView panels (pine-editor, strategy-tester, watchlist, alerts, trading). For the Screener panel use pine_screener_open instead.', {
    panel: z.enum(['pine-editor', 'strategy-tester', 'watchlist', 'alerts', 'trading']).describe('Panel name'),
    action: z.enum(['open', 'close', 'toggle']).describe('Action to perform'),
  }, async ({ panel, action }) => {
    try { return jsonResult(await core.openPanel({ panel, action })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_fullscreen', 'Toggle TradingView fullscreen mode', {}, async () => {
    try { return jsonResult(await core.fullscreen()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('layout_list', 'List saved chart layouts', {}, async () => {
    try { return jsonResult(await core.layoutList()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('layout_switch', 'Switch to a saved chart layout by name or ID', {
    name: z.string().describe('Name or ID of the layout to switch to'),
  }, async ({ name }) => {
    try { return jsonResult(await core.layoutSwitch({ name })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_keyboard', 'Press keyboard keys or shortcuts (e.g., Enter, Escape, Alt+S, Ctrl+Z)', {
    key: z.string().describe('Key to press (e.g., "Enter", "Escape", "Tab", "a", "ArrowUp")'),
    modifiers: z.array(z.enum(['ctrl', 'alt', 'shift', 'meta'])).optional().describe('Modifier keys to hold (e.g., ["ctrl", "shift"])'),
  }, async ({ key, modifiers }) => {
    try { return jsonResult(await core.keyboard({ key, modifiers })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_type_text', 'Type text into the currently focused input/textarea element', {
    text: z.string().describe('Text to type into the focused element'),
  }, async ({ text }) => {
    try { return jsonResult(await core.typeText({ text })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_hover', 'Hover over a UI element by aria-label, data-name, or text content', {
    by: z.enum(['aria-label', 'data-name', 'text', 'class-contains']).describe('Selector strategy'),
    value: z.string().describe('Value to match'),
  }, async ({ by, value }) => {
    try { return jsonResult(await core.hover({ by, value })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_scroll', 'Scroll the chart or page up/down/left/right', {
    direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
    amount: z.coerce.number().optional().describe('Scroll amount in pixels (default 300)'),
  }, async ({ direction, amount }) => {
    try { return jsonResult(await core.scroll({ direction, amount })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_mouse_click', 'Click at specific x,y coordinates on the TradingView window. CDP expects CSS pixels — if you read coordinates off a screenshot at devicePixelRatio>1, set coords_are="screenshot_pixels" so the values get divided by DPR before clicking.', {
    x: z.coerce.number().describe('X coordinate'),
    y: z.coerce.number().describe('Y coordinate'),
    button: z.enum(['left', 'right', 'middle']).optional().describe('Mouse button (default left)'),
    double_click: z.coerce.boolean().optional().describe('Double click (default false)'),
    coords_are: z.enum(['css', 'screenshot_pixels']).optional().describe('Coordinate space (default css)'),
  }, async ({ x, y, button, double_click, coords_are }) => {
    try { return jsonResult(await core.mouseClick({ x, y, button, double_click, coords_are })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_find_element', 'Find UI elements by text, aria-label, or CSS selector and return their positions', {
    query: z.string().describe('Text content, aria-label value, or CSS selector to search for'),
    strategy: z.enum(['text', 'aria-label', 'css']).optional().describe('Search strategy (default: text)'),
  }, async ({ query, strategy }) => {
    try { return jsonResult(await core.findElement({ query, strategy })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('ui_evaluate', 'Execute JavaScript code in the TradingView page context for advanced automation', {
    expression: z.string().describe('JavaScript expression to evaluate in the page context. Wrap in IIFE for complex logic.'),
  }, async ({ expression }) => {
    try { return jsonResult(await core.uiEvaluate({ expression })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
