import { register } from '../router.js';
import * as core from '../../core/ticks.js';

register('ticks', {
  description: 'Read recent ticks from Time & Sales panel',
  options: {
    limit: { type: 'string', short: 'l', description: 'Max ticks to return (1-500, default 50)' },
    since: { type: 'string', short: 's', description: 'ISO timestamp filter' },
  },
  handler: (opts) => core.getTicks({
    limit: opts.limit ? Number(opts.limit) : 50,
    since: opts.since,
  }),
});
