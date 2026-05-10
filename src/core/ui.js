/**
 * Core UI automation logic.
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';
import { dismissIfPresent } from './dialog.js';

// Shared in-page helper. Walks document + open shadow roots looking for a match.
// Returns the first matching element (or null). Used by click/hover/findElement/checkbox.
const RESOLVE_SELECTOR_JS = `
function __tvmcpResolve(by, value) {
  function walkAll(root, visit) {
    var stack = [root];
    while (stack.length) {
      var node = stack.pop();
      if (visit(node)) return true;
      if (node.shadowRoot) stack.push(node.shadowRoot);
      var kids = node.children || (node.host ? [] : []);
      for (var i = 0; i < kids.length; i++) stack.push(kids[i]);
      if (node.querySelectorAll) {
        // Also descend any open shadow roots inside descendants
        var shadowHosts = node.querySelectorAll('*');
        for (var j = 0; j < shadowHosts.length; j++) {
          if (shadowHosts[j].shadowRoot) stack.push(shadowHosts[j].shadowRoot);
        }
      }
    }
    return false;
  }
  function matches(el) {
    if (!el || !el.getAttribute) return false;
    if (by === 'aria-label') return el.getAttribute('aria-label') === value;
    if (by === 'data-name') return el.getAttribute('data-name') === value;
    if (by === 'class-contains') {
      var cls = el.getAttribute('class') || '';
      return cls.indexOf(value) !== -1;
    }
    if (by === 'text') {
      var tag = el.tagName;
      if (!tag) return false;
      var t = (el.textContent || '').trim();
      if (!t) return false;
      var rolesOk = ['BUTTON', 'A'].indexOf(tag) !== -1
        || el.getAttribute('role') === 'button'
        || el.getAttribute('role') === 'menuitem'
        || el.getAttribute('role') === 'tab';
      if (!rolesOk) return false;
      return t === value || t.toLowerCase() === value.toLowerCase();
    }
    return false;
  }
  // Phase 1: light query for cheap selectors (no shadow walk)
  if (by === 'aria-label') {
    var fast = document.querySelector('[aria-label="' + String(value).replace(/"/g, '\\\\"') + '"]');
    if (fast) return fast;
  } else if (by === 'data-name') {
    var fast2 = document.querySelector('[data-name="' + String(value).replace(/"/g, '\\\\"') + '"]');
    if (fast2) return fast2;
  } else if (by === 'class-contains') {
    var fast3 = document.querySelector('[class*="' + String(value).replace(/"/g, '\\\\"') + '"]');
    if (fast3) return fast3;
  }
  // Phase 2: deep walk including shadow roots
  var match = null;
  walkAll(document, function(n) { if (matches(n)) { match = n; return true; } return false; });
  return match;
}
`;

function buildResolverExpr(by, value, opts = {}) {
  // Returns a JS IIFE expression that resolves the selector and calls `then(el)`,
  // returning whatever `then` returns. Used to keep the selector logic shared.
  return `
    (function() {
      ${RESOLVE_SELECTOR_JS}
      var el = __tvmcpResolve(${JSON.stringify(by)}, ${JSON.stringify(value)});
      if (!el) return ${JSON.stringify(opts.notFoundReturn ?? null)};
      ${opts.afterResolve || 'return el;'}
    })()
  `;
}

async function waitForElement({ by, value, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate(`
      (function() {
        ${RESOLVE_SELECTOR_JS}
        var el = __tvmcpResolve(${JSON.stringify(by)}, ${JSON.stringify(value)});
        return !!el;
      })()
    `);
    if (found) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

export async function click({ by, value, wait_ms = 0, retries = 0, wait_after_ms = 0 }) {
  if (wait_ms > 0) {
    const ok = await waitForElement({ by, value, timeoutMs: Math.min(wait_ms, 5000) });
    if (!ok) throw new Error(`Element ${by}="${value}" did not appear within ${wait_ms}ms`);
  }

  let lastResult = null;
  const attempts = 1 + Math.max(0, Math.min(retries, 3));
  for (let attempt = 0; attempt < attempts; attempt++) {
    lastResult = await evaluate(buildResolverExpr(by, value, {
      notFoundReturn: { found: false },
      afterResolve: `
        try { el.click(); } catch(e) { return { found: true, error: e.message }; }
        return {
          found: true,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().substring(0, 80),
          aria_label: el.getAttribute('aria-label') || null,
          data_name: el.getAttribute('data-name') || null
        };
      `,
    }));
    if (lastResult && lastResult.found && !lastResult.error) break;
    if (attempt < attempts - 1) await new Promise(r => setTimeout(r, 100));
  }

  if (!lastResult || !lastResult.found) {
    throw new Error('No matching element found for ' + by + '="' + value + '"');
  }
  if (lastResult.error) {
    throw new Error(`Click failed: ${lastResult.error}`);
  }

  if (wait_after_ms > 0) {
    await new Promise(r => setTimeout(r, Math.min(wait_after_ms, 2000)));
  }

  return { success: true, clicked: lastResult, attempts: attempts };
}

/**
 * Idempotent checkbox toggle. Reads current state and clicks only if mismatched.
 * Supports native <input type="checkbox"> and ARIA [role="checkbox"].
 * Lookup by visible label text (matched against <label for=...>, ancestor <label>,
 * or aria-label), or by selector strategy + value.
 */
