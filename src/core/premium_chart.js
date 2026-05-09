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

  // TradingView Pine table cells expose: v.tid (table id), v.row, v.col, v.t (text).
  // Older field-name fallbacks kept defensively for forward compat.
  const rowsMap = new Map();
  for (const cell of tableData) {
    const v = cell.raw || {};
    const r = v.row ?? v.rowIndex ?? v.points?.[0]?.row;
    const c = v.col ?? v.column ?? v.colIndex ?? v.points?.[0]?.column;
    const text = v.t ?? v.text ?? v.cellText ?? v.value ?? '';
    if (r === undefined || c === undefined) continue;
    if (!rowsMap.has(r)) rowsMap.set(r, []);
    rowsMap.get(r)[c] = String(text);
  }

  const sorted = [...rowsMap.entries()].sort((a, b) => a[0] - b[0]).map(([, cols]) => cols);
  return parseMcpTable(sorted, expectedMagic);
}

/**
 * Verify the TV-MCP Helper indicator is on the active chart. If absent, return
 * structured manual-install instructions instead of attempting an automated
 * paste — TradingView's Pine save dialog cannot be reliably driven via CDP
 * (Ctrl+S overwrites whatever script slot is open, breaking user scripts;
 * Save As dialog UI is brittle and version-dependent).
 *
 * One-time manual install:
 *   1. Open Pine Editor in TradingView
 *   2. New (script picker → New → Indicator)
 *   3. Paste contents of `pine/mcp-helper.pine`
 *   4. Save with name "TV-MCP Helper" (Save As dialog)
 *   5. Add to chart
 */
