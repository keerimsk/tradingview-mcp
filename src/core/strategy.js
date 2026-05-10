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
          // TV uses isTVScriptStrategy for Pine strategy studies. Strategies may be overlays
          // (is_price_study true), so don't gate on that. Fallback: presence of report data getter.
          var isStrat = meta.isTVScriptStrategy === true || meta.is_strategy === true || s['report'+'Data'] != null;
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
// REPORT_FIELD_MAP — canonical name → TV reportData field name.
// Verified live 2026-05-10 against TradingView Desktop Ultimate.
// Source object is a flatten of reportData.performance + reportData.performance.all.
// ---------------------------------------------------------------------------
export const REPORT_FIELD_MAP = {
  net_profit:           'netProfit',
  net_profit_pct:       'netProfitPercent',
  gross_profit:         'grossProfit',
  gross_loss:           'grossLoss',
  total_trades:         'totalTrades',
  winning_trades:       'numberOfWiningTrades',     // TV typo: "Wining"
  losing_trades:        'numberOfLosingTrades',
  max_drawdown:         'maxStrategyDrawDown',
  max_drawdown_pct:     'maxStrategyDrawDownPercent',
  buy_hold_return:      'buyHoldReturn',
  buy_hold_return_pct:  'buyHoldReturnPercent',
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
  // TV's percentProfitable is a ratio (0..1), not a percent. Multiply by 100 when formatting.
  if (typeof reportData?.percentProfitable === 'number') {
    const v = reportData.percentProfitable;
    const pct = v >= 0 && v <= 1 ? v * 100 : v;
    out.percent_profitable = pct.toFixed(2) + '%';
  } else if (typeof out.winning_trades === 'number' && typeof out.total_trades === 'number' && out.total_trades > 0) {
    const pct = (out.winning_trades / out.total_trades) * 100;
    out.percent_profitable = pct.toFixed(2) + '%';
  }
  if (typeof reportData?.profitFactor === 'number') {
    out.profit_factor = reportData.profitFactor;
  }
  return out;
}

