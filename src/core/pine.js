/**
 * Core Pine Script logic — shared between MCP tools and CLI.
 * All functions accept plain options objects and return plain JS objects.
 * They throw on error (callers catch and format).
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';
import { dismissIfPresent } from './dialog.js';

// ── Monaco finder (injected into TV page) ──
const FIND_MONACO = `
  (function findMonacoEditor() {
    var container = document.querySelector('.monaco-editor.pine-editor-monaco');
    if (!container) return null;
    var el = container;
    var fiberKey;
    for (var i = 0; i < 20; i++) {
      if (!el) break;
      fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$'); });
      if (fiberKey) break;
      el = el.parentElement;
    }
    if (!fiberKey) return null;
    var current = el[fiberKey];
    for (var d = 0; d < 15; d++) {
      if (!current) break;
      if (current.memoizedProps && current.memoizedProps.value && current.memoizedProps.value.monacoEnv) {
        var env = current.memoizedProps.value.monacoEnv;
        if (env.editor && typeof env.editor.getEditors === 'function') {
          var editors = env.editor.getEditors();
          if (editors.length > 0) return { editor: editors[0], env: env };
        }
      }
      current = current.return;
    }
    return null;
  })()
`;

/**
 * Opens the Pine Editor panel and waits for Monaco to become available.
 * Returns true if editor is accessible, false on timeout.
 */
export async function ensurePineEditorOpen() {
  const already = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      return m !== null;
    })()
  `);
  if (already) return true;

  await evaluate(`
    (function() {
      var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
      if (!bwb) return;
      if (typeof bwb.activateScriptEditorTab === 'function') bwb.activateScriptEditorTab();
      else if (typeof bwb.showWidget === 'function') bwb.showWidget('pine-editor');
    })()
  `);

  await evaluate(`
    (function() {
      var btn = document.querySelector('[aria-label="Pine"]')
        || document.querySelector('[data-name="pine-dialog-button"]');
      if (btn) btn.click();
    })()
  `);

  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    const ready = await evaluate(`(function() { return ${FIND_MONACO} !== null; })()`);
    if (ready) return true;
  }
  return false;
}

// ── Pure / offline functions ──

export function analyze({ source }) {
  const lines = source.split('\n');
  const diagnostics = [];

  let isV6 = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//@version=6')) { isV6 = true; break; }
    if (trimmed.startsWith('//@version=')) break;
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    break;
  }

  const arrays = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fromMatch = line.match(/(\w+)\s*=\s*array\.from\(([^)]*)\)/);
    if (fromMatch) {
      const name = fromMatch[1].trim();
      const args = fromMatch[2].trim();
      const size = args === '' ? 0 : args.split(',').length;
      arrays.set(name, { name, size, line: i + 1 });
      continue;
    }
    const newMatch = line.match(/(\w+)\s*=\s*array\.new(?:<\w+>|_\w+)\((\d+)?/);
    if (newMatch) {
      const name = newMatch[1].trim();
      const size = newMatch[2] !== undefined ? parseInt(newMatch[2], 10) : null;
      arrays.set(name, { name, size, line: i + 1 });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pattern = /array\.(get|set)\(\s*(\w+)\s*,\s*(-?\d+)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const method = match[1];
      const arrName = match[2];
      const idx = parseInt(match[3], 10);
      const info = arrays.get(arrName);
      if (!info || info.size === null) continue;
      if (idx < 0 || idx >= info.size) {
        diagnostics.push({
          line: i + 1, column: match.index + 1,
          message: `array.${method}(${arrName}, ${idx}) — index ${idx} out of bounds (array size is ${info.size})`,
          severity: 'error',
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const firstLastPattern = /(\w+)\.(first|last)\(\)/g;
    let match;
    while ((match = firstLastPattern.exec(line)) !== null) {
      const arrName = match[1];
      if (arrName === 'array') continue;
      const info = arrays.get(arrName);
      if (info && info.size === 0) {
        diagnostics.push({
          line: i + 1, column: match.index + 1,
          message: `${arrName}.${match[2]}() called on possibly empty array (declared with size 0)`,
          severity: 'warning',
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.includes('strategy.entry') || trimmed.includes('strategy.close')) {
      let hasStrategyDecl = false;
      for (const l of lines) {
        if (l.trim().startsWith('strategy(')) { hasStrategyDecl = true; break; }
      }
      if (!hasStrategyDecl) {
        diagnostics.push({
          line: i + 1, column: 1,
          message: 'strategy.entry/close used but no strategy() declaration found — did you mean to use indicator()?',
          severity: 'error',
        });
        break;
      }
    }
  }

  if (!isV6 && source.includes('//@version=')) {
    const vMatch = source.match(/\/\/@version=(\d+)/);
    if (vMatch && parseInt(vMatch[1]) < 5) {
      diagnostics.push({
        line: 1, column: 1,
        message: `Script uses Pine v${vMatch[1]} — consider upgrading to v6 for latest features`,
        severity: 'info',
      });
    }
  }

  return {
    success: true,
    issue_count: diagnostics.length,
    diagnostics,
    note: diagnostics.length === 0 ? 'No static analysis issues found. Use pine_compile or pine_smart_compile for full server-side compilation check.' : undefined,
  };
}

export async function check({ source }) {
  const formData = new URLSearchParams();
  formData.append('source', source);

  const response = await fetch(
    'https://pine-facade.tradingview.com/pine-facade/translate_light?user_name=Guest&pine_id=00000000-0000-0000-0000-000000000000',
    {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.tradingview.com/',
      },
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(`TradingView API returned ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  const errors = [];
  const warnings = [];
  const inner = result?.result;

  if (inner) {
    if (inner.errors2 && inner.errors2.length > 0) {
      for (const e of inner.errors2) {
        errors.push({
          line: e.start?.line, column: e.start?.column,
          end_line: e.end?.line, end_column: e.end?.column,
          message: e.message,
        });
      }
    }
    if (inner.warnings2 && inner.warnings2.length > 0) {
      for (const w of inner.warnings2) {
        warnings.push({ line: w.start?.line, column: w.start?.column, message: w.message });
      }
    }
  }

  if (result.error && typeof result.error === 'string') {
    errors.push({ message: result.error });
  }

  const compiled = errors.length === 0;
  return {
    success: true,
    compiled,
    error_count: errors.length,
    warning_count: warnings.length,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    note: compiled ? 'Pine Script compiled successfully.' : undefined,
  };
}