export async function setCheckbox({ label, by, value, checked }) {
  if (typeof checked !== 'boolean') throw new Error('checked must be boolean');
  if (!label && !by) throw new Error('Provide either label or (by, value)');

  const result = await evaluate(`
    (function() {
      ${RESOLVE_SELECTOR_JS}
      var label = ${JSON.stringify(label || null)};
      var by = ${JSON.stringify(by || null)};
      var value = ${JSON.stringify(value || null)};
      var desired = ${JSON.stringify(checked)};
      var el = null;

      if (by) {
        el = __tvmcpResolve(by, value);
      } else if (label) {
        // Find checkbox via associated label
        var labels = document.querySelectorAll('label');
        for (var i = 0; i < labels.length; i++) {
          var t = (labels[i].textContent || '').trim();
          if (t === label || t.toLowerCase() === label.toLowerCase()) {
            var forId = labels[i].getAttribute('for');
            if (forId) { el = document.getElementById(forId); if (el) break; }
            var inner = labels[i].querySelector('input[type="checkbox"], [role="checkbox"]');
            if (inner) { el = inner; break; }
          }
        }
        // Fallback: aria-label
        if (!el) {
          el = document.querySelector('input[type="checkbox"][aria-label="' + label.replace(/"/g, '\\\\"') + '"]')
            || document.querySelector('[role="checkbox"][aria-label="' + label.replace(/"/g, '\\\\"') + '"]');
        }
        // Fallback: text near a checkbox
        if (!el) {
          var allCbs = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
          for (var k = 0; k < allCbs.length; k++) {
            var p = allCbs[k].closest('label, [class*="row"], [class*="item"]');
            if (p && (p.textContent || '').trim().toLowerCase().indexOf(label.toLowerCase()) !== -1) {
              el = allCbs[k]; break;
            }
          }
        }
      }

      if (!el) return { found: false };
      var isInput = el.tagName === 'INPUT';
      var current = isInput ? !!el.checked : el.getAttribute('aria-checked') === 'true';
      if (current === desired) {
        return { found: true, was: current, clicked: false };
      }
      el.click();
      var nowState = isInput ? !!el.checked : el.getAttribute('aria-checked') === 'true';
      return { found: true, was: current, clicked: true, now: nowState };
    })()
  `);

  if (!result || !result.found) {
    throw new Error(`Checkbox not found: ${label ? `label="${label}"` : `${by}="${value}"`}`);
  }
  return {
    success: true,
    label: label || null,
    selector: by ? { by, value } : null,
    was: result.was,
    desired: checked,
    clicked: result.clicked,
    now: result.now ?? result.was,
  };
}

