/**
 * Unit tests for dialog intent → label mapping.
 * Pure logic tests — no CDP / TradingView connection needed.
 *
 * Run: node --test tests/dialog.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT_LABELS } from '../src/core/dialog.js';

describe('INTENT_LABELS — semantic intent → button text candidates', () => {
  it('exposes all expected intents', () => {
    const required = ['confirm', 'cancel', 'discard', 'save', 'ok', 'yes', 'no', 'close'];
    for (const intent of required) {
      assert.ok(Array.isArray(INTENT_LABELS[intent]), `Missing intent: ${intent}`);
      assert.ok(INTENT_LABELS[intent].length > 0, `Empty candidates for intent: ${intent}`);
    }
  });

  it('discard intent covers TradingView "unsaved changes" dialog phrasings', () => {
    const candidates = INTENT_LABELS.discard.map(s => s.toLowerCase());
    // These are the actual labels TradingView uses
    assert.ok(candidates.some(c => c === "don't save"), 'Should include "Don\'t save"');
    assert.ok(candidates.some(c => c === 'discard'), 'Should include "Discard"');
    assert.ok(candidates.some(c => c === 'open anyway'), 'Should include "Open anyway"');
  });

  it('save intent matches Pine Editor save-script dialog', () => {
    assert.ok(INTENT_LABELS.save.includes('Save'));
  });

  it('confirm intent prioritizes OK/Confirm over Save', () => {
    // confirm is a generic "yes/proceed" intent; Save belongs to its own intent
    const first = INTENT_LABELS.confirm[0];
    assert.ok(['OK', 'Confirm', 'Yes', 'Apply'].includes(first),
      `confirm should lead with affirmative, got "${first}"`);
  });

  it('cancel intent does not include any affirmative-sounding labels', () => {
    const cancel = INTENT_LABELS.cancel.map(s => s.toLowerCase());
    for (const bad of ['ok', 'yes', 'confirm', 'save', 'apply']) {
      assert.ok(!cancel.includes(bad), `cancel must not include "${bad}"`);
    }
  });

  it('intents are mutually disjoint where it matters (no save in cancel etc.)', () => {
    // Discard must not include "Save" or "OK" — those would dismiss-as-confirm
    const discard = INTENT_LABELS.discard.map(s => s.toLowerCase());
    assert.ok(!discard.includes('save'));
    assert.ok(!discard.includes('ok'));
    assert.ok(!discard.includes('apply'));
  });
});

describe('describe() / clickButton() / dismissIfPresent()', () => {
  it('exports the expected functions', async () => {
    const mod = await import('../src/core/dialog.js');
    assert.equal(typeof mod.describe, 'function');
    assert.equal(typeof mod.clickButton, 'function');
    assert.equal(typeof mod.dismissIfPresent, 'function');
  });
});
