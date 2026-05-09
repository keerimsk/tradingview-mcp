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
    evaluate:        deps?.evaluate        || _evaluate,
    getChartApi:     deps?.getChartApi     || _getChartApi,
    setInputs:       deps?.setInputs       || indicatorCore.setInputs,
    manageIndicator: deps?.manageIndicator || chartCore.manageIndicator,
    setType:         deps?.setType         || chartCore.setType,
    getChartState:   deps?.getChartState   || chartCore.getState,
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

export async function vpGet({ bins_limit = 100, _deps } = {}) {
  const parsed = await readHelperTable(MAGIC_VP, { _deps });
  const bins = parsed.bins.slice(0, Math.max(1, Math.min(500, bins_limit)));
  return {
    success: true,
    variant: parsed.variant,
    poc: parsed.poc,
    vah: parsed.vah,
    val: parsed.val,
    value_area_pct: parsed.value_area_pct,
    total_volume: parsed.total_volume,
    bins,
  };
}

export async function vpRemove({ _deps } = {}) {
  const { manageIndicator } = _resolve(_deps);
  const id = await findHelperStudy({ _deps });
  if (!id) return { success: true, removed: false };
  await manageIndicator({ action: 'remove', indicator: HELPER_NAME });
  return { success: true, removed: true };
}

export const PATTERN_STUDY_NAMES = {
  candlestick: 'All Candlestick Patterns',
  harmonic:    'Harmonic Patterns',
  auto_fib:    'Auto Fib Retracement',
};

export async function patternsAdd({ kinds = [], _deps } = {}) {
  if (!Array.isArray(kinds) || kinds.length === 0) {
    throw new Error('patternsAdd: provide at least one kind');
  }
  for (const k of kinds) {
    if (!(k in PATTERN_STUDY_NAMES)) {
      throw new Error(`patternsAdd: unknown kind "${k}". Allowed: ${Object.keys(PATTERN_STUDY_NAMES).join(', ')}`);
    }
  }
  const { manageIndicator } = _resolve(_deps);
  const added = [];
  for (const kind of kinds) {
    const name = PATTERN_STUDY_NAMES[kind];
    const r = await manageIndicator({ action: 'add', indicator: name });
    added.push({ kind, name, study_id: r?.entity_id || r?.id || null });
  }
  return { success: true, added };
}

const STUDY_NAME_TO_KIND = Object.fromEntries(
  Object.entries(PATTERN_STUDY_NAMES).map(([k, v]) => [v, k])
);