// ── Functions requiring TradingView connection ──

export async function getSource() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor or Monaco not found in React fiber tree.');

  const source = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return null;
      return m.editor.getValue();
    })()
  `);

  if (source === null || source === undefined) {
    throw new Error('Monaco editor found but getValue() returned null.');
  }

  return { success: true, source, line_count: source.split('\n').length, char_count: source.length };
}

export async function setSource({ source }) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const escaped = JSON.stringify(source);
  const set = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return false;
      m.editor.setValue(${escaped});
      return true;
    })()
  `);

  if (!set) throw new Error('Monaco found but setValue() failed.');
  return { success: true, lines_set: source.split('\n').length };
}

export async function compile() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const clicked = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      var fallback = null;
      var saveBtn = null;
      // Accept either "Add to chart" / "Update on chart" or the doubled-text
      // form ("Add to chartAdd to chart") that comes from icon+label spans.
      var fallbackRe = /^((add to chart)+|(update on chart)+)$/i;
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (/save and add to chart/i.test(text)) {
          btns[i].click();
          return 'Save and add to chart';
        }
        if (!fallback && fallbackRe.test(text)) {
          fallback = btns[i];
        }
        if (!saveBtn && btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) {
          saveBtn = btns[i];
        }
      }
      if (fallback) { fallback.click(); return fallback.textContent.trim(); }
      if (saveBtn) { saveBtn.click(); return 'Pine Save'; }
      return null;
    })()
  `);

  if (!clicked) {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  }

  await new Promise(r => setTimeout(r, 2000));
  return { success: true, button_clicked: clicked || 'keyboard_shortcut', source: 'dom_fallback' };
}

export async function getErrors() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const errors = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return [];
      var model = m.editor.getModel();
      if (!model) return [];
      var markers = m.env.editor.getModelMarkers({ resource: model.uri });
      return markers.map(function(mk) {
        return { line: mk.startLineNumber, column: mk.startColumn, message: mk.message, severity: mk.severity };
      });
    })()
  `);

  return {
    success: true,
    has_errors: errors?.length > 0,
    error_count: errors?.length || 0,
    errors: errors || [],
  };
}