export async function openPanel({ panel, action }) {
  const isBottomPanel = panel === 'pine-editor' || panel === 'strategy-tester';
  if (isBottomPanel) {
    const widgetName = panel === 'pine-editor' ? 'pine-editor' : 'backtesting';
    const result = await evaluate(`
      (function() {
        var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
        if (!bwb) return { error: 'bottomWidgetBar not available' };
        var panel = ${JSON.stringify(panel)};
        var widgetName = ${JSON.stringify(widgetName)};
        var action = ${JSON.stringify(action)};
        var bottomArea = document.querySelector('[class*="layout__area--bottom"]');
        var isOpen = !!(bottomArea && bottomArea.offsetHeight > 50);
        if (panel === 'pine-editor') { var monacoEl = document.querySelector('.monaco-editor.pine-editor-monaco'); isOpen = isOpen && !!monacoEl; }
        if (panel === 'strategy-tester') { var stratPanel = document.querySelector('[data-name="backtesting"]') || document.querySelector('[class*="strategyReport"]'); isOpen = isOpen && !!(stratPanel && stratPanel.offsetParent); }
        var performed = 'none';
        if (action === 'open' || (action === 'toggle' && !isOpen)) {
          if (panel === 'pine-editor') { if (typeof bwb.activateScriptEditorTab === 'function') bwb.activateScriptEditorTab(); else if (typeof bwb.showWidget === 'function') bwb.showWidget(widgetName); }
          else { if (typeof bwb.showWidget === 'function') bwb.showWidget(widgetName); }
          performed = 'opened';
        } else if (action === 'close' || (action === 'toggle' && isOpen)) {
          if (typeof bwb.hideWidget === 'function') bwb.hideWidget(widgetName);
          performed = 'closed';
        }
        return { was_open: isOpen, performed: performed };
      })()
    `);
    if (result && result.error) throw new Error(result.error);
    return { success: true, panel, action, was_open: result?.was_open ?? false, performed: result?.performed ?? 'unknown' };
  } else {
    const selectorMap = {
      'watchlist': { dataName: 'base-watchlist-widget-button', ariaLabel: 'Watchlist' },
      'alerts': { dataName: 'alerts-button', ariaLabel: 'Alerts' },
      'trading': { dataName: 'trading-button', ariaLabel: 'Trading Panel' },
    };
    const sel = selectorMap[panel];
    const result = await evaluate(`
      (function() {
        var dataName = ${JSON.stringify(sel.dataName)};
        var ariaLabel = ${JSON.stringify(sel.ariaLabel)};
        var action = ${JSON.stringify(action)};
        var btn = document.querySelector('[data-name="' + dataName + '"]') || document.querySelector('[aria-label="' + ariaLabel + '"]');
        if (!btn) return { error: 'Button not found for panel: ' + ${JSON.stringify(panel)} };
        var isActive = btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('isActive') || btn.classList.toString().indexOf('active') !== -1 || btn.classList.toString().indexOf('Active') !== -1;
        var rightArea = document.querySelector('[class*="layout__area--right"]');
        var sidebarOpen = !!(rightArea && rightArea.offsetWidth > 50);
        var isOpen = isActive && sidebarOpen;
        var performed = 'none';
        if (action === 'open' && !isOpen) { btn.click(); performed = 'opened'; }
        else if (action === 'close' && isOpen) { btn.click(); performed = 'closed'; }
        else if (action === 'toggle') { btn.click(); performed = isOpen ? 'closed' : 'opened'; }
        else { performed = isOpen ? 'already_open' : 'already_closed'; }
        return { was_open: isOpen, performed: performed };
      })()
    `);
    if (result && result.error) throw new Error(result.error);
    return { success: true, panel, action, was_open: result?.was_open ?? false, performed: result?.performed ?? 'unknown' };
  }
}