export async function installHelper({ _deps } = {}) {
  const existing = await findHelperStudy({ _deps });
  if (existing) {
    return { success: true, action: 'already_installed', study_id: existing };
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const pinePath = join(here, '..', '..', 'pine', 'mcp-helper.pine');
  // Read just to confirm the file exists; surface a clear error if the user
  // removed it accidentally.
  await readFile(pinePath, 'utf-8');

  return {
    success: false,
    action: 'manual_install_required',
    helper_name: HELPER_NAME,
    pine_source_path: pinePath,
    instructions: [
      'Automated install was removed because Ctrl+S in Pine editor silently overwrites whatever script is currently open, risking user scripts.',
      '1) Open Pine editor (chart toolbar → Pine icon).',
      '2) Script picker (top-left of editor) → "New" → "Indicator".',
      `3) Paste the full contents of ${pinePath} into the editor.`,
      `4) Press Ctrl+S, set the name to exactly "${HELPER_NAME}" and save.`,
      '5) Click "Add to chart" (or "Save and add to chart").',
      '6) Re-run any vp_/tpo_ tool to verify.',
    ],
  };
}

const VP_VARIANTS = ['visible_range', 'fixed_range', 'session'];

// TradingView re-IDs Pine inputs as in_0, in_1, ... in declaration order.
// Helper Pine declaration order: mode, vp_variant, vp_rows, vp_va_pct, vp_lookback,
// tpo_period, tpo_session, tpo_va_pct.
const HELPER_INPUT_IDS = {
  mode:        'in_0',
  vp_variant:  'in_1',
  vp_rows:     'in_2',
  vp_va_pct:   'in_3',
  vp_lookback: 'in_4',
  tpo_period:  'in_5',
  tpo_session: 'in_6',
  tpo_va_pct:  'in_7',
};

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
    inputs: {
      [HELPER_INPUT_IDS.mode]:       'vp',
      [HELPER_INPUT_IDS.vp_variant]: variant,
      [HELPER_INPUT_IDS.vp_rows]:    rows,
      [HELPER_INPUT_IDS.vp_va_pct]:  va_pct,
    },
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

// TradingView built-in pattern studies. scriptIdPart is what chart.createStudy
// actually accepts (verified live: createStudy("All Candlestick Patterns") fails
// with new_study_count=0; createStudy("STD;Candlestick%1Pattern%1...") works).
// displayName is what TV puts in metaInfo().description after the study is on
// chart — used by patternsList to filter dataSources. Note the asterisks in
// the candlestick name are part of TV's own labeling.
//
// Harmonic Patterns: scriptIdPart unverified (not exposed in user's plan when
// probed, or naming differs). Listed for completeness; will fail at runtime
// until verified.
export const PATTERN_STUDIES = {
  candlestick: {
    scriptIdPart: 'STD;Candlestick%1Pattern%1All%1Candlestick%1Patterns',
    displayName:  '*All Candlestick Patterns*',
  },
  harmonic: {
    scriptIdPart: 'STD;Harmonic%1Patterns',
    displayName:  'Harmonic Patterns',
  },
  auto_fib: {
    scriptIdPart: 'STD;Auto%1Fib%1Retracement%1',
    displayName:  'Auto Fib Retracement',
  },
};

// Backwards-compat alias for tests / external consumers that imported this.
export const PATTERN_STUDY_NAMES = Object.fromEntries(
  Object.entries(PATTERN_STUDIES).map(([k, v]) => [k, v.displayName])
);

export async function patternsAdd({ kinds = [], _deps } = {}) {
  if (!Array.isArray(kinds) || kinds.length === 0) {
    throw new Error('patternsAdd: provide at least one kind');
  }
  for (const k of kinds) {
    if (!(k in PATTERN_STUDIES)) {
      throw new Error(`patternsAdd: unknown kind "${k}". Allowed: ${Object.keys(PATTERN_STUDIES).join(', ')}`);
    }
  }
  const { manageIndicator } = _resolve(_deps);
  const added = [];
  for (const kind of kinds) {
    const { scriptIdPart, displayName } = PATTERN_STUDIES[kind];
    const r = await manageIndicator({ action: 'add', indicator: scriptIdPart });
    added.push({ kind, name: displayName, study_id: r?.entity_id || r?.id || null });
  }
  return { success: true, added };
}

const DISPLAY_NAME_TO_KIND = Object.fromEntries(
  Object.entries(PATTERN_STUDIES).map(([k, v]) => [v.displayName, k])
);

export async function patternsList({ kinds, max_per_kind = 25, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();

  const allowedNames = (kinds && kinds.length > 0)
    ? kinds.map(k => PATTERN_STUDIES[k]?.displayName).filter(Boolean)
    : Object.values(PATTERN_STUDIES).map(v => v.displayName);

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
    const kind = DISPLAY_NAME_TO_KIND[st.name];
    const cap = Math.max(1, Math.min(200, max_per_kind));
    const items = (st.items || []).slice(0, cap);
    for (const item of items) {
      const v = item.raw || {};
      // TV label primitive fields: t=short text (may have \n + zigzag spacers), tt=tooltip, y=price, x=bar index.
      const cleanLine = (s) => String(s || '').split('\n')[0].replace(/[‎‏]/g, '').trim();
      const shortRaw = v.t ?? v.text ?? v.label ?? '';
      const tooltip  = v.tt ?? '';
      const price    = Number(v.y ?? v.price);
      const barIndex = Number(v.x);
      // Tooltip first line is canonical name (e.g., "Engulfing\n<long description>").
      // Auto Fib has no tooltip; t holds "0(93.65)\n<padding>" — strip newline + bidirectional marks.
      const shortText = cleanLine(shortRaw);
      const fullName  = tooltip ? cleanLine(tooltip) : shortText;
      patterns.push({
        kind,
        name: fullName || shortText,
        short: shortText || null,
        price: Number.isFinite(price) ? price : null,
        bar_index: Number.isFinite(barIndex) ? barIndex : null,
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
    inputs: {
      [HELPER_INPUT_IDS.mode]:        'tpo',
      [HELPER_INPUT_IDS.tpo_period]:  period_min,
      [HELPER_INPUT_IDS.tpo_session]: session,
      [HELPER_INPUT_IDS.tpo_va_pct]:  va_pct,
    },
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

// NOTE: VolumeFootprint enum value is unverified — requires tv_discover on user's
// instance to confirm. chart.setType also has a numeric typeMap that may not
// include this value, in which case the call will fail until the typeMap is
// extended. This is tracked as Open Question #3 in the Epic 1 spec.
const FOOTPRINT_TYPE_NAME = 'VolumeFootprint';
let _previousChartType = null;

export async function footprintToggle({ enable = true, _deps } = {}) {
  const { setType, getChartState } = _resolve(_deps);
  if (enable) {
    const state = await getChartState();
    const prev = state?.chart_type || state?.chartType || state?.type || 'Candles';
    if (prev !== FOOTPRINT_TYPE_NAME) _previousChartType = prev;
    await setType({ chart_type: FOOTPRINT_TYPE_NAME });
    return { success: true, current_type: FOOTPRINT_TYPE_NAME, previous_type: _previousChartType };
  } else {
    const target = _previousChartType || 'Candles';
    await setType({ chart_type: target });
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
