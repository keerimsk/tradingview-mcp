import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/premium_chart.js';

export function registerPremiumChartTools(server) {
  server.tool('premium_install_helper',
    'One-time bootstrap: paste pine/mcp-helper.pine into editor, compile, save, add to chart.',
    {},
    async () => {
      try { return jsonResult(await core.installHelper()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('vp_add',
    'Configure helper for Volume Profile mode (variant: visible_range / fixed_range / session).',
    {
      variant: z.enum(['visible_range', 'fixed_range', 'session']).default('visible_range'),
      rows:    z.coerce.number().int().min(4).max(200).default(24),
      va_pct:  z.coerce.number().min(0.1).max(0.99).default(0.7),
    },
    async ({ variant, rows, va_pct }) => {
      try { return jsonResult(await core.vpAdd({ variant, rows, va_pct })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('vp_get',
    'Read Volume Profile structured data (POC, VAH, VAL, bins) from helper indicator.',
    {
      bins_limit: z.coerce.number().int().min(1).max(500).default(100),
    },
    async ({ bins_limit }) => {
      try { return jsonResult(await core.vpGet({ bins_limit })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('vp_remove',
    'Remove the helper Volume Profile indicator from chart.',
    {},
    async () => {
      try { return jsonResult(await core.vpRemove()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('patterns_add',
    'Add built-in pattern detection studies (candlestick / harmonic / auto_fib).',
    {
      kinds: z.array(z.enum(['candlestick', 'harmonic', 'auto_fib'])).min(1),
    },
    async ({ kinds }) => {
      try { return jsonResult(await core.patternsAdd({ kinds })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('patterns_list',
    'List patterns detected by built-in studies (name, price, bar_time).',
    {
      kinds:        z.array(z.enum(['candlestick', 'harmonic', 'auto_fib'])).optional(),
      max_per_kind: z.coerce.number().int().min(1).max(200).default(25),
    },
    async ({ kinds, max_per_kind }) => {
      try { return jsonResult(await core.patternsList({ kinds, max_per_kind })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('tpo_add',
    'Configure helper for TPO mode (period_min, session: RTH/ETH).',
    {
      period_min: z.coerce.number().int().min(1).max(240).default(30),
      session:    z.enum(['RTH', 'ETH']).default('RTH'),
      va_pct:     z.coerce.number().min(0.1).max(0.99).default(0.7),
    },
    async ({ period_min, session, va_pct }) => {
      try { return jsonResult(await core.tpoAdd({ period_min, session, va_pct })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('tpo_get',
    'Read TPO structured data (letter rows, value area, IB, single prints).',
    {},
    async () => {
      try { return jsonResult(await core.tpoGet()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('footprint_toggle',
    'Toggle chart type to/from Volume Footprint. enable=false reverts to previous type.',
    {
      enable: z.coerce.boolean().default(true),
    },
    async ({ enable }) => {
      try { return jsonResult(await core.footprintToggle({ enable })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });

  server.tool('bar_magnifier_toggle',
    'Toggle Bar Magnifier setting (Premium/Ultimate feature).',
    {
      enable: z.coerce.boolean().default(true),
    },
    async ({ enable }) => {
      try { return jsonResult(await core.barMagnifierToggle({ enable })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    });
}
