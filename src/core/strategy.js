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
          var isStrat = meta.is_strategy === true || (s.reportData != null && meta.is_price_study === false);
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
