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