export async function fullscreen() {
  const result = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="header-toolbar-fullscreen"]');
      if (!btn) return { found: false };
      btn.click();
      return { found: true };
    })()
  `);
  if (!result || !result.found) throw new Error('Fullscreen button not found');
  return { success: true, action: 'fullscreen_toggled' };
}

export async function layoutList() {
  const layouts = await evaluateAsync(`
    new Promise(function(resolve) {
      try {
        window.TradingViewApi.getSavedCharts(function(charts) {
          if (!charts || !Array.isArray(charts)) { resolve({layouts: [], source: 'internal_api', error: 'getSavedCharts returned no data'}); return; }
          var result = charts.map(function(c) { return { id: c.id || c.chartId || null, name: c.name || c.title || 'Untitled', symbol: c.symbol || null, resolution: c.resolution || null, modified: c.timestamp || c.modified || null }; });
          resolve({layouts: result, source: 'internal_api'});
        });
        setTimeout(function() { resolve({layouts: [], source: 'internal_api', error: 'getSavedCharts timed out'}); }, 5000);
      } catch(e) { resolve({layouts: [], source: 'internal_api', error: e.message}); }
    })
  `);
  return { success: true, layout_count: layouts?.layouts?.length || 0, source: layouts?.source, layouts: layouts?.layouts || [], error: layouts?.error };
}

export async function layoutSwitch({ name }) {
  const escaped = JSON.stringify(name);
  const result = await evaluateAsync(`
    new Promise(function(resolve) {
      try {
        var target = ${escaped};
        if (/^\\d+$/.test(target)) { window.TradingViewApi.loadChartFromServer(target); resolve({success: true, method: 'loadChartFromServer', id: target, source: 'internal_api'}); return; }
        window.TradingViewApi.getSavedCharts(function(charts) {
          if (!charts || !Array.isArray(charts)) { resolve({success: false, error: 'getSavedCharts returned no data', source: 'internal_api'}); return; }
          var match = null;
          for (var i = 0; i < charts.length; i++) { var cname = charts[i].name || charts[i].title || ''; if (cname === target || cname.toLowerCase() === target.toLowerCase()) { match = charts[i]; break; } }
          if (!match) { for (var j = 0; j < charts.length; j++) { var cn = (charts[j].name || charts[j].title || '').toLowerCase(); if (cn.indexOf(target.toLowerCase()) !== -1) { match = charts[j]; break; } } }
          if (!match) { resolve({success: false, error: 'Layout "' + target + '" not found.', source: 'internal_api'}); return; }
          var chartId = match.id || match.chartId;
          window.TradingViewApi.loadChartFromServer(chartId);
          resolve({success: true, method: 'loadChartFromServer', id: chartId, name: match.name || match.title, source: 'internal_api'});
        });
        setTimeout(function() { resolve({success: false, error: 'getSavedCharts timed out', source: 'internal_api'}); }, 5000);
      } catch(e) { resolve({success: false, error: e.message, source: 'internal_api'}); }
    })
  `);
  if (!result?.success) throw new Error(result?.error || 'Unknown error switching layout');

  // Handle "unsaved changes" confirmation dialog. Tries 'discard' first
  // (Open anyway / Don't save), falling back to 'cancel' if that's the only option.
  await new Promise(r => setTimeout(r, 500));
  const dialog = await dismissIfPresent({ intents: ['discard', 'cancel'] });
  if (dialog.dismissed) await new Promise(r => setTimeout(r, 1000));
  return {
    success: true,
    layout: result.name || name,
    layout_id: result.id,
    source: result.source,
    action: 'switched',
    unsaved_dialog_dismissed: dialog.dismissed,
    dialog_button: dialog.clicked || null,
  };
}

export async function keyboard({ key, modifiers }) {
  const c = await getClient();
  let mod = 0;
  if (modifiers) {
    if (modifiers.includes('alt')) mod |= 1;
    if (modifiers.includes('ctrl')) mod |= 2;
    if (modifiers.includes('meta')) mod |= 4;
    if (modifiers.includes('shift')) mod |= 8;
  }
  const keyMap = {
    'Enter': { code: 'Enter', vk: 13 }, 'Escape': { code: 'Escape', vk: 27 }, 'Tab': { code: 'Tab', vk: 9 },
    'Backspace': { code: 'Backspace', vk: 8 }, 'Delete': { code: 'Delete', vk: 46 },
    'ArrowUp': { code: 'ArrowUp', vk: 38 }, 'ArrowDown': { code: 'ArrowDown', vk: 40 },
    'ArrowLeft': { code: 'ArrowLeft', vk: 37 }, 'ArrowRight': { code: 'ArrowRight', vk: 39 },
    'Space': { code: 'Space', vk: 32 }, 'Home': { code: 'Home', vk: 36 }, 'End': { code: 'End', vk: 35 },
    'PageUp': { code: 'PageUp', vk: 33 }, 'PageDown': { code: 'PageDown', vk: 34 },
    'F1': { code: 'F1', vk: 112 }, 'F2': { code: 'F2', vk: 113 }, 'F5': { code: 'F5', vk: 116 },
  };
  const mapped = keyMap[key] || { code: 'Key' + key.toUpperCase(), vk: key.toUpperCase().charCodeAt(0) };
  await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: mod, key, code: mapped.code, windowsVirtualKeyCode: mapped.vk });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key, code: mapped.code });
  return { success: true, key, modifiers: modifiers || [] };
}

export async function typeText({ text }) {
  const c = await getClient();
  await c.Input.insertText({ text });
  return { success: true, typed: text.substring(0, 100), length: text.length };
}

export async function hover({ by, value }) {
  const coords = await evaluate(`
    (function() {
      var by = ${JSON.stringify(by)};
      var value = ${JSON.stringify(value)};
      var el = null;
      if (by === 'aria-label') {
        el = document.querySelector('[aria-label="' + value.replace(/"/g, '\\\\"') + '"]');
        if (!el) el = document.querySelector('[aria-label*="' + value.replace(/"/g, '\\\\"') + '"]');
      }
      else if (by === 'data-name') el = document.querySelector('[data-name="' + value.replace(/"/g, '\\\\"') + '"]');
      else if (by === 'text') {
        var candidates = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], span, div');
        for (var i = 0; i < candidates.length; i++) { var text = candidates[i].textContent.trim(); if (text === value || text.toLowerCase() === value.toLowerCase()) { el = candidates[i]; break; } }
      } else if (by === 'class-contains') el = document.querySelector('[class*="' + value.replace(/"/g, '\\\\"') + '"]');
      if (!el) return null;
      var rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName.toLowerCase() };
    })()
  `);
  if (!coords) throw new Error('Element not found for ' + by + '="' + value + '"');
  const c = await getClient();
  await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x: coords.x, y: coords.y });
  return { success: true, hovered: { by, value, tag: coords.tag, x: coords.x, y: coords.y } };
}

export async function scroll({ direction, amount }) {
  const c = await getClient();
  const px = amount || 300;
  const center = await evaluate(`
    (function() {
      var el = document.querySelector('[data-name="pane-canvas"]') || document.querySelector('[class*="chart-container"]') || document.querySelector('canvas');
      if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      var rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()
  `);
  let deltaX = 0, deltaY = 0;
  if (direction === 'up') deltaY = -px; else if (direction === 'down') deltaY = px;
  else if (direction === 'left') deltaX = -px; else if (direction === 'right') deltaX = px;
  await c.Input.dispatchMouseEvent({ type: 'mouseWheel', x: center.x, y: center.y, deltaX, deltaY });
  return { success: true, direction, amount: px };
}

/**
 * Get viewport size and devicePixelRatio. Useful for:
 *  - mapping screenshot pixels back to CSS coordinates (CDP Input expects CSS px)
 *  - vision-based workflows (Claude needs to know image dimensions)
 */
export async function getViewport() {
  const info = await evaluate(`
    (function() {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      };
    })()
  `);
  return { success: true, ...info };
}

export async function mouseClick({ x, y, button, double_click, coords_are }) {
  // CDP Input.dispatchMouseEvent expects CSS pixels. If caller is reading
  // coordinates off a screenshot at devicePixelRatio>1, divide by DPR.
  let cssX = x, cssY = y;
  if (coords_are === 'screenshot_pixels') {
    const vp = await getViewport();
    const dpr = vp.devicePixelRatio || 1;
    cssX = x / dpr;
    cssY = y / dpr;
  }

  const c = await getClient();
  const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
  const btnNum = btn === 'right' ? 2 : btn === 'middle' ? 1 : 0;
  await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x: cssX, y: cssY });
  await c.Input.dispatchMouseEvent({ type: 'mousePressed', x: cssX, y: cssY, button: btn, buttons: btnNum, clickCount: 1 });
  await c.Input.dispatchMouseEvent({ type: 'mouseReleased', x: cssX, y: cssY, button: btn });
  if (double_click) {
    await new Promise(r => setTimeout(r, 50));
    await c.Input.dispatchMouseEvent({ type: 'mousePressed', x: cssX, y: cssY, button: btn, buttons: btnNum, clickCount: 2 });
    await c.Input.dispatchMouseEvent({ type: 'mouseReleased', x: cssX, y: cssY, button: btn });
  }
  return {
    success: true,
    x: cssX,
    y: cssY,
    coords_are: coords_are || 'css',
    input_x: x,
    input_y: y,
    button: btn,
    double_click: !!double_click,
  };
}

/**
 * Composite: hover over a trigger element, wait for a target to appear, click it.
 * Useful for menus that only render their items on hover.
 *  - hoverBy/hoverValue: trigger to hover
 *  - clickBy/clickValue: target to click (waits up to wait_ms for it)
 */
export async function hoverAndClick({ hover_by, hover_value, click_by, click_value, wait_ms = 1000 }) {
  await hover({ by: hover_by, value: hover_value });
  // Small settle delay before polling — hover-driven menus animate in
  await new Promise(r => setTimeout(r, 100));
  return click({ by: click_by, value: click_value, wait_ms, retries: 1 });
}

/**
 * Drag from (fromX, fromY) to (toX, toY) with interpolated mouseMoved events.
 * Useful for chart drawing tools (trend lines, rectangles) and scroll/pan operations.
 */
export async function drag({ from_x, from_y, to_x, to_y, button, steps, coords_are }) {
  let fX = from_x, fY = from_y, tX = to_x, tY = to_y;
  if (coords_are === 'screenshot_pixels') {
    const vp = await getViewport();
    const dpr = vp.devicePixelRatio || 1;
    fX /= dpr; fY /= dpr; tX /= dpr; tY /= dpr;
  }
  const c = await getClient();
  const btn = button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
  const btnNum = btn === 'right' ? 2 : btn === 'middle' ? 1 : 0;
  const stepCount = Math.max(2, Math.min(steps || 20, 100));

  await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x: fX, y: fY });
  await c.Input.dispatchMouseEvent({ type: 'mousePressed', x: fX, y: fY, button: btn, buttons: btnNum, clickCount: 1 });
  for (let i = 1; i <= stepCount; i++) {
    const t = i / stepCount;
    const ix = fX + (tX - fX) * t;
    const iy = fY + (tY - fY) * t;
    await c.Input.dispatchMouseEvent({ type: 'mouseMoved', x: ix, y: iy, button: btn, buttons: btnNum });
  }
  await c.Input.dispatchMouseEvent({ type: 'mouseReleased', x: tX, y: tY, button: btn });
  return {
    success: true,
    from: { x: fX, y: fY },
    to: { x: tX, y: tY },
    coords_are: coords_are || 'css',
    steps: stepCount,
  };
}

export async function findElement({ query, strategy }) {
  const strat = strategy || 'text';
  const results = await evaluate(`
    (function() {
      var query = ${JSON.stringify(query)};
      var strategy = ${JSON.stringify(strat)};
      var results = [];
      if (strategy === 'css') {
        var els = document.querySelectorAll(query);
        for (var i = 0; i < Math.min(els.length, 20); i++) {
          var rect = els[i].getBoundingClientRect();
          results.push({ tag: els[i].tagName.toLowerCase(), text: (els[i].textContent || '').trim().substring(0, 80), aria_label: els[i].getAttribute('aria-label') || null, data_name: els[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: els[i].offsetParent !== null });
        }
      } else if (strategy === 'aria-label') {
        var els = document.querySelectorAll('[aria-label*="' + query.replace(/"/g, '\\\\"') + '"]');
        for (var i = 0; i < Math.min(els.length, 20); i++) {
          var rect = els[i].getBoundingClientRect();
          results.push({ tag: els[i].tagName.toLowerCase(), text: (els[i].textContent || '').trim().substring(0, 80), aria_label: els[i].getAttribute('aria-label') || null, data_name: els[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: els[i].offsetParent !== null });
        }
      } else {
        var all = document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], input, select, label, span, div, h1, h2, h3, h4');
        for (var i = 0; i < all.length; i++) {
          var text = all[i].textContent.trim();
          if (text.toLowerCase().indexOf(query.toLowerCase()) !== -1 && text.length < 200) {
            var rect = all[i].getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              results.push({ tag: all[i].tagName.toLowerCase(), text: text.substring(0, 80), aria_label: all[i].getAttribute('aria-label') || null, data_name: all[i].getAttribute('data-name') || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: all[i].offsetParent !== null });
              if (results.length >= 20) break;
            }
          }
        }
      }
      return results;
    })()
  `);
  return { success: true, query, strategy: strat, count: results?.length || 0, elements: results || [] };
}

export async function uiEvaluate({ expression }) {
  const result = await evaluate(expression);
  return { success: true, result };
}