/**
 * Read the currently-loaded Pine script's identity from the editor toolbar.
 * Returns:
 *   - scriptName:     visible script title (e.g. "SMC Structure + FVG", "Untitled")
 *   - isUntitled:     true if the editor is not bound to a saved script slot
 *   - hasUnsavedChanges: true if the save button shows a dirty marker
 *
 * No scriptIdPart available from the DOM — TV exposes only the name. Callers
 * doing strict overwrite guards should compare on scriptName.
 *
 * Returns { ready: false } when the Pine Editor panel is not present (caller
 * decides whether that's an error or to open it first).
 */
export async function getLoadedScriptInfo() {
  const info = await evaluate(`
    (function() {
      var nameBtn = document.querySelector('[class*="nameButton-"]');
      var saveBtn = document.querySelector('[class*="saveButton-"]');
      var monaco = document.querySelector('.monaco-editor.pine-editor-monaco');
      if (!nameBtn || !monaco) {
        return { ready: false, monacoFound: !!monaco, nameButtonFound: !!nameBtn };
      }
      var name = (nameBtn.textContent || '').trim();
      // TV's save button toggles classes: 'saved-...' = no unsaved changes,
      // 'hidden-...' = hidden (no work to save). Either means clean.
      var saveCls = saveBtn ? (saveBtn.className || '') : '';
      var isClean = /\\bsaved-|\\bhidden-/.test(saveCls);
      // "Untitled" naming or empty title means no bound script slot.
      var isUntitled = !name || /^untitled/i.test(name);
      return {
        ready: true,
        scriptName: name || null,
        isUntitled: isUntitled,
        hasUnsavedChanges: !isClean,
      };
    })()
  `);
  return { success: true, ...info };
}

/**
 * Pure: decide whether a save is allowed given the loaded script's state and
 * the caller's guard parameters. Throws with a descriptive error if not.
 * Exported so unit tests can validate the policy without a live CDP connection.
 *
 *   loadedInfo = { ready, scriptName, isUntitled, hasUnsavedChanges }
 *   guard = {
 *     expected_untitled?: boolean,   // require editor to be on a fresh untitled script
 *     expected_name?: string,        // require loaded script's name to match
 *     force?: boolean,               // bypass all checks
 *   }
 *
 * Default behavior (no guard params): treat as expected_untitled:true — the
 * safest mode. Callers that mean to overwrite a known saved script must opt
 * in via expected_name or force.
 */
export function evaluateSaveGuard(loadedInfo, guard = {}, action = 'save') {
  if (guard?.force) return { skipped: true, reason: 'force' };
  if (!loadedInfo?.ready) {
    return { skipped: true, reason: 'editor_not_ready' };
  }

  const wantsUntitled = guard?.expected_untitled === true
    || (guard?.expected_untitled !== false && !guard?.expected_name);
  const expectedName = guard?.expected_name;

  if (expectedName) {
    if ((loadedInfo.scriptName || '').trim() !== String(expectedName).trim()) {
      throw new Error(
        `Refusing to ${action}: editor has loaded script "${loadedInfo.scriptName || 'Untitled'}" ` +
          `but caller expected name="${expectedName}". ` +
          `Pass expected_name="${loadedInfo.scriptName}" to confirm overwrite, or force:true to bypass.`,
      );
    }
    return { matched: 'expected_name', scriptName: loadedInfo.scriptName };
  }

  if (wantsUntitled && !loadedInfo.isUntitled) {
    throw new Error(
      `Refusing to ${action}: editor has loaded saved script "${loadedInfo.scriptName}" ` +
        `but caller expected untitled. Call pine_new first to create a fresh untitled script, ` +
        `or pass expected_name="${loadedInfo.scriptName}" to confirm overwrite, ` +
        `or force:true to bypass.`,
    );
  }
  return { matched: wantsUntitled ? 'expected_untitled' : 'no_check', scriptName: loadedInfo.scriptName };
}

