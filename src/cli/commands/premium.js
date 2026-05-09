import { register } from '../router.js';
import * as core from '../../core/premium_chart.js';

register('premium', {
  description: 'Premium chart types: Volume Profile, TPO, patterns, footprint, bar magnifier',
  subcommands: new Map([
    ['install-helper', {
      description: 'Install TV-MCP Helper Pine indicator (one-time bootstrap)',
      handler: () => core.installHelper(),
    }],

    ['vp-add', {
      description: 'Configure Volume Profile (variant, rows, va_pct)',
      options: {
        variant: { type: 'string', description: 'visible_range | fixed_range | session' },
        rows:    { type: 'string', description: 'Number of rows (4-200, default 24)' },
        va_pct:  { type: 'string', description: 'Value area % (0.1-0.99, default 0.7)' },
      },
      handler: (opts) => core.vpAdd({
        variant: opts.variant || 'visible_range',
        rows:    opts.rows ? Number(opts.rows) : 24,
        va_pct:  opts.va_pct ? Number(opts.va_pct) : 0.7,
      }),
    }],
    ['vp-get', {
      description: 'Read Volume Profile data (POC, VAH, VAL, bins)',
      options: {
        bins_limit: { type: 'string', description: 'Cap on bins returned (default 100)' },
      },
      handler: (opts) => core.vpGet({ bins_limit: opts.bins_limit ? Number(opts.bins_limit) : 100 }),
    }],
    ['vp-remove', {
      description: 'Remove Volume Profile helper from chart',
      handler: () => core.vpRemove(),
    }],

    ['patterns-add', {
      description: 'Add pattern studies (kinds=candlestick,harmonic,auto_fib)',
      options: {
        kinds: { type: 'string', description: 'Comma-separated: candlestick,harmonic,auto_fib' },
      },
      handler: (opts) => {
        const kinds = (opts.kinds || 'candlestick').split(',').map(s => s.trim()).filter(Boolean);
        return core.patternsAdd({ kinds });
      },
    }],
    ['patterns-list', {
      description: 'List detected patterns',
      options: {
        kinds:        { type: 'string', description: 'Comma-separated filter' },
        max_per_kind: { type: 'string', description: 'Max patterns per study (default 25)' },
      },
      handler: (opts) => core.patternsList({
        kinds: opts.kinds ? opts.kinds.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        max_per_kind: opts.max_per_kind ? Number(opts.max_per_kind) : 25,
      }),
    }],

    ['tpo-add', {
      description: 'Configure TPO mode (period_min, session, va_pct)',
      options: {
        period_min: { type: 'string', description: 'Bracket period in minutes (default 30)' },
        session:    { type: 'string', description: 'RTH | ETH (default RTH)' },
        va_pct:     { type: 'string', description: 'Value area % (default 0.7)' },
      },
      handler: (opts) => core.tpoAdd({
        period_min: opts.period_min ? Number(opts.period_min) : 30,
        session:    opts.session || 'RTH',
        va_pct:     opts.va_pct ? Number(opts.va_pct) : 0.7,
      }),
    }],
    ['tpo-get', {
      description: 'Read TPO data (letters, VA, IB, single prints)',
      handler: () => core.tpoGet(),
    }],

    ['footprint', {
      description: 'Toggle Volume Footprint chart type (--enable=true/false)',
      options: {
        enable: { type: 'string', description: 'true (switch to Footprint) | false (revert)' },
      },
      handler: (opts) => core.footprintToggle({ enable: opts.enable !== 'false' }),
    }],

    ['magnifier', {
      description: 'Toggle Bar Magnifier (--enable=true/false)',
      options: {
        enable: { type: 'string', description: 'true | false' },
      },
      handler: (opts) => core.barMagnifierToggle({ enable: opts.enable !== 'false' }),
    }],
  ]),
});
