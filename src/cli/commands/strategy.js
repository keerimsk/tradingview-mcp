import { register } from '../router.js';
import * as core from '../../core/strategy.js';

register('strategy', {
  description: 'Strategy Tester: list, settings, performance tabs, deep backtest',
  subcommands: new Map([
    ['list', {
      description: 'List strategies on chart',
      handler: async () => {
        const list = await core.findStrategies();
        return { success: true, count: list.length, strategies: list };
      },
    }],
    ['get-settings', {
      description: 'Read strategy settings',
      options: { entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id (default: first)' } },
      handler: (opts) => core.getSettings({ entity_id: opts.entity_id }),
    }],
    ['set-settings', {
      description: 'Update strategy settings (JSON via --settings)',
      options: {
        entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id' },
        settings:  { type: 'string', short: 's', description: 'JSON object of settings to apply' },
      },
      handler: (opts) => {
        if (!opts.settings) throw new Error('--settings <JSON> is required');
        return core.setSettings({ entity_id: opts.entity_id, settings: JSON.parse(opts.settings) });
      },
    }],
    ['deep-backtest', {
      description: 'Toggle Deep Backtest (--enable=true|false)',
      options: {
        enable:    { type: 'string', description: 'true | false' },
        entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id' },
      },
      handler: (opts) => core.deepBacktestToggle({
        enable: opts.enable !== 'false',
        entity_id: opts.entity_id,
      }),
    }],
    ['performance', {
      description: 'Read Performance Summary tab',
      options: { entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id' } },
      handler: (opts) => core.getPerformanceSummary({ entity_id: opts.entity_id }),
    }],
    ['trades-analysis', {
      description: 'Read Trades Analysis tab',
      options: { entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id' } },
      handler: (opts) => core.getTradesAnalysis({ entity_id: opts.entity_id }),
    }],
    ['risk-ratios', {
      description: 'Read Risk-Performance Ratios tab',
      options: { entity_id: { type: 'string', short: 'i', description: 'Strategy entity_id' } },
      handler: (opts) => core.getRiskRatios({ entity_id: opts.entity_id }),
    }],
    ['set-active', {
      description: 'Set active strategy (multi-strategy charts)',
      handler: (opts, positionals) => core.setActive({ entity_id: positionals[0] }),
    }],
  ]),
});