async function _readReportData(strat, evaluate, getChartApi) {
  const apiPath = await getChartApi();
  // CRITICAL: must call s.reportData() with `this` bound to s. Assigning
  // `var rd = s.reportData; rd()` strips the binding and TV throws on internal
  // _reportData access. Use `s.reportData()` directly.
  // TV nests metrics: rd.performance.{sharpeRatio, sortinoRatio, maxStrategyDrawDown, ...}
  // and rd.performance.all.{netProfit, totalTrades, percentProfitable, profitFactor, ...}.
  // We flatten perf + perf.all into one source object so the FIELD_MAPs can use flat keys.
  return await evaluate(`
    (function() {
      var api = ${apiPath};
      var sources = api._chartWidget.model().model().dataSources();
      for (var i = 0; i < sources.length; i++) {
        var s = sources[i];
        if (s.id && s.id() === ${safeString(strat.entity_id)}) {
          var rd = null;
          try { rd = s.reportData(); } catch(e) { rd = null; }
          if (rd && typeof rd.value === 'function') {
            try { rd = rd.value(); } catch(e) {}
          }
          var perf = (rd && rd.performance) || {};
          var all = (perf && perf.all) || {};
          // Flatten: perf.all wins on key clash with perf (more specific wins)
          var flat = {};
          for (var k in perf) { if (typeof perf[k] !== 'object' || perf[k] === null) flat[k] = perf[k]; }
          for (var k2 in all) flat[k2] = all[k2];
          // Pass settings (e.g., dateRange) through too
          var settings = (rd && rd.settings) || {};
          return { raw: flat, settings: settings, currency: rd && rd.currency };
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

// ---------------------------------------------------------------------------
// TRADES_FIELD_MAP — canonical name → TV reportData field name.
// Verified live 2026-05-10. TV uses shortened "WinTrade"/"LosTrade" names.
// max_consecutive_wins/losses not present in TV's perf.all object — omitted.
// ---------------------------------------------------------------------------
export const TRADES_FIELD_MAP = {
  avg_trade:                 'avgTrade',
  avg_trade_pct:             'avgTradePercent',
  avg_winning_trade:         'avgWinTrade',
  avg_winning_trade_pct:     'avgWinTradePercent',
  avg_losing_trade:          'avgLosTrade',
  avg_losing_trade_pct:      'avgLosTradePercent',
  ratio_avg_win_loss:        'ratioAvgWinAvgLoss',
  largest_winning_trade:     'largestWinTrade',
  largest_winning_trade_pct: 'largestWinTradePercent',
  largest_losing_trade:      'largestLosTrade',
  largest_losing_trade_pct:  'largestLosTradePercent',
  avg_bars_in_winning_trade: 'avgBarsInWinTrade',
  avg_bars_in_losing_trade:  'avgBarsInLossTrade',     // TV typo: "Loss" with double s
  avg_bars_in_trade:         'avgBarsInTrade',
};

export function extractTradesAnalysis(reportData) {
  return _coerceFromMap(reportData, TRADES_FIELD_MAP);
}

export async function getTradesAnalysis({ entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };
  const data = await _readReportData(strat, evaluate, getChartApi);
  if (!data) return { success: false, error: 'Strategy ' + strat.entity_id + ' not found.' };
  const metrics = extractTradesAnalysis(data.raw);
  return { success: true, entity_id: strat.entity_id, metrics };
}

// ---------------------------------------------------------------------------
// RISK_FIELD_MAP — canonical name → TV reportData field name.
// Verified live 2026-05-10. calmar_ratio + recovery_factor not exposed by TV
// in its perf object (would need to be computed). Omitted for now.
// ---------------------------------------------------------------------------
export const RISK_FIELD_MAP = {
  sharpe_ratio:     'sharpeRatio',
  sortino_ratio:    'sortinoRatio',
  profit_factor:    'profitFactor',
  max_drawdown:     'maxStrategyDrawDown',
  max_drawdown_pct: 'maxStrategyDrawDownPercent',
  max_runup:        'maxStrategyRunUp',
  max_runup_pct:    'maxStrategyRunUpPercent',
};

export function extractRiskRatios(reportData) {
  return _coerceFromMap(reportData, RISK_FIELD_MAP);
}

export async function getRiskRatios({ entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };
  const data = await _readReportData(strat, evaluate, getChartApi);
  if (!data) return { success: false, error: 'Strategy ' + strat.entity_id + ' not found.' };
  const metrics = extractRiskRatios(data.raw);
  return { success: true, entity_id: strat.entity_id, metrics };
}

/**
 * Walks the active strategy's property tree (depth ≤ 5) for any property
 * whose key contains "deepbacktest" / "deep_backtest" / "useDeepBacktest" and
 * calls setValue(enable). Same defensive pattern as Epic #1's barMagnifierToggle.
 */
export async function deepBacktestToggle({ enable = true, entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };

  const apiPath = await getChartApi();
  const ok = await evaluate(`
    (function() {
      try {
        var api = ${apiPath};
        var sources = api._chartWidget.model().model().dataSources();
        var target = null;
        for (var i = 0; i < sources.length; i++) {
          if (sources[i].id && sources[i].id() === ${safeString(strat.entity_id)}) {
            target = sources[i];
            break;
          }
        }
        if (!target || !target.properties) return false;
        function walk(node, depth) {
          if (depth > 5 || !node) return false;
          try {
            var c = (typeof node.childs === 'function') ? node.childs() : null;
            if (!c) return false;
            var ks = Object.keys(c);
            for (var j = 0; j < ks.length; j++) {
              var k = ks[j];
              var lk = k.toLowerCase();
              if (lk.indexOf('deepbacktest') !== -1 || lk.indexOf('deep_backtest') !== -1 || lk.indexOf('usedeepbacktest') !== -1) {
                try { c[k].setValue(${enable ? 'true' : 'false'}); return true; } catch(e) {}
              }
              if (walk(c[k], depth + 1)) return true;
            }
          } catch(e) {}
          return false;
        }
        return walk(target.properties(), 0);
      } catch(e) { return false; }
    })()
  `);
  if (!ok) {
    return { success: false, error: 'Deep Backtest property not found in this TV version. Toggle manually if needed.' };
  }
  return { success: true, enabled: !!enable, entity_id: strat.entity_id };
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

/**
 * Set which strategy the Strategy Tester displays (when chart has multiple).
 * TradingView's API for this is uncertain — we try a few candidates and report
 * `not supported` if none work.
 */
export async function setActive({ entity_id, _deps } = {}) {
  const { evaluate, getChartApi } = _resolve(_deps);
  const strat = await findStrategyById(entity_id, { _deps });
  if (!strat) return { success: false, error: 'No strategy on chart. Add a Pine strategy first.' };
  if (entity_id && strat.entity_id !== entity_id) {
    return { success: false, error: 'Strategy ' + entity_id + ' not found on chart.' };
  }

  const apiPath = await getChartApi();
  const result = await evaluate(`
    (function() {
      try {
        var api = ${apiPath};
        var widget = api._chartWidget;
        var id = ${safeString(strat.entity_id)};
        if (typeof api.setActiveStudy === 'function') { api.setActiveStudy(id); return 'ok'; }
        if (widget && typeof widget.setActiveStudy === 'function') { widget.setActiveStudy(id); return 'ok'; }
        var model = widget && widget.model();
        if (model && typeof model.setActiveStudy === 'function') { model.setActiveStudy(id); return 'ok'; }
        return 'no_api';
      } catch(e) { return 'no_api'; }
    })()
  `);

  if (result === 'ok') {
    return { success: true, active_entity_id: strat.entity_id };
  }
  return {
    success: false,
    error: 'Active-strategy selection not supported in this TV version. Tester shows the most recent strategy automatically.',
  };
}