/**
 * Internal: read live editor state, then run evaluateSaveGuard. Wraps the
 * CDP call so save() / smartCompile() don't repeat themselves.
 */
async function enforceSaveGuard(guard = {}, action = 'save') {
  if (guard?.force) return { skipped: true, reason: 'force' };
  const info = await getLoadedScriptInfo();
  return evaluateSaveGuard(info, guard, action);
}

/**
 * Close (minimize) the bottom widget bar — collapses Pine Editor / Strategy
 * Tester / etc. so they're not visually in the way after save/compile.
 * Idempotent and safe to call when nothing's open.
 */
export async function closeBottomPanel() {
  const result = await evaluate(`
    (function() {
      var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
      if (!bwb) return { success: false, reason: 'no_bwb' };
      try {
        if (bwb._mode && typeof bwb._mode.setValue === 'function') {
          bwb._mode.setValue('minimized');
          return { success: true, method: '_mode.setValue("minimized")' };
        }
        if (typeof bwb.toggleMinimize === 'function') {
          bwb.toggleMinimize();
          return { success: true, method: 'toggleMinimize' };
        }
        if (typeof bwb.hide === 'function') {
          bwb.hide();
          return { success: true, method: 'hide' };
        }
        return { success: false, reason: 'no_close_method' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    })()
  `);
  return result;
}

export async function save({ expected_untitled, expected_name, force, close_after = true } = {}) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const guardResult = await enforceSaveGuard({ expected_untitled, expected_name, force }, 'save');

  const c = await getClient();
  await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 's', code: 'KeyS' });
  await new Promise(r => setTimeout(r, 800));

  // For new/unsaved scripts a "Save Script" name dialog appears — confirm it.
  const dialog = await dismissIfPresent({ intents: ['save', 'confirm'] });
  if (dialog.dismissed) await new Promise(r => setTimeout(r, 500));

  // Optionally collapse the bottom panel so the editor isn't visually in the
  // way after save (default true — user typically wants to see the chart).
  let closeResult = null;
  if (close_after) {
    closeResult = await closeBottomPanel();
  }

  return {
    success: true,
    action: dialog.dismissed ? 'saved_with_dialog' : 'Ctrl+S_dispatched',
    dialog_button: dialog.clicked || null,
    guard: guardResult,
    panel_closed: close_after ? !!closeResult?.success : false,
  };
}

export async function getConsole() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const entries = await evaluate(`
    (function() {
      var results = [];
      var rows = document.querySelectorAll('[class*="consoleRow"], [class*="log-"], [class*="consoleLine"]');
      if (rows.length === 0) {
        var bottomArea = document.querySelector('[class*="layout__area--bottom"]')
          || document.querySelector('[class*="bottom-widgetbar-content"]');
        if (bottomArea) {
          rows = bottomArea.querySelectorAll('[class*="message"], [class*="log"], [class*="console"]');
        }
      }
      if (rows.length === 0) {
        var pinePanel = document.querySelector('.pine-editor-container')
          || document.querySelector('[class*="pine-editor"]')
          || document.querySelector('[class*="layout__area--bottom"]');
        if (pinePanel) {
          var allSpans = pinePanel.querySelectorAll('span, div');
          for (var s = 0; s < allSpans.length; s++) {
            var txt = allSpans[s].textContent.trim();
            if (/^\\d{2}:\\d{2}:\\d{2}/.test(txt) || /error|warning|info/i.test(allSpans[s].className)) {
              rows = Array.from(rows || []);
              rows.push(allSpans[s]);
            }
          }
        }
      }
      for (var i = 0; i < rows.length; i++) {
        var text = rows[i].textContent.trim();
        if (!text) continue;
        var ts = null;
        var tsMatch = text.match(/^(\\d{4}-\\d{2}-\\d{2}\\s+)?\\d{2}:\\d{2}:\\d{2}/);
        if (tsMatch) ts = tsMatch[0];
        var type = 'info';
        var cls = rows[i].className || '';
        if (/error/i.test(cls) || /error/i.test(text.substring(0, 30))) type = 'error';
        else if (/compil/i.test(text.substring(0, 40))) type = 'compile';
        else if (/warn/i.test(cls)) type = 'warning';
        results.push({ timestamp: ts, type: type, message: text });
      }
      return results;
    })()
  `);

  return { success: true, entries: entries || [], entry_count: entries?.length || 0 };
}

