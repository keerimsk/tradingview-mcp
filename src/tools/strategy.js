import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/strategy.js';

const SettingsSchema = z.object({
  initial_capital:   z.number().min(0).optional(),
  default_qty_type:  z.enum(['fixed', 'percent_of_equity', 'cash']).optional(),
  default_qty_value: z.number().min(0).optional(),
  commission_type:   z.enum(['percent', 'cash_per_order', 'cash_per_contract']).optional(),
  commission_value:  z.number().min(0).optional(),
  slippage:          z.coerce.number().int().min(0).optional(),
  pyramiding:        z.coerce.number().int().min(0).optional(),
  margin_long:       z.number().min(0).max(100).optional(),
  margin_short:      z.number().min(0).max(100).optional(),
}).strict();

export function registerStrategyTools(server) {
  server.tool('strategy_list',
    'List all strategies currently on the chart. Returns [{entity_id, name}, ...].',
    {},
    async () => {
      try {
        const list = await core.findStrategies();
        return jsonResult({ success: true, count: list.length, strategies: list });
      } catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_get_settings',
    'Read all canonical settings (initial_capital, commission, pyramiding, etc.) for a strategy.',
    { entity_id: z.string().optional() },
    async ({ entity_id }) => {
      try { return jsonResult(await core.getSettings({ entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_set_settings',
    'Update strategy settings (partial). Settings keys: initial_capital, commission_type/value, slippage, pyramiding, margin_long/short, default_qty_type/value.',
    {
      entity_id: z.string().optional(),
      settings:  SettingsSchema,
    },
    async ({ entity_id, settings }) => {
      try { return jsonResult(await core.setSettings({ entity_id, settings })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_deep_backtest_toggle',
    'Toggle Deep Backtest mode (Premium/Ultimate feature) on the active strategy.',
    {
      enable:    z.coerce.boolean().default(true),
      entity_id: z.string().optional(),
    },
    async ({ enable, entity_id }) => {
      try { return jsonResult(await core.deepBacktestToggle({ enable, entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_get_performance_summary',
    'Read Performance Summary tab metrics (net profit, drawdown, total trades, percent profitable).',
    { entity_id: z.string().optional() },
    async ({ entity_id }) => {
      try { return jsonResult(await core.getPerformanceSummary({ entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_get_trades_analysis',
    'Read Trades Analysis tab metrics (avg win/loss, max consecutive wins/losses, avg bars in trade).',
    { entity_id: z.string().optional() },
    async ({ entity_id }) => {
      try { return jsonResult(await core.getTradesAnalysis({ entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_get_risk_ratios',
    'Read Risk-Performance Ratios tab (Sharpe, Sortino, Profit Factor, Calmar, Recovery Factor).',
    { entity_id: z.string().optional() },
    async ({ entity_id }) => {
      try { return jsonResult(await core.getRiskRatios({ entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('strategy_set_active',
    'Choose which strategy the Strategy Tester displays (when multiple are on chart).',
    { entity_id: z.string() },
    async ({ entity_id }) => {
      try { return jsonResult(await core.setActive({ entity_id })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });
}