export async function patternsList({ kinds, max_per_kind = 25, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();

  const allowedNames = (kinds && kinds.length > 0)
    ? kinds.map(k => PATTERN_STUDY_NAMES[k]).filter(Boolean)
    : Object.values(PATTERN_STUDY_NAMES);

  const studiesWithLabels = await evaluate(`
    (function() {
      var api = ${apiPath};
      var widget = api._chartWidget;
      var sources = widget.model().model().dataSources();
      var allowed = ${JSON.stringify(allowedNames)};
      var out = [];
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (allowed.indexOf(name) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          var pc = g._primitivesCollection;
          var lblOuter = pc.dwglabels;
          if (!lblOuter) continue;
          var lblColl = lblOuter.get('labels');
          if (!lblColl) continue;
          var inner = lblColl.get(false);
          if (!inner || !inner._primitivesDataById) continue;
          var items = [];
          inner._primitivesDataById.forEach(function(v, id) { items.push({ id: id, raw: v }); });
          if (items.length > 0) out.push({ name: name, items: items });
        } catch(e) {}
      }
      return out;
    })()
  `);

  const patterns = [];
  for (const st of (studiesWithLabels || [])) {
    if (!allowedNames.includes(st.name)) continue;
    const kind = STUDY_NAME_TO_KIND[st.name];
    const cap = Math.max(1, Math.min(200, max_per_kind));
    const items = (st.items || []).slice(0, cap);
    for (const item of items) {
      const text  = item.raw?.text ?? item.raw?.label ?? '';
      const point = item.raw?.points?.[0] ?? item.raw?.point ?? {};
      const price = Number(point.price);
      const time  = Number(point.time);
      patterns.push({
        kind,
        name: String(text || '').trim(),
        price: Number.isFinite(price) ? price : null,
        bar_time: Number.isFinite(time) ? new Date(time * 1000).toISOString() : null,
      });
    }
  }

  return { success: true, patterns };
}

// ── Task 4.1: tpoAdd ─────────────────────────────────────────────────────────

export async function tpoAdd({ period_min = 30, session = 'RTH', va_pct = 0.7, _deps } = {}) {
  if (!Number.isInteger(period_min) || period_min < 1 || period_min > 240) {
    throw new Error(`tpoAdd: period_min must be 1..240, got ${period_min}`);
  }
  if (!['RTH', 'ETH'].includes(session)) {
    throw new Error(`tpoAdd: session must be 'RTH' or 'ETH', got "${session}"`);
  }
  if (typeof va_pct !== 'number' || va_pct < 0.1 || va_pct > 0.99) {
    throw new Error(`tpoAdd: va_pct must be 0.1..0.99, got ${va_pct}`);
  }

  const { setInputs } = _resolve(_deps);
  const studyId = await findHelperStudy({ _deps });
  if (!studyId) throw new Error(`${HELPER_NAME} not found. Run 'tv premium install-helper' first.`);
  await setInputs({
    entity_id: studyId,
    inputs: { mode: 'tpo', tpo_period: period_min, tpo_session: session, tpo_va_pct: va_pct },
  });
  return { success: true, study_id: studyId, period_min, session, va_pct };
}

// ── Task 4.2: tpoGet ─────────────────────────────────────────────────────────

export async function tpoGet({ _deps } = {}) {
  const parsed = await readHelperTable(MAGIC_TPO, { _deps });
  return {
    success: true,
    session: parsed.session,
    period_min: parsed.period_min,
    poc: parsed.poc,
    value_area: parsed.value_area,
    initial_balance: parsed.initial_balance,
    letter_rows: parsed.letter_rows,
    single_prints: parsed.single_prints,
  };
}

// ── Task 5.1: footprintToggle ────────────────────────────────────────────────

const FOOTPRINT_TYPE_NAME = 'VolumeFootprint';
let _previousChartType = null;

export async function footprintToggle({ enable = true, _deps } = {}) {
  const { setType, getChartState } = _resolve(_deps);
  if (enable) {
    const state = await getChartState();
    const prev = state?.chart_type || state?.chartType || state?.type || 'Candles';
    if (prev !== FOOTPRINT_TYPE_NAME) _previousChartType = prev;
    await setType({ type: FOOTPRINT_TYPE_NAME });
    return { success: true, current_type: FOOTPRINT_TYPE_NAME, previous_type: _previousChartType };
  } else {
    const target = _previousChartType || 'Candles';
    await setType({ type: target });
    return { success: true, current_type: target, previous_type: FOOTPRINT_TYPE_NAME };
  }
}

// ── Task 5.2: barMagnifierToggle ─────────────────────────────────────────────

export async function barMagnifierToggle({ enable = true, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const ok = await evaluate(`
    (function() {
      try {
        var api = ${apiPath};
        var ms = api._chartWidget.model().mainSeries();
        var props = ms.properties().childs();
        var keys = Object.keys(props);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (k.toLowerCase().indexOf('barmagnifier') !== -1 || k.toLowerCase().indexOf('bar_magnifier') !== -1) {
            try { props[k].setValue(${enable ? 'true' : 'false'}); return true; } catch(e) {}
          }
        }
        function walk(node, depth) {
          if (depth > 4 || !node || typeof node !== 'object') return false;
          try {
            var c = typeof node.childs === 'function' ? node.childs() : null;
            if (!c) return false;
            var ks = Object.keys(c);
            for (var j = 0; j < ks.length; j++) {
              if (ks[j].toLowerCase().indexOf('barmagnifier') !== -1) {
                try { c[ks[j]].setValue(${enable ? 'true' : 'false'}); return true; } catch(e) {}
              }
              if (walk(c[ks[j]], depth + 1)) return true;
            }
          } catch(e) {}
          return false;
        }
        return walk(ms.properties(), 0);
      } catch(e) { return false; }
    })()
  `);
  if (!ok) {
    throw new Error('Bar Magnifier property not found in chart settings (TradingView UI may have changed).');
  }
  return { success: true, enabled: !!enable };
}