export async function smartCompile({ expected_untitled, expected_name, force, close_after = true } = {}) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  // Save guard: smartCompile may click "Save and add to chart" or trigger Ctrl+S
  // which can overwrite the loaded saved script. Apply the same strict-by-default
  // protection as save().
  const guardResult = await enforceSaveGuard({ expected_untitled, expected_name, force }, 'smart_compile');

  const studiesBefore = await evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        if (chart && typeof chart.getAllStudies === 'function') return chart.getAllStudies().length;
      } catch(e) {}
      return null;
    })()
  `);

  const buttonClicked = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      var addBtn = null;
      var updateBtn = null;
      var saveBtn = null;
      // TV's button has icon+label spans which both produce "Add to chart" in
      // textContent — so the regex accepts the literal text once OR doubled.
      var addRe = /^(add to chart)+$/i;
      var updateRe = /^(update on chart)+$/i;
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (/save and add to chart/i.test(text)) {
          btns[i].click();
          return 'Save and add to chart';
        }
        if (!addBtn && addRe.test(text)) addBtn = btns[i];
        if (!updateBtn && updateRe.test(text)) updateBtn = btns[i];
        if (!saveBtn && btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) saveBtn = btns[i];
      }
      if (addBtn) { addBtn.click(); return 'Add to chart'; }
      if (updateBtn) { updateBtn.click(); return 'Update on chart'; }
      if (saveBtn) { saveBtn.click(); return 'Pine Save'; }
      return null;
    })()
  `);

  if (!buttonClicked) {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  }

  await new Promise(r => setTimeout(r, 2500));

  const errors = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return [];
      var model = m.editor.getModel();
      if (!model) return [];
      var markers = m.env.editor.getModelMarkers({ resource: model.uri });
      return markers.map(function(mk) {
        return { line: mk.startLineNumber, column: mk.startColumn, message: mk.message, severity: mk.severity };
      });
    })()
  `);

  const studiesAfter = await evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        if (chart && typeof chart.getAllStudies === 'function') return chart.getAllStudies().length;
      } catch(e) {}
      return null;
    })()
  `);

  const studyAdded = (studiesBefore !== null && studiesAfter !== null) ? studiesAfter > studiesBefore : null;

  // Collapse the bottom panel so the chart is fully visible after add.
  let closeResult = null;
  if (close_after) {
    closeResult = await closeBottomPanel();
  }

  return {
    success: true,
    button_clicked: buttonClicked || 'keyboard_shortcut',
    has_errors: errors?.length > 0,
    errors: errors || [],
    study_added: studyAdded,
    guard: guardResult,
    panel_closed: close_after ? !!closeResult?.success : false,
  };
}

/**
 * Create a fresh untitled Pine script in the editor.
 *
 * Flow:
 *   1. Read the currently loaded script. If it has unsaved changes, refuse
 *      (would silently lose user work). Caller can pass force_discard:true
 *      to override.
 *   2. Click TV's script-name dropdown (the title element next to the
 *      editor) to open the script-management menu.
 *   3. Click the "Create new" menu item — TV detaches the loaded scriptId
 *      and starts a fresh untitled session.
 *   4. If a "Save changes?" dialog appears, dismiss with discard intent
 *      (only safe because step 1 already verified no unsaved changes).
 *   5. Re-read state to verify the editor is now untitled. If not, throw.
 *   6. Optionally seed the editor with a starter template.
 *
 * Output guarantees: when this returns success, the editor is on a fresh
 * untitled script slot — a subsequent save() creates a NEW saved entry,
 * never overwrites an existing one.
 */
