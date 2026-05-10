import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/pine.js';

export function registerPineTools(server) {
  server.tool('pine_get_source', 'Get current Pine Script source code from the editor', {}, async () => {
    try { return jsonResult(await core.getSource()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_set_source', 'Set Pine Script source code in the editor', {
    source: z.string().describe('Pine Script source code to inject'),
  }, async ({ source }) => {
    try { return jsonResult(await core.setSource({ source })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_compile', 'Compile / add the current Pine Script to the chart', {}, async () => {
    try { return jsonResult(await core.compile()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_get_errors', 'Get Pine Script compilation errors from Monaco markers', {}, async () => {
    try { return jsonResult(await core.getErrors()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool(
    'pine_save',
    'Save the current Pine Script (Ctrl+S). STRICT-BY-DEFAULT: refuses to save unless the editor is on a fresh untitled script slot, to prevent silently overwriting an unrelated saved script. To save updates to an existing script, pass expected_name="<exact loaded name>" or force:true. Collapses the Pine Editor panel after save by default (close_after).',
    {
      expected_untitled: z.coerce.boolean().optional().describe('Require editor to be on an untitled script (default: implied true when no other guard given)'),
      expected_name: z.string().optional().describe('Require currently-loaded script name to match this (overrides expected_untitled)'),
      force: z.coerce.boolean().optional().describe('Bypass all guards (use with care — can overwrite scripts)'),
      close_after: z.coerce.boolean().optional().describe('Collapse the bottom Pine Editor panel after save (default true)'),
    },
    async (args) => {
      try { return jsonResult(await core.save(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'pine_get_loaded_info',
    'Read the Pine Editor toolbar to identify the currently-loaded script: scriptName, isUntitled, hasUnsavedChanges. Useful before pine_save to verify which script is about to be written.',
    {},
    async () => {
      try { return jsonResult(await core.getLoadedScriptInfo()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool('pine_get_console', 'Read Pine Script console/log output (compile messages, log.info(), errors)', {}, async () => {
    try { return jsonResult(await core.getConsole()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool(
    'pine_smart_compile',
    'Intelligent compile: detects button, compiles, checks errors, reports study changes. STRICT-BY-DEFAULT save guard. Collapses Pine Editor panel after add-to-chart by default (close_after).',
    {
      expected_untitled: z.coerce.boolean().optional().describe('Require editor to be on an untitled script (default: implied true when no other guard given)'),
      expected_name: z.string().optional().describe('Require currently-loaded script name to match this'),
      force: z.coerce.boolean().optional().describe('Bypass all guards'),
      close_after: z.coerce.boolean().optional().describe('Collapse the bottom Pine Editor panel after compile (default true)'),
    },
    async (args) => {
      try { return jsonResult(await core.smartCompile(args)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool(
    'pine_new',
    'Create a fresh untitled Pine script in the editor by clicking TV\'s "Create new" menu item — properly detaches any loaded script so the next save creates a NEW entry instead of overwriting. Refuses to proceed if the editor has unsaved changes (pass force_discard:true to override).',
    {
      kind: z.enum(['indicator', 'strategy', 'library']).optional().describe('Script kind (default indicator)'),
      source: z.string().optional().describe('Optional starter source code (default: a minimal template)'),
      force_discard: z.coerce.boolean().optional().describe('Discard unsaved changes in current script (default false → refuse with error)'),
    },
    async ({ kind, source, force_discard }) => {
      try { return jsonResult(await core.newScript({ kind, source, force_discard })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );

  server.tool('pine_open', 'Open a saved Pine Script by name', {
    name: z.string().describe('Name of the saved script to open (case-insensitive match)'),
  }, async ({ name }) => {
    try { return jsonResult(await core.openScript({ name })); }
    catch (err) { return jsonResult({ success: false, source: 'internal_api', error: err.message }, true); }
  });

  server.tool('pine_list_scripts', 'List saved Pine Scripts', {}, async () => {
    try { return jsonResult(await core.listScripts()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_analyze', 'Run static analysis on Pine Script code WITHOUT compiling — catches array out-of-bounds, unguarded array.first()/last(), bad loop bounds, and implicit bool casts. Works offline, no TradingView connection needed.', {
    source: z.string().describe('Pine Script source code to analyze'),
  }, async ({ source }) => {
    try { return jsonResult(core.analyze({ source })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('pine_check', 'Compile Pine Script via TradingView\'s server API without needing the chart open. Returns compilation errors/warnings. Useful for validating code before injecting into the chart.', {
    source: z.string().describe('Pine Script source code to compile/validate'),
  }, async ({ source }) => {
    try { return jsonResult(await core.check({ source })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
