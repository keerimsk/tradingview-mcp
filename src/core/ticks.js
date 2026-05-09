/**
 * Read recent tick prints from TradingView's Time & Sales panel.
 *
 * IMPORTANT — selectors below are placeholders. The controller must replace
 * them with values discovered from a live probe (see plan Phase 3.0/6.2).
 * If the panel selector does not match in production, getTicks returns a
 * clear error directing the user to open Time & Sales manually.
 */
import {
  evaluate as _evaluate,
  getChartApi as _getChartApi,
} from '../connection.js';

// CONTROLLER: replace these placeholders with values from Phase 6.2 probe.
const PANEL_ROOT_SELECTOR = '[data-name="time-sales"]'; // PROBE-PENDING
const ROW_SELECTOR        = '.time-sales-row';          // PROBE-PENDING
const FIELD_TIME_SEL      = '.cell-time';               // PROBE-PENDING
const FIELD_PRICE_SEL     = '.cell-price';              // PROBE-PENDING
const FIELD_SIZE_SEL      = '.cell-size';               // PROBE-PENDING
const FIELD_SIDE_SEL      = '.cell-side';               // PROBE-PENDING (may be absent; fall back to row-level color class)

export function parseTickRow(row, sessionDateMs) {
  if (!row || row.price == null) return null;
  const price = Number(row.price);
  if (!Number.isFinite(price)) return null;
  const size = Number(row.size);
  let timeIso = null;
  if (row.time) {
    const m = String(row.time).match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (m) {
      const ms = sessionDateMs + (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + (Number(m[4] || 0));
      timeIso = new Date(ms).toISOString();
    }
  }
  let side = null;
  if (row.side === 'buy' || row.side === 'sell') side = row.side;
  else if (row.sideClass) {
    if (/buy|up|green/i.test(row.sideClass)) side = 'buy';
    else if (/sell|down|red/i.test(row.sideClass)) side = 'sell';
  }
  return {
    time: timeIso,
    price,
    size: Number.isFinite(size) ? size : null,
    side,
  };
}

function _resolve(deps) {
  return {
    evaluate:        deps?.evaluate        || _evaluate,
    getChartApi:     deps?.getChartApi     || _getChartApi,
    ensurePanelOpen: deps?.ensurePanelOpen || _ensurePanelOpen,
    readRawRows:     deps?.readRawRows     || _readRawRows,
    sessionDateMs:   deps?.sessionDateMs   || (() => {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    }),
  };
}

async function _ensurePanelOpen() {
  const exists = await _evaluate(`!!document.querySelector(${JSON.stringify(PANEL_ROOT_SELECTOR)})`);
  if (exists) return true;
  await _evaluate(`
    (function() {
      var btn = document.querySelector('[aria-label*="Time & Sales" i]')
             || document.querySelector('[data-name*="time-sales" i]');
      if (btn) btn.click();
      return !!btn;
    })()
  `);
  await new Promise(r => setTimeout(r, 500));
  return await _evaluate(`!!document.querySelector(${JSON.stringify(PANEL_ROOT_SELECTOR)})`);
}

async function _readRawRows() {
  return await _evaluate(`
    (function() {
      var root = document.querySelector(${JSON.stringify(PANEL_ROOT_SELECTOR)});
      if (!root) return [];
      var rows = root.querySelectorAll(${JSON.stringify(ROW_SELECTOR)});
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var time  = (r.querySelector(${JSON.stringify(FIELD_TIME_SEL)}) || {}).textContent;
        var price = (r.querySelector(${JSON.stringify(FIELD_PRICE_SEL)}) || {}).textContent;
        var size  = (r.querySelector(${JSON.stringify(FIELD_SIZE_SEL)}) || {}).textContent;
        var sideEl = r.querySelector(${JSON.stringify(FIELD_SIDE_SEL)});
        var side = sideEl ? (sideEl.textContent || '').trim().toLowerCase() : null;
        out.push({ time: (time || '').trim(), price: (price || '').trim(), size: (size || '').trim(), side: side, sideClass: r.className });
      }
      return out;
    })()
  `);
}

export async function getTicks({ limit = 50, since, _deps } = {}) {
  const { ensurePanelOpen, readRawRows, sessionDateMs } = _resolve(_deps);
  const open = await ensurePanelOpen();
  if (!open) {
    return {
      success: false,
      error: 'Time & Sales panel could not be opened. Open it manually and retry.',
    };
  }

  const rawRows = await readRawRows();
  const dayMs = sessionDateMs();
  const sinceMs = since ? Date.parse(since) : null;
  if (since && !Number.isFinite(sinceMs)) {
    return { success: false, error: `Invalid 'since' timestamp: ${since}` };
  }

  const ticks = [];
  for (const row of rawRows || []) {
    const t = parseTickRow(row, dayMs);
    if (!t) continue;
    if (sinceMs && t.time && Date.parse(t.time) < sinceMs) continue;
    ticks.push(t);
    if (ticks.length >= Math.max(1, Math.min(500, limit))) break;
  }
  return {
    success: true,
    tick_count: ticks.length,
    panel_open: true,
    ticks,
  };
}
