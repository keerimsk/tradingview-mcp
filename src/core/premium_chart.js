/**
 * Core logic for premium chart types: Volume Profile, TPO, auto-patterns,
 * Footprint, Bar Magnifier.
 *
 * Reads structured data emitted by pine/mcp-helper.pine via magic-header tables,
 * and toggles native chart-type / settings via existing UI primitives.
 */
import {
  evaluate as _evaluate,
  getChartApi as _getChartApi,
  safeString,
} from '../connection.js';

export const MAGIC_VP  = 'MCP_VP_v1';
export const MAGIC_TPO = 'MCP_TPO_v1';
export const HELPER_NAME = 'TV-MCP Helper';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    getChartApi: deps?.getChartApi || _getChartApi,
  };
}

export function parseMcpTable(rows, expectedMagic) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('parseMcpTable: empty table');
  }
  const [magic, variantOrSession] = rows[0];
  if (magic !== expectedMagic) {
    throw new Error(`parseMcpTable: magic header mismatch — got "${magic}", expected "${expectedMagic}"`);
  }

  if (expectedMagic === MAGIC_VP) {
    const summary = {};
    const bins = [];
    for (let i = 1; i < rows.length; i++) {
      const [k, v] = rows[i];
      if (['poc', 'vah', 'val', 'total_volume', 'va_pct', 'rows'].includes(k)) {
        summary[k] = Number(v);
      } else {
        const price = Number(k);
        const volume = Number(v);
        if (Number.isFinite(price) && Number.isFinite(volume)) {
          bins.push({ price, volume });
        }
      }
    }
    return {
      variant: variantOrSession,
      poc: summary.poc,
      vah: summary.vah,
      val: summary.val,
      total_volume: summary.total_volume,
      value_area_pct: summary.va_pct,
      bins,
    };
  }

  if (expectedMagic === MAGIC_TPO) {
    const summary = { session: variantOrSession };
    const letter_rows = [];
    for (let i = 1; i < rows.length; i++) {
      const [k, v] = rows[i];
      if (['period_min', 'levels'].includes(k)) summary[k] = Number(v);
      else if (['poc', 'vah', 'val', 'ib_high', 'ib_low'].includes(k)) summary[k] = Number(v);
      else {
        const price = Number(k);
        if (Number.isFinite(price)) letter_rows.push({ price, letters: v || '' });
      }
    }
    return {
      session: summary.session,
      period_min: summary.period_min,
      poc: summary.poc,
      value_area: { vah: summary.vah, val: summary.val },
      initial_balance: { high: summary.ib_high, low: summary.ib_low },
      letter_rows,
      single_prints: letter_rows.filter(r => r.letters.length === 1),
    };
  }

  throw new Error(`parseMcpTable: unsupported magic "${expectedMagic}"`);
}
