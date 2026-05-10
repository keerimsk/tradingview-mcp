/**
 * Unit tests for Pine save-guard policy and tab waitForNew exports.
 * Pure logic only — no CDP / TradingView connection.
 *
 * Run: node --test tests/pine_new_guard.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSaveGuard } from '../src/core/pine.js';

const SAVED = {
  ready: true,
  scriptName: 'SMC Structure + FVG',
  isUntitled: false,
  hasUnsavedChanges: false,
};
const UNTITLED = {
  ready: true,
  scriptName: 'Untitled',
  isUntitled: true,
  hasUnsavedChanges: false,
};
const NOT_READY = { ready: false };

describe('evaluateSaveGuard — strict-by-default policy', () => {
  it('refuses save with no guard params when loaded script is saved', () => {
    assert.throws(
      () => evaluateSaveGuard(SAVED, {}),
      /Refusing to save.+SMC Structure.+expected untitled/,
    );
  });

  it('allows save with no params when editor is untitled', () => {
    const r = evaluateSaveGuard(UNTITLED, {});
    assert.equal(r.matched, 'expected_untitled');
    assert.equal(r.scriptName, 'Untitled');
  });

  it('allows save when expected_name matches loaded script', () => {
    const r = evaluateSaveGuard(SAVED, { expected_name: 'SMC Structure + FVG' });
    assert.equal(r.matched, 'expected_name');
  });

  it('refuses save when expected_name mismatches', () => {
    assert.throws(
      () => evaluateSaveGuard(SAVED, { expected_name: 'Wrong Name' }),
      /expected name="Wrong Name"/,
    );
  });

  it('expected_name match is case- and whitespace-trim sensitive', () => {
    // Trim is applied; case is NOT (intentional — names are case-sensitive in TV)
    assert.throws(
      () => evaluateSaveGuard(SAVED, { expected_name: 'smc structure + fvg' }),
      /Refusing to save/,
    );
    const r = evaluateSaveGuard(SAVED, { expected_name: '  SMC Structure + FVG  ' });
    assert.equal(r.matched, 'expected_name');
  });

  it('explicit expected_untitled:true refuses non-untitled', () => {
    assert.throws(
      () => evaluateSaveGuard(SAVED, { expected_untitled: true }),
      /expected untitled/,
    );
  });

  it('explicit expected_untitled:false allows any save (no_check)', () => {
    const r = evaluateSaveGuard(SAVED, { expected_untitled: false });
    assert.equal(r.matched, 'no_check');
  });

  it('force:true bypasses all checks even on saved script', () => {
    const r = evaluateSaveGuard(SAVED, { force: true });
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'force');
  });

  it('force:true skips even when state is not ready', () => {
    const r = evaluateSaveGuard(NOT_READY, { force: true });
    assert.equal(r.skipped, true);
  });

  it('non-ready state without force returns skipped, never throws', () => {
    const r = evaluateSaveGuard(NOT_READY, {});
    assert.equal(r.skipped, true);
    assert.equal(r.reason, 'editor_not_ready');
  });

  it('action label is interpolated into error message', () => {
    assert.throws(
      () => evaluateSaveGuard(SAVED, {}, 'smart_compile'),
      /Refusing to smart_compile/,
    );
  });

  it('expected_name takes precedence over expected_untitled', () => {
    // When both given, expected_name wins (it's more specific)
    const r = evaluateSaveGuard(SAVED, {
      expected_untitled: true,
      expected_name: 'SMC Structure + FVG',
    });
    assert.equal(r.matched, 'expected_name');
  });

  it('error message includes the actual loaded script name for self-correction', () => {
    try {
      evaluateSaveGuard(SAVED, {});
      assert.fail('should have thrown');
    } catch (e) {
      assert.match(e.message, /expected_name="SMC Structure \+ FVG"/);
      assert.match(e.message, /force:true to bypass/);
    }
  });
});

describe('pine.js exports — surface check', () => {
  it('exports evaluateSaveGuard, getLoadedScriptInfo, save, newScript, smartCompile', async () => {
    const m = await import('../src/core/pine.js');
    assert.equal(typeof m.evaluateSaveGuard, 'function');
    assert.equal(typeof m.getLoadedScriptInfo, 'function');
    assert.equal(typeof m.save, 'function');
    assert.equal(typeof m.newScript, 'function');
    assert.equal(typeof m.smartCompile, 'function');
  });
});

describe('tab.js exports — surface check', () => {
  it('exports waitForNew alongside existing list/newTab/etc.', async () => {
    const m = await import('../src/core/tab.js');
    assert.equal(typeof m.waitForNew, 'function');
    assert.equal(typeof m.newTab, 'function');
    assert.equal(typeof m.list, 'function');
    assert.equal(typeof m.switchTab, 'function');
    assert.equal(typeof m.getActive, 'function');
  });
});