export async function newScript({ kind = 'indicator', type, source, force_discard = false } = {}) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  // Backwards-compat: callers used `type` before; accept either.
  const scriptKind = kind || type || 'indicator';

  // Step 1: check current state
  const before = await getLoadedScriptInfo();
  if (!before.ready) {
    throw new Error('Pine Editor not ready (Monaco or script-name button not found).');
  }
  if (before.hasUnsavedChanges && !force_discard) {
    throw new Error(
      `Refusing to create new script: editor has unsaved changes on "${before.scriptName}". ` +
        `Save them with pine_save (passing expected_name="${before.scriptName}"), ` +
        `or call pine_new again with force_discard:true to discard.`,
    );
  }

  // Step 2: open the script-name dropdown
  const opened = await evaluate(`
    (function() {
      var btn = document.querySelector('[class*="nameButton-"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  if (!opened) {
    throw new Error('Could not find Pine Editor script-name button. UI selector may have changed.');
  }
  await new Promise(r => setTimeout(r, 500));

  // Step 3: hover on "Create new" — opens a submenu with kind options.
  // Critical: clicking is NOT enough; the submenu only appears on hover.
  // Use CDP Input.dispatchMouseEvent to dispatch a real mouseMoved event.
  const createNewRect = await evaluate(`
    (function() {
      var nodes = document.querySelectorAll('[class*="button-HZXWyU6m"]');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n.offsetParent) continue;
        var t = (n.textContent || '').trim();
        if (t === 'Create new') {
          var r = n.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    })()
  `);
  if (!createNewRect) {
    await evaluate('document.body.click()');
    throw new Error('Could not find "Create new" menu item in script-name dropdown.');
  }
  // Hover to open submenu
  const mouseClient = await getClient();
  await mouseClient.Input.dispatchMouseEvent({ type: 'mouseMoved', x: createNewRect.x, y: createNewRect.y });
  await new Promise(r => setTimeout(r, 600));

  // Step 3b: pick the kind from the submenu. Submenu items appear after
  // the hover; their text reads "IndicatorCtrl + K, Ctrl + I" etc.
  const kindLabel = scriptKind === 'strategy' ? 'Strategy'
    : scriptKind === 'library' ? 'Library'
    : 'Indicator';
  const kindRect = await evaluate(`
    (function() {
      var label = ${JSON.stringify(kindLabel)};
      var nodes = document.querySelectorAll('[class*="button-HZXWyU6m"]');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n.offsetParent) continue;
        var t = (n.textContent || '').trim();
        if ((t === label || t.indexOf(label) === 0) && t !== 'Create new') {
          var r = n.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: t.substring(0, 60) };
        }
      }
      return null;
    })()
  `);
  if (!kindRect) {
    await evaluate('document.body.click()');
    throw new Error(
      `Could not find "${kindLabel}" item in Create new submenu. ` +
        `Hover did not produce submenu — TV layout may have changed. Try ui_screen_inspect to diagnose.`,
    );
  }
  // Move to the submenu item then click via CDP mouse events
  await mouseClient.Input.dispatchMouseEvent({ type: 'mouseMoved', x: kindRect.x, y: kindRect.y });
  await new Promise(r => setTimeout(r, 100));
  await mouseClient.Input.dispatchMouseEvent({ type: 'mousePressed', x: kindRect.x, y: kindRect.y, button: 'left', clickCount: 1 });
  await mouseClient.Input.dispatchMouseEvent({ type: 'mouseReleased', x: kindRect.x, y: kindRect.y, button: 'left' });
  await new Promise(r => setTimeout(r, 800));

  // Step 4: handle "Save changes?" dialog if it appears (we already checked
  // for unsaved changes; if a dialog still pops, discard is safe).
  await dismissIfPresent({ intents: ['discard', 'cancel'] });
  await new Promise(r => setTimeout(r, 400));

  // Step 5: verify untitled state
  const after = await getLoadedScriptInfo();
  if (!after.ready) {
    throw new Error('Pine Editor lost readiness after Create new click.');
  }
  if (!after.isUntitled) {
    throw new Error(
      `Failed to transition to untitled state — editor still shows "${after.scriptName}". ` +
        `Refusing to setValue() to avoid overwriting it.`,
    );
  }

  // Step 6: optionally seed with a template
  const templates = {
    indicator: '//@version=6\nindicator("My script")\nplot(close)',
    strategy: '//@version=6\nstrategy("My strategy", overlay=true)\n',
    library: '//@version=6\n// @description TODO: add library description here\nlibrary("MyLibrary")\n',
  };
  const seed = source !== undefined ? source : (templates[scriptKind] || templates.indicator);
  if (seed) {
    const escaped = JSON.stringify(seed);
    await evaluate(`
      (function() {
        var m = ${FIND_MONACO};
        if (m) m.editor.setValue(${escaped});
      })()
    `);
  }

  return {
    success: true,
    action: 'new_script_created',
    kind: scriptKind,
    was_loaded: before.scriptName,
    now: 'untitled',
  };
}

export async function openScript({ name }) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const escapedName = JSON.stringify(name.toLowerCase());

  const result = await evaluateAsync(`
    (function() {
      var target = ${escapedName};
      return fetch('https://pine-facade.tradingview.com/pine-facade/list/?filter=saved', { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(scripts) {
          if (!Array.isArray(scripts)) return {error: 'pine-facade returned unexpected data'};
          var match = null;
          for (var i = 0; i < scripts.length; i++) {
            var sn = (scripts[i].scriptName || '').toLowerCase();
            var st = (scripts[i].scriptTitle || '').toLowerCase();
            if (sn === target || st === target) { match = scripts[i]; break; }
          }
          if (!match) {
            for (var j = 0; j < scripts.length; j++) {
              var sn2 = (scripts[j].scriptName || '').toLowerCase();
              var st2 = (scripts[j].scriptTitle || '').toLowerCase();
              if (sn2.indexOf(target) !== -1 || st2.indexOf(target) !== -1) { match = scripts[j]; break; }
            }
          }
          if (!match) return {error: 'Script "' + target + '" not found. Use pine_list_scripts to see available scripts.'};

          var id = match.scriptIdPart;
          var ver = match.version || 1;
          return fetch('https://pine-facade.tradingview.com/pine-facade/get/' + id + '/' + ver, { credentials: 'include' })
            .then(function(r2) { return r2.json(); })
            .then(function(data) {
              var source = data.source || '';
              if (!source) return {error: 'Script source is empty', name: match.scriptName || match.scriptTitle};
              var m = ${FIND_MONACO};
              if (m) {
                m.editor.setValue(source);
                return {success: true, name: match.scriptName || match.scriptTitle, id: id, lines: source.split('\\n').length};
              }
              return {error: 'Monaco editor not found to inject source', name: match.scriptName || match.scriptTitle};
            });
        })
        .catch(function(e) { return {error: e.message}; });
    })()
  `);

  if (result?.error) {
    throw new Error(result.error);
  }

  return { success: true, name: result.name, script_id: result.id, lines: result.lines, source: 'internal_api', opened: true };
}

export async function listScripts() {
  const scripts = await evaluateAsync(`
    fetch('https://pine-facade.tradingview.com/pine-facade/list/?filter=saved', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data)) return {scripts: [], error: 'Unexpected response from pine-facade'};
        return {
          scripts: data.map(function(s) {
            return {
              id: s.scriptIdPart || null,
              name: s.scriptName || s.scriptTitle || 'Untitled',
              title: s.scriptTitle || null,
              version: s.version || null,
              modified: s.modified || null,
            };
          })
        };
      })
      .catch(function(e) { return {scripts: [], error: e.message}; })
  `);

  return {
    success: true,
    scripts: scripts?.scripts || [],
    count: scripts?.scripts?.length || 0,
    source: 'internal_api',
    error: scripts?.error,
  };
}
