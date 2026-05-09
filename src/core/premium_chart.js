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
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as pineCore from './pine.js';
import * as chartCore from './chart.js';
import * as indicatorCore from './indicators.js';

export const MAGIC_VP  = 'MCP_VP_v1';
export const MAGIC_TPO = 'MCP_TPO_v1';
export const HELPER_NAME = 'TV-MCP Helper';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    getChartApi: deps?.getChartApi || _getChartApi,
    setInputs: deps?.setInputs || indicatorCore.setInputs,
    manageIndicator: deps?.manageIndicator || chartCore.manageIndicator,
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

export async function findHelperStudy({ _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const studies = await evaluate(`
    (function() {
      var api = ${apiPath};
      var widget = api._chartWidget;
      var sources = widget.model().model().dataSources();
      var out = [];
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var nm = meta.description || meta.shortDescription || '';
          out.push({ id: s.id ? s.id() : null, name: nm });
        } catch(e) {}
      }
      return out;
    })()
  `);
  const found = (studies || []).find(s => s.name === HELPER_NAME);
  return found ? found.id : null;
}

export async function readHelperTable(expectedMagic, { _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const studyName = HELPER_NAME;

  const tableData = await evaluate(`
    (function() {
      var api = ${apiPath};
      var widget = api._chartWidget;
      var sources = widget.model().model().dataSources();
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (name !== ${safeString(studyName)}) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) return null;
          var pc = g._primitivesCollection;
          var tcOuter = pc.dwgtablecells;
          if (!tcOuter) return null;
          var tcColl = tcOuter.get('tableCells');
          if (!tcColl || !tcColl._primitivesDataById) return null;
          var cells = [];
          tcColl._primitivesDataById.forEach(function(v, id) { cells.push({ id: id, raw: v }); });
          return cells;
        } catch(e) { return { _err: e.message }; }
      }
      return null;
    })()
  `);

  if (!tableData) {
    throw new Error(`${HELPER_NAME} indicator not found on chart. Run 'tv premium install-helper' or add it manually.`);
  }
  if (tableData._err) throw new Error('Table read error: ' + tableData._err);

  const rowsMap = new Map();
  for (const cell of tableData) {
    const r = cell.raw?.row ?? cell.raw?.rowIndex ?? cell.raw?.points?.[0]?.row;
    const c = cell.raw?.column ?? cell.raw?.colIndex ?? cell.raw?.points?.[0]?.column;
    const text = cell.raw?.text ?? cell.raw?.cellText ?? cell.raw?.value ?? '';
    if (r === undefined || c === undefined) continue;
    if (!rowsMap.has(r)) rowsMap.set(r, []);
    rowsMap.get(r)[c] = String(text);
  }

  const sorted = [...rowsMap.entries()].sort((a, b) => a[0] - b[0]).map(([, cols]) => cols);
  return parseMcpTable(sorted, expectedMagic);
}

export async function installHelper({ _deps } = {}) {
  const existing = await findHelperStudy({ _deps });
  if (existing) {
    return { success: true, action: 'already_installed', study_id: existing };
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const pinePath = join(here, '..', '..', 'pine', 'mcp-helper.pine');
  const source = await readFile(pinePath, 'utf-8');

  // pine.js: setSource({ source }), smartCompile() (no args), save() (no args — Ctrl+S)
  // chart.js: manageIndicator({ action, indicator }) — parameter is 'indicator', not 'name'
  await pineCore.setSource({ source });
  await pineCore.smartCompile();
  await pineCore.save();
  await chartCore.manageIndicator({ action: 'add', indicator: HELPER_NAME });

  await new Promise(r => setTimeout(r, 800));
  const newId = await findHelperStudy({ _deps });
  if (!newId) {
    throw new Error('installHelper: helper indicator added but cannot be found on chart.');
  }
  return { success: true, action: 'installed', study_id: newId };
}

const VP_VARIANTS = ['visible_range', 'fixed_range', 'session'];

export async function vpAdd({ variant = 'visible_range', rows = 24, va_pct = 0.7, _deps } = {}) {
  if (!VP_VARIANTS.includes(variant)) {
    throw new Error(`vpAdd: invalid variant "${variant}". Must be one of ${VP_VARIANTS.join(', ')}.`);
  }
  if (!Number.isInteger(rows) || rows < 4 || rows > 200) {
    throw new Error(`vpAdd: rows must be integer 4..200, got ${rows}`);
  }
  if (typeof va_pct !== 'number' || va_pct < 0.1 || va_pct > 0.99) {
    throw new Error(`vpAdd: va_pct must be number 0.1..0.99, got ${va_pct}`);
  }

  const { setInputs } = _resolve(_deps);
  const studyId = await findHelperStudy({ _deps });
  if (!studyId) {
    throw new Error(`${HELPER_NAME} not found. Run 'tv premium install-helper' first.`);
  }

  await setInputs({
    entity_id: studyId,
    inputs: { mode: 'vp', vp_variant: variant, vp_rows: rows, vp_va_pct: va_pct },
  });

  return { success: true, study_id: studyId, variant, rows, va_pct };
}
