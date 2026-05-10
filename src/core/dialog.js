/**
 * Active modal/dialog detection and interaction.
 *
 * Detects the topmost visible dialog (by role="dialog" or class hint + highest z-index),
 * describes its buttons/checkboxes/inputs, and lets callers click a button by intent
 * (confirm/cancel/discard/save/ok/yes/no) or by exact label.
 */
import { evaluate } from '../connection.js';

// Intent → ranked button-text candidates. First match (case-insensitive, exact text)
// wins; falls back to substring match if no exact hit.
export const INTENT_LABELS = {
  confirm: ['OK', 'Confirm', 'Yes', 'Apply', 'Save', 'Continue', 'Proceed'],
  ok: ['OK', 'Confirm', 'Yes'],
  save: ['Save', 'Save changes', 'Apply'],
  cancel: ['Cancel', 'No', 'Close', 'Dismiss'],
  discard: ["Don't save", 'Discard', 'Open anyway', 'Discard changes', "Don't Save"],
  yes: ['Yes', 'OK', 'Confirm'],
  no: ['No', 'Cancel'],
  close: ['Close', 'Cancel', 'Dismiss'],
};

const VALID_INTENTS = Object.keys(INTENT_LABELS);

// JS snippet evaluated in the page; returns the topmost visible dialog node info.
// Strategy: collect candidates matching role/class, filter to visible (offsetParent !== null),
// pick the one with highest computed z-index (ties → last-in-DOM, i.e. drawn on top).
const FIND_DIALOG_JS = `
(function() {
  var sels = ['[role="dialog"]', '[class*="dialog"]', '[class*="modal"]', '[class*="popup"]', '[class*="Dialog"]', '[class*="Modal"]'];
  var seen = new Set();
  var candidates = [];
  for (var s = 0; s < sels.length; s++) {
    var nodes = document.querySelectorAll(sels[s]);
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (seen.has(n)) continue;
      seen.add(n);
      if (!n.offsetParent && n.tagName !== 'BODY') continue;
      var rect = n.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 30) continue;
      var z = parseInt(getComputedStyle(n).zIndex, 10);
      if (!Number.isFinite(z)) z = 0;
      candidates.push({ node: n, z: z, area: rect.width * rect.height, rect: rect });
    }
  }
  if (candidates.length === 0) return null;
  // Pick highest z; on tie, largest area (the actual dialog vs. its inner panels)
  candidates.sort(function(a, b) {
    if (b.z !== a.z) return b.z - a.z;
    return b.area - a.area;
  });
  return candidates[0];
})()
`;

