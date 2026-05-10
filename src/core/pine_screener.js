/**
 * Screener / Pine Screener UI driver.
 *
 * Live DOM discovery showed that in the current TradingView Desktop UI:
 *   - Classic Screener opens via a header toolbar button: [data-name="screener-dialog-button"]
 *   - The panel that opens contains [class*="screenerContainer"], with filter
 *     pills [data-name^="screener-filter-pill-"] and a topbar screen-title.
 *   - Pine Screener mode is a Premium/Ultimate variant — its mode-switch is
 *     environment-dependent (not always visible in this UI). When available
 *     we surface it through vision tools rather than guess selectors.
 *
 * Constraint: never calls chart_manage_indicator. The Screener panel is a
 * separate UI surface; opening/running it does NOT mutate chart indicators.
 */
import { evaluate } from '../connection.js';
import { dismissIfPresent } from './dialog.js';
import { inspect as screenInspect } from './screen.js';

const PANEL_OPEN_DELAY_MS = 600;
const RUN_POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_ROWS = 100;

const SCREENER_BUTTON_SELECTOR = '[data-name="screener-dialog-button"]';
const SCREENER_CONTAINER_SELECTOR = '[class*="screenerContainer"]';

async function ensurePanelOpen() {
  const result = await evaluate(`
    (function() {
      var container = document.querySelector(${JSON.stringify(SCREENER_CONTAINER_SELECTOR)});
      if (container && container.offsetParent) {
        return { was_open: true, performed: 'already_open', method: 'detected' };
      }
      var btn = document.querySelector(${JSON.stringify(SCREENER_BUTTON_SELECTOR)});
      if (!btn) return { was_open: false, performed: 'not_opened', method: 'button_missing' };
      btn.click();
      return { was_open: false, performed: 'opened', method: 'screener_dialog_button' };
    })()
  `);
  if (result?.performed === 'opened') {
    await new Promise(r => setTimeout(r, PANEL_OPEN_DELAY_MS));
  }
  return result;
}

async function ensurePanelClosed() {
  return evaluate(`
    (function() {
      var container = document.querySelector(${JSON.stringify(SCREENER_CONTAINER_SELECTOR)});
      if (!container || !container.offsetParent) {
        return { performed: 'already_closed' };
      }
      var btn = document.querySelector(${JSON.stringify(SCREENER_BUTTON_SELECTOR)});
      if (!btn) return { performed: 'no_op', reason: 'button_missing' };
      btn.click();
      return { performed: 'closed' };
    })()
  `);
}

export async function open() {
  const r = await ensurePanelOpen();
  return {
    success: !!r && (r.performed === 'opened' || r.performed === 'already_open'),
    panel: 'pine-screener',
    was_open: !!r?.was_open,
    performed: r?.performed || 'unknown',
    method: r?.method || null,
  };
}

export async function close() {
  const r = await ensurePanelClosed();
  return { success: true, panel: 'pine-screener', performed: r?.performed || 'closed' };
}

/**
 * Read current Screener panel state: open?, current screen name (e.g. "All
 * stocks" / a Pine Screener name), filter pill count, visible row count.
 */
export async function status() {
  const info = await evaluate(`
    (function() {
      var panel = document.querySelector(${JSON.stringify(SCREENER_CONTAINER_SELECTOR)});
      if (!panel || !panel.offsetParent) {
        return { panel_open: false };
      }
      var titleEl = panel.querySelector('[data-name="screener-topbar-screen-title"]');
      var screenName = titleEl ? (titleEl.textContent || '').trim() : null;
      var filterPills = panel.querySelectorAll('[data-name^="screener-filter-pill-"]');
      var rows = panel.querySelectorAll('table tbody tr, [role="row"][aria-rowindex]');
      var prog = panel.querySelector('[role="progressbar"], [class*="progress"]');
      var running = !!(prog && prog.offsetParent);
      return {
        panel_open: true,
        screen_name: screenName,
        filter_pill_count: filterPills.length,
        row_count: rows.length,
        running: running,
      };
    })()
  `);
  return { success: true, ...info };
}

async function pickScreenByName(screen_name) {
  // Click the screen-title button to open the saved-screens dropdown
  const opened = await evaluate(`
    (function() {
      var panel = document.querySelector(${JSON.stringify(SCREENER_CONTAINER_SELECTOR)});
      if (!panel) return false;
      var title = panel.querySelector('[data-name="screener-topbar-screen-title"]');
      if (!title) return false;
      title.click();
      return true;
    })()
  `);
  if (!opened) return false;
  await new Promise(r => setTimeout(r, 250));
  const picked = await evaluate(`
    (function() {
      var target = ${JSON.stringify(screen_name)};
      var lc = target.toLowerCase();
      var items = document.querySelectorAll('[role="menuitem"], [role="option"], li, [class*="screenItem"], [class*="item"]');
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it.offsetParent) continue;
        var t = (it.textContent || '').trim();
        if (t.toLowerCase() === lc || (t.length < 80 && t.toLowerCase().indexOf(lc) !== -1)) {
          it.click();
          return { picked: t.substring(0, 80) };
        }
      }
      return null;
    })()
  `);
  return picked;
}

