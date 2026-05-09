import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeframe } from '../src/core/chart.js';

describe('setTimeframe — regex validation', () => {
  const fakeDeps = {
    evaluate: async () => null,
    waitForChartReady: async () => true,
    getInterval: async () => '1S',
  };

  it('accepts second-based resolutions', async () => {
    for (const tf of ['1S', '5S', '30S']) {
      const r = await setTimeframe({ timeframe: tf, _deps: { ...fakeDeps, getInterval: async () => tf } });
      assert.equal(r.success, true);
      assert.equal(r.timeframe, tf);
    }
  });

  it('accepts minute resolutions', async () => {
    for (const tf of ['1', '5', '15', '60', '240']) {
      const r = await setTimeframe({ timeframe: tf, _deps: { ...fakeDeps, getInterval: async () => tf } });
      assert.equal(r.success, true);
    }
  });

  it('accepts D/W/M', async () => {
    for (const tf of ['D', 'W', 'M']) {
      const r = await setTimeframe({ timeframe: tf, _deps: { ...fakeDeps, getInterval: async () => tf } });
      assert.equal(r.success, true);
    }
  });

  it('rejects invalid formats', async () => {
    for (const bad of ['1.5', 'X', '', '5x', '1H', '1m']) {
      await assert.rejects(
        () => setTimeframe({ timeframe: bad, _deps: fakeDeps }),
        /invalid timeframe/i,
        `expected reject for "${bad}"`,
      );
    }
  });

  it('returns post-call verification mismatch error', async () => {
    const deps = {
      evaluate: async () => null,
      waitForChartReady: async () => true,
      getInterval: async () => '15',
    };
    const r = await setTimeframe({ timeframe: '1S', _deps: deps });
    assert.equal(r.success, false);
    assert.match(r.error, /does not support/i);
  });
});
