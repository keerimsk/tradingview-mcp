/**
 * Strategy Tester deep control: list, settings, performance tabs, deep backtest.
 *
 * IMPORTANT: TV-internal property names are placeholders below — the controller
 * replaces them after probing a live strategy on chart (see plan Phase 0.0).
 */
import {
  evaluate as _evaluate,
  getChartApi as _getChartApi,
  safeString,
} from '../connection.js';

function _resolve(deps) {
  return {
    evaluate:    deps?.evaluate    || _evaluate,
    getChartApi: deps?.getChartApi || _getChartApi,
  };
}

/**
 * Returns all strategies currently on the chart as `{entity_id, name}`.
 */
export async function findStrategies({ _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const apiPath = await getChartApi();
  const all = await evaluate(`
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
          var isStrat = meta.is_strategy === true || (s['report'+'Data'] != null && meta.is_price_study === false);
          out.push({
            id: s.id ? s.id() : null,
            name: meta.description || meta.shortDescription || '',
            is_strategy: !!isStrat,
          });
        } catch(e) {}
      }
      return out;
    })()
  `);
  return (all || [])
    .filter(s => s.is_strategy)
    .map(s => ({ entity_id: s.id, name: s.name }));
}

/**
 * Find a strategy by entity_id, or return the first strategy if id omitted.
 * Returns null if no match.
 */
export async function findStrategyById(entity_id, { _deps } = {}) {
  const list = await findStrategies({ _deps });
  if (list.length === 0) return null;
  if (!entity_id) return list[0];
  return list.find(s => s.entity_id === entity_id) || null;
}

// Canonical name → TV-internal property path. CONTROLLER: update these from
// Phase 0.1 probe results. `null` means the canonical setting could not be
// located in this TV version — getSettings/setSettings will skip it gracefully.
export const CANONICAL_TO_TV_PATH = {
  initial_capital:   'initial_capital',     // PROBE-PENDING
  default_qty_type:  'default_qty_type',    // PROBE-PENDING
  default_qty_value: 'default_qty_value',   // PROBE-PENDING
  commission_type:   'commission_type',     // PROBE-PENDING
  commission_value:  'commission_value',    // PROBE-PENDING
  slippage:          'slippage',            // PROBE-PENDING
  pyramiding:        'pyramiding',          // PROBE-PENDING
  margin_long:       'margin_long',         // PROBE-PENDING
  margin_short:      'margin_short',        // PROBE-PENDING
};

/**
 * Walk a TV property-tree node, return canonical settings + raw key list.
 * Each TV property has .value() / .setValue() / .childs(). Some TV "value" calls
 * throw on uninitialized properties — those are silently skipped.
 */
export function parseSettingsTree(node) {
  const settings = {};
  const raw_property_keys = [];
  const childs = (typeof node?.childs === 'function') ? node.childs() : null;
  if (!childs) return { settings, raw_property_keys };

  for (const key of Object.keys(childs)) {
    raw_property_keys.push(key);
    const child = childs[key];
    if (!child || typeof child.value !== 'function') continue;
    let value;
    try { value = child.value(); } catch { continue; }
    for (const [canonical, tvPath] of Object.entries(CANONICAL_TO_TV_PATH)) {
      if (tvPath === key) {
        settings[canonical] = value;
        break;
      }
    }
  }
  return { settings, raw_property_keys };
}

export async function getSettings({ entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };

  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      var api = ${apiPath};
      var widget = api._chartWidget;
      var sources = widget.model().model().dataSources();
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (s.id && s.id() === ${safeString(strat.entity_id)}) {
          if (!s.properties) return { settings: {}, raw_property_keys: [] };
          var node = s.properties();
          var childs = (typeof node.childs === 'function') ? node.childs() : null;
          if (!childs) return { settings: {}, raw_property_keys: [] };
          var settings = {};
          var raw = [];
          var canonical = ${JSON.stringify(CANONICAL_TO_TV_PATH)};
          var canonByPath = {};
          for (var c in canonical) { if (canonical[c]) canonByPath[canonical[c]] = c; }
          var keys = Object.keys(childs);
          for (var k = 0; k < keys.length; k++) {
            var rk = keys[k];
            raw.push(rk);
            var child = childs[rk];
            if (!child || typeof child.value !== 'function') continue;
            var v;
            try { v = child.value(); } catch(e) { continue; }
            if (canonByPath[rk]) settings[canonByPath[rk]] = v;
          }
          return { settings: settings, raw_property_keys: raw };
        }
      }
      return null;
    })()
  `);

  if (!result) return { success: false, error: `Strategy ${strat.entity_id} not found in current dataSources.` };
  return {
    success: true,
    entity_id: strat.entity_id,
    name: strat.name,
    settings: result.settings,
    raw_property_keys: result.raw_property_keys,
  };
}

// ---------------------------------------------------------------------------
// REPORT_FIELD_MAP — canonical name → TV reportData field name
// CONTROLLER: replace right-hand TV field names from Phase 0.1 probe.
// ---------------------------------------------------------------------------
export const REPORT_FIELD_MAP = {
  net_profit:           'netProfit',           // PROBE-PENDING
  net_profit_pct:       'netProfitPercent',    // PROBE-PENDING
  gross_profit:         'grossProfit',         // PROBE-PENDING
  gross_loss:           'grossLoss',           // PROBE-PENDING
  total_trades:         'totalTrades',         // PROBE-PENDING
  winning_trades:       'winningTrades',       // PROBE-PENDING
  losing_trades:        'losingTrades',        // PROBE-PENDING
  max_drawdown:         'maxDrawdown',         // PROBE-PENDING
  max_drawdown_pct:     'maxDrawdownPercent',  // PROBE-PENDING
  buy_hold_return:      'buyHoldReturn',       // PROBE-PENDING
  buy_hold_return_pct:  'buyHoldReturnPercent',// PROBE-PENDING
};

function _coerceFromMap(source, map) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const [canon, tvField] of Object.entries(map)) {
    if (source[tvField] !== undefined && source[tvField] !== null) {
      out[canon] = source[tvField];
    }
  }
  return out;
}

export function extractPerformanceSummary(reportData) {
  const out = _coerceFromMap(reportData, REPORT_FIELD_MAP);
  if (typeof out.winning_trades === 'number' && typeof out.total_trades === 'number' && out.total_trades > 0) {
    const pct = (out.winning_trades / out.total_trades) * 100;
    out.percent_profitable = pct.toFixed(2) + '%';
  }
  return out;
}

async function _readReportData(strat, evaluate, getChartApi) {
  const apiPath = await getChartApi();
  return await evaluate(`
    (function() {
      var api = ${apiPath};
      var sources = api._chartWidget.model().model().dataSources();
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (s.id && s.id() === ${safeString(strat.entity_id)}) {
          var rd = s.reportData;
          if (typeof rd === 'function') rd = rd();
          if (rd && typeof rd.value === 'function') rd = rd.value();
          var perf = s.performance ? s.performance() : null;
          if (perf && typeof perf.value === 'function') perf = perf.value();
          return { raw: rd || {}, performance: perf || null };
        }
      }
      return null;
    })()
  `);
}

export async function getPerformanceSummary({ entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };

  const data = await _readReportData(strat, evaluate, getChartApi);
  if (!data) return { success: false, error: 'Strategy ' + strat.entity_id + ' not found.' };

  const metrics = extractPerformanceSummary(data.raw);
  return { success: true, entity_id: strat.entity_id, metrics };
}

export async function setSettings({ entity_id, settings, _deps } = {}) {
  if (!settings || typeof settings !== 'object' || Object.keys(settings).length === 0) {
    throw new Error('setSettings: provide at least one setting to update');
  }
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };

  const apiPath = await getChartApi();
  const writes = [];
  const skipped = [];
  for (const [canonical, value] of Object.entries(settings)) {
    const tvPath = CANONICAL_TO_TV_PATH[canonical];
    if (!tvPath) skipped.push(canonical);
    else writes.push({ canonical, tvPath, value });
  }

  if (writes.length === 0) {
    return { success: true, entity_id: strat.entity_id, applied: {}, skipped };
  }

  const result = await evaluate(`
    (function() {
      var api = ${apiPath};
      var widget = api._chartWidget;
      var sources = widget.model().model().dataSources();
      var writes = ${JSON.stringify(writes)};
      var applied = {};
      var skipped_runtime = [];
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (s.id && s.id() === ${safeString(strat.entity_id)}) {
          if (!s.properties) return { applied: {}, skipped: writes.map(function(w){return w.canonical;}) };
          var node = s.properties();
          var childs = (typeof node.childs === 'function') ? node.childs() : null;
          if (!childs) return { applied: {}, skipped: writes.map(function(w){return w.canonical;}) };
          for (var w = 0; w < writes.length; w++) {
            var write = writes[w];
            var child = childs[write.tvPath];
            if (!child || typeof child.setValue !== 'function') {
              skipped_runtime.push(write.canonical);
              continue;
            }
            try {
              child.setValue(write.value);
              applied[write.canonical] = write.value;
            } catch(e) {
              skipped_runtime.push(write.canonical);
            }
          }
          return { applied: applied, skipped: skipped_runtime };
        }
      }
      return null;
    })()
  `);

  if (!result) return { success: false, error: `Strategy ${strat.entity_id} not found.` };
  const allSkipped = [...skipped, ...(result.skipped || [])];
  return {
    success: true,
    entity_id: strat.entity_id,
    applied: result.applied || {},
    skipped: allSkipped,
  };
}