async function waitForResults({ timeout_ms }) {
  const deadline = Date.now() + timeout_ms;
  let lastCount = -1;
  let stableTicks = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, RUN_POLL_INTERVAL_MS));
    const s = await status();
    if (!s.panel_open) return { completed: false, reason: 'panel_closed' };
    if (!s.running && s.row_count > 0 && s.row_count === lastCount) {
      stableTicks++;
      if (stableTicks >= 2) return { completed: true, row_count: s.row_count };
    } else {
      stableTicks = 0;
    }
    lastCount = s.row_count;
  }
  return { completed: false, reason: 'timeout', last_row_count: lastCount };
}

async function scrapeResults({ max_rows }) {
  return evaluate(`
    (function() {
      var panel = document.querySelector(${JSON.stringify(SCREENER_CONTAINER_SELECTOR)});
      if (!panel) return { error: 'panel_not_found' };

      var headers = [];
      var headerEls = panel.querySelectorAll('thead th, [role="columnheader"]');
      for (var h = 0; h < headerEls.length; h++) {
        headers.push((headerEls[h].textContent || '').trim());
      }

      var rowsOut = [];
      var rowEls = panel.querySelectorAll('tbody tr, [role="row"][aria-rowindex]');
      var max = ${Number(max_rows) || DEFAULT_MAX_ROWS};
      for (var i = 0; i < rowEls.length && rowsOut.length < max; i++) {
        var r = rowEls[i];
        var cells = r.querySelectorAll('td, [role="cell"]');
        if (cells.length === 0) continue;
        var rec = { _raw: [] };
        var symbol = null;
        for (var c = 0; c < cells.length; c++) {
          var v = (cells[c].textContent || '').trim();
          rec._raw.push(v);
          var key = headers[c] || ('col' + c);
          rec[key] = v;
          if (!symbol && (key.toLowerCase() === 'symbol' || key.toLowerCase() === 'ticker' || c === 0)) {
            symbol = v;
          }
        }
        if (symbol) rec.symbol = symbol;
        rowsOut.push(rec);
      }
      return { headers: headers, rows: rowsOut };
    })()
  `);
}

/**
 * Open the Screener panel, optionally pick a saved screen by name (supports
 * Pine Screener saved screens on Premium/Ultimate accounts), wait for
 * results to populate, scrape the visible table.
 *
 * NOTE: The classic Screener supports running directly via the screener_scan
 * REST tool, which is faster and doesn't depend on UI. Use this UI-driven
 * path when:
 *   - You need to use a Pine Screener (saved screen running a Pine indicator)
 *   - You want to verify what the user is currently looking at on screen
 *   - You need to interact with state that REST doesn't expose
 *
 * If selectors fail (TV layout drift), the response includes a screenshot
 * fallback at result.fallback.file_path so the model can diagnose visually.
 */
export async function run({
  screen_name,
  timeout_ms = DEFAULT_TIMEOUT_MS,
  max_rows = DEFAULT_MAX_ROWS,
} = {}) {
  const startedAt = Date.now();

  const opened = await open();
  if (!opened.success) {
    return {
      success: false,
      error: 'Could not open Screener panel',
      open_result: opened,
      hint: 'Run ui_screen_inspect to diagnose UI state, or use screener_scan (REST) for classic screening.',
      fallback: await fallbackScreenshot(),
    };
  }

  await dismissIfPresent({ intents: ['cancel', 'close'] });

  let picked = null;
  if (screen_name) {
    picked = await pickScreenByName(screen_name);
    if (!picked) {
      return {
        success: false,
        error: `Could not select saved screen "${screen_name}". Make sure it exists in your Screener saved screens list.`,
        stage: 'screen_select',
        fallback: await fallbackScreenshot(),
      };
    }
    await new Promise(r => setTimeout(r, 600));
  }

  const completion = await waitForResults({ timeout_ms });
  const scraped = await scrapeResults({ max_rows });
  const runtime_ms = Date.now() - startedAt;

  if (scraped?.error || !Array.isArray(scraped?.rows) || scraped.rows.length === 0) {
    return {
      success: false,
      error: scraped?.error || 'No rows in result table',
      screen_name: screen_name || null,
      picked: picked?.picked || null,
      completion,
      runtime_ms,
      fallback: await fallbackScreenshot(),
    };
  }

  return {
    success: completion.completed,
    screen_name: screen_name || null,
    picked: picked?.picked || null,
    timed_out: !completion.completed,
    headers: scraped.headers,
    total_rows: scraped.rows.length,
    rows: scraped.rows,
    runtime_ms,
  };
}

async function fallbackScreenshot() {
  try {
    const r = await screenInspect({
      grid: true,
      boxes: true,
      labels: true,
      return_inline: false,
      filename: `pine_screener_fallback_${Date.now()}`,
    });
    return {
      type: 'annotated_screenshot',
      file_path: r.file_path,
      hint: 'Inspect this screenshot to diagnose Pine Screener UI state',
    };
  } catch (e) {
    return { type: 'screenshot_failed', error: e.message };
  }
}