function buildIntentGuess(label) {
  const lower = (label || '').trim().toLowerCase();
  for (const intent of VALID_INTENTS) {
    for (const candidate of INTENT_LABELS[intent]) {
      if (candidate.toLowerCase() === lower) return intent;
    }
  }
  // Substring fallback
  if (/save|apply/.test(lower)) return 'save';
  if (/discard|don'?t save|open anyway/.test(lower)) return 'discard';
  if (/cancel|close|dismiss/.test(lower)) return 'cancel';
  if (/^(ok|yes|confirm|continue|proceed)$/.test(lower)) return 'confirm';
  if (/^no$/.test(lower)) return 'no';
  return null;
}

export async function describe() {
  const info = await evaluate(`
    (function() {
      var found = ${FIND_DIALOG_JS};
      if (!found) return { found: false };
      var n = found.node;
      var rect = found.rect;

      // Title: first heading-like element
      var titleEl = n.querySelector('h1, h2, h3, [class*="title"], [class*="Title"]');
      var title = titleEl ? (titleEl.textContent || '').trim().substring(0, 200) : null;

      // Buttons (visible, with non-empty text)
      var btns = n.querySelectorAll('button, [role="button"]');
      var buttons = [];
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (!b.offsetParent) continue;
        var label = (b.textContent || b.getAttribute('aria-label') || '').trim();
        if (!label || label.length > 100) continue;
        var br = b.getBoundingClientRect();
        buttons.push({
          label: label,
          aria_label: b.getAttribute('aria-label') || null,
          data_name: b.getAttribute('data-name') || null,
          disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
          x: br.x + br.width / 2,
          y: br.y + br.height / 2
        });
      }

      // Checkboxes
      var cbs = n.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
      var checkboxes = [];
      for (var j = 0; j < cbs.length; j++) {
        var cb = cbs[j];
        if (!cb.offsetParent) continue;
        var lbl = '';
        if (cb.id) {
          var lab = n.querySelector('label[for="' + cb.id + '"]');
          if (lab) lbl = (lab.textContent || '').trim();
        }
        if (!lbl) {
          var pl = cb.closest('label');
          if (pl) lbl = (pl.textContent || '').trim();
        }
        if (!lbl) lbl = cb.getAttribute('aria-label') || '';
        var checked = cb.tagName === 'INPUT' ? !!cb.checked : cb.getAttribute('aria-checked') === 'true';
        checkboxes.push({ label: lbl.substring(0, 100), checked: checked });
      }

      // Text inputs
      var ins = n.querySelectorAll('input[type="text"], input:not([type]), textarea, input[type="search"], input[type="number"]');
      var inputs = [];
      for (var k = 0; k < ins.length; k++) {
        var ip = ins[k];
        if (!ip.offsetParent) continue;
        inputs.push({
          name: ip.getAttribute('name') || ip.getAttribute('aria-label') || ip.placeholder || '',
          value: (ip.value || '').substring(0, 200),
          placeholder: ip.placeholder || null
        });
      }

      return {
        found: true,
        title: title,
        role: n.getAttribute('role') || null,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        buttons: buttons,
        checkboxes: checkboxes,
        inputs: inputs
      };
    })()
  `);

  if (!info || !info.found) return { success: true, found: false };

  // Add intent_guess to buttons (computed in Node side, not in browser)
  for (const b of info.buttons) {
    b.intent_guess = buildIntentGuess(b.label);
  }

  return {
    success: true,
    found: true,
    title: info.title,
    role: info.role,
    rect: info.rect,
    buttons: info.buttons,
    checkboxes: info.checkboxes,
    inputs: info.inputs,
  };
}

export async function clickButton({ intent, label }) {
  if (!intent && !label) {
    throw new Error('Either intent or label must be provided');
  }
  if (intent && !VALID_INTENTS.includes(intent)) {
    throw new Error(`Invalid intent "${intent}". Valid: ${VALID_INTENTS.join(', ')}`);
  }

  const info = await describe();
  if (!info.found) {
    throw new Error('No active dialog found');
  }

  let target = null;
  let matchedBy = null;

  if (label) {
    const wanted = label.trim().toLowerCase();
    target = info.buttons.find(b => b.label.toLowerCase() === wanted)
      || info.buttons.find(b => b.label.toLowerCase().includes(wanted));
    matchedBy = `label="${label}"`;
  } else {
    const candidates = INTENT_LABELS[intent];
    for (const cand of candidates) {
      const lc = cand.toLowerCase();
      target = info.buttons.find(b => !b.disabled && b.label.toLowerCase() === lc);
      if (target) { matchedBy = `intent="${intent}" → "${cand}"`; break; }
    }
    if (!target) {
      // Substring fallback for intent
      for (const cand of candidates) {
        const lc = cand.toLowerCase();
        target = info.buttons.find(b => !b.disabled && b.label.toLowerCase().includes(lc));
        if (target) { matchedBy = `intent="${intent}" ~ "${cand}"`; break; }
      }
    }
  }

  if (!target) {
    const available = info.buttons.map(b => b.label).join(', ');
    throw new Error(
      `No button matched ${label ? `label="${label}"` : `intent="${intent}"`}. Available: [${available}]`
    );
  }
  if (target.disabled) {
    throw new Error(`Button "${target.label}" is disabled`);
  }

  // Click via DOM (more reliable for dialogs which often have focus traps)
  await evaluate(`
    (function() {
      var found = ${FIND_DIALOG_JS};
      if (!found) return false;
      var btns = found.node.querySelectorAll('button, [role="button"]');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (!b.offsetParent) continue;
        var l = (b.textContent || b.getAttribute('aria-label') || '').trim();
        if (l === ${JSON.stringify(target.label)}) { b.click(); return true; }
      }
      return false;
    })()
  `);

  return {
    success: true,
    clicked: target.label,
    matched_by: matchedBy,
    dialog_title: info.title,
  };
}

/**
 * Convenience: dismiss any dialog matching a list of intents (useful for
 * "save changes?" pop-ups that appear unexpectedly during automation).
 * Returns { dismissed: false } if no dialog present (not an error).
 */
export async function dismissIfPresent({ intents } = {}) {
  const intentList = Array.isArray(intents) && intents.length > 0
    ? intents
    : ['discard', 'cancel'];
  const info = await describe();
  if (!info.found) return { success: true, dismissed: false };

  for (const intent of intentList) {
    if (!VALID_INTENTS.includes(intent)) continue;
    try {
      const res = await clickButton({ intent });
      return { success: true, dismissed: true, ...res };
    } catch {
      // Try next intent
    }
  }
  return {
    success: true,
    dismissed: false,
    reason: `Dialog "${info.title || 'untitled'}" had no button matching intents [${intentList.join(', ')}]`,
    available_buttons: info.buttons.map(b => b.label),
  };
}
