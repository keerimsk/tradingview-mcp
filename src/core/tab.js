/**
 * Core tab management logic.
 * Controls TradingView Desktop tabs via CDP and Electron keyboard shortcuts.
 *
 * Multi-tab note: TradingView Desktop is a single Electron window with multiple
 * tabs. Each tab is its own CDP page target. The MCP server binds the global
 * CDP client to one specific target id, so simply calling /json/activate to
 * bring a tab to the foreground is NOT enough — the client must also be
 * rebound, otherwise subsequent evaluate() / Input dispatch calls go to the
 * old tab's renderer. switchTab/newTab/closeTab below handle that rebinding.
 */
import { getClient, setActiveTarget, getActiveTargetId } from '../connection.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const CDP_HOST = 'localhost';
const CDP_PORT = 9222;

/**
 * Send Ctrl+T to the TradingView Desktop window at OS level — bypasses
 * Electron's CDP renderer-level event interception. Platform-specific:
 *   - Windows: PowerShell SendKeys after AppActivate
 *   - macOS:   osascript activate + System Events keystroke
 *   - Linux:   xdotool windowactivate + key
 *
 * Best-effort — silently no-ops if the platform tool isn't available.
 * Returns metadata so the caller can decide whether to also poll for the
 * resulting new tab via waitForNew().
 */
/**
 * Run a PowerShell script, encoded as Base64 with -EncodedCommand to dodge
 * Windows command-line quoting hell. Returns trimmed stdout.
 */
async function runPowerShell(script, timeoutMs = 5000) {
  const utf16 = Buffer.from(script, 'utf16le');
  const b64 = utf16.toString('base64');
  const { stdout, stderr } = await execAsync(
    `powershell -NoProfile -EncodedCommand ${b64}`,
    { timeout: timeoutMs },
  );
  return { stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
}

/**
 * Atomic OS-level new-tab + optional symbol keystroke. The full sequence
 * (AppActivate → Ctrl+T → wait → optional Ctrl+K + type + Enter) runs in a
 * single PowerShell/osascript/xdotool invocation so Node-side timing can't
 * lose focus between steps.
 */
export async function sendNewTabKeystroke({ symbol } = {}) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      // Auto-create-layout flow:
      //   Ctrl+T  → landing page ("Supercharts")
      //   Click   → "Create new layout" tile (top-left of landing, ~190,185)
      //   SendKeys → unique name + Enter (dialog text input is auto-focused)
      //   → TV creates a new chart tab in /json/list (caller waitForNew binds)
      const layoutName = symbol
        ? `MCP-Auto-${Date.now()}`
        : null;
      const layoutBlock = layoutName
        ? `
# Wait for landing page to render
Start-Sleep -Milliseconds 1800
$null = [Win32]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 200

# Get TV window rect via UI Automation (more reliable than GetWindowRect
# in PInvoke struct marshaling).
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$el = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$br = $el.Current.BoundingRectangle
$winLeft = [int]$br.X
$winTop = [int]$br.Y
$winW = [int]$br.Width
$winH = [int]$br.Height

# 1) Click "Create new layout" tile — top-left of landing.
# Using ratios for size-independence: (0.165, 0.20) from window top-left.
$tileX = $winLeft + [int]($winW * 0.165)
$tileY = $winTop + [int]($winH * 0.20)
$null = [Win32]::SetCursorPos($tileX, $tileY)
Start-Sleep -Milliseconds 250
[Win32]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[Win32]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)

# 2) Wait for "Create new layout" dialog (text input auto-focused), type name
Start-Sleep -Milliseconds 1200
[System.Windows.Forms.SendKeys]::SendWait('${layoutName}')
Start-Sleep -Milliseconds 500

# 3) Click "Create" button. Empirically measured at (winW*0.647, winH*0.582)
# from window top-left. Tab+Space and Enter do NOT submit the dialog.
$createX = $winLeft + [int]($winW * 0.647)
$createY = $winTop + [int]($winH * 0.582)
$null = [Win32]::SetCursorPos($createX, $createY)
Start-Sleep -Milliseconds 250
[Win32]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[Win32]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)`
        : '';
      // CRITICAL: AppActivate alone does NOT restore minimized windows. We
      // need ShowWindow(SW_RESTORE=9) + SetForegroundWindow + GetWindowRect
      // for accurate window coords. mouse_event for absolute mouse clicks.
      const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
}
"@
$proc = Get-Process | Where-Object { $_.Name -eq 'TradingView' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output 'no_tradingview_process'; exit 1 }
$h = $proc.MainWindowHandle
if ([Win32]::IsIconic($h)) { $null = [Win32]::ShowWindow($h, 9) }
$null = [Win32]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 500
[System.Windows.Forms.SendKeys]::SendWait('^t')${layoutBlock}
Write-Output 'sent'
${layoutName ? `Write-Output 'layout=${layoutName}'` : ''}
`.trim();
      const r = await runPowerShell(script, 15000);
      return {
        platform,
        sent: r.stdout.includes('sent'),
        output: r.stdout,
        stderr: r.stderr,
        layout_name: layoutName,
      };
    }
    if (platform === 'darwin') {
      const symbolBlock = symbol
        ? `
delay 1.5
tell application "TradingView" to activate
delay 0.2
tell application "System Events" to keystroke "k" using command down
delay 0.7
tell application "System Events" to keystroke "${symbol.replace(/"/g, '\\"')}"
delay 0.6
tell application "System Events" to key code 36`
        : '';
      const osa = `tell application "TradingView" to activate
delay 0.3
tell application "System Events" to keystroke "t" using command down${symbolBlock}`;
      await execAsync(`osascript -e '${osa.replace(/'/g, `'\\''`)}'`, { timeout: 12000 });
      return { platform, sent: true };
    }
    if (platform === 'linux') {
      const safeSym = symbol ? String(symbol).replace(/"/g, '\\"') : null;
      const tail = safeSym
        ? ` && sleep 1.5 && xdotool search --name "TradingView" windowactivate --sync key ctrl+k && sleep 0.7 && xdotool type "${safeSym}" && sleep 0.6 && xdotool key Return`
        : '';
      await execAsync(
        `xdotool search --name "TradingView" windowactivate --sync key ctrl+t${tail}`,
        { timeout: 12000 },
      );
      return { platform, sent: true };
    }
    return { platform, sent: false, error: `Unsupported platform: ${platform}` };
  } catch (err) {
    return { platform, sent: false, error: err.message };
  }
}

async function fetchTargets() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  return resp.json();
}

function shapeTabs(targets, boundId) {
  return targets
    .filter(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
    .map((t, i) => ({
      index: i,
      id: t.id,
      title: t.title.replace(/^Live stock.*charts on /, ''),
      url: t.url,
      chart_id: t.url.match(/\/chart\/([^/?]+)/)?.[1] || null,
      is_bound: boundId != null && t.id === boundId,
    }));
}

/**
 * List all open chart tabs (CDP page targets). Each entry includes is_bound,
 * marking which tab the MCP CDP client is currently driving.
 */
export async function list() {
  const targets = await fetchTargets();
  const tabs = shapeTabs(targets, getActiveTargetId());
  return { success: true, tab_count: tabs.length, bound_target_id: getActiveTargetId(), tabs };
}

/**
 * Open a new chart tab in TradingView Desktop and bind the MCP CDP client to it.
 *
 * Strategy (in order):
 *   1. CDP Target.createTarget — works in some Electron builds; preferred.
 *   2. OS-level Ctrl+T keystroke — Windows PowerShell SendKeys, macOS
 *      osascript, Linux xdotool. Bypasses Electron's renderer-level CDP
 *      interception by sending the event to the OS, which the native menu
 *      accelerator picks up. **Caveat:** the resulting tab opens TV's
 *      "New tab" landing page (file:// URL, no webSocketDebuggerUrl). It's
 *      not directly CDP-accessible until the user picks a symbol — pass
 *      `auto_navigate_to: 'BINANCE:AVAXUSDT.P'` to also send the symbol via
 *      keystrokes after Ctrl+T, which navigates the landing page to a
 *      regular chart URL we can bind to.
 *
 * @param {Object}  opts
 * @param {boolean} opts.auto_keystroke      Default true — try OS keystroke if CDP fails.
 * @param {string}  opts.auto_navigate_to    Optional symbol to type after Ctrl+T.
 * @param {number}  opts.timeout_ms          How long to wait for the new tab (default 15000).
 */
export async function newTab({ auto_keystroke = true, auto_navigate_to, timeout_ms = 15000 } = {}) {
  const c = await getClient();
  const beforeIds = new Set(
    (await fetchTargets()).filter(t => t.type === 'page').map(t => t.id),
  );

  // Strategy 1: CDP Target.createTarget
  try {
    const r = await c.Target.createTarget({ url: 'https://www.tradingview.com/chart/' });
    await new Promise(rs => setTimeout(rs, 1500));
    if (r?.targetId) {
      try {
        const bound = await setActiveTarget(r.targetId);
        const tabs = shapeTabs(await fetchTargets(), getActiveTargetId());
        return {
          success: true,
          action: 'new_tab_opened_via_cdp',
          new_tab_id: r.targetId,
          bound,
          tab_count: tabs.length,
          tabs,
        };
      } catch (bindErr) {
        return {
          success: false,
          error: `Tab created (id=${r.targetId}) but rebind failed: ${bindErr.message}.`,
        };
      }
    }
  } catch {
    // Fall through to keystroke strategy
  }

  // Strategy 2: OS-level keystroke. When a symbol is provided we extend the
  // sequence to: Ctrl+T → mouse-click "Create new layout" tile on the
  // landing page → type a unique layout name → Enter. TV then creates a
  // real chart tab (bindable) with a default symbol; we set the requested
  // symbol via CDP afterwards.
  if (!auto_keystroke) {
    return {
      success: false,
      error:
        'CDP Target.createTarget blocked and auto_keystroke disabled. ' +
        'Enable auto_keystroke or open the tab manually (Ctrl+T) then call tab_wait_for_new.',
    };
  }

  const keystroke = await sendNewTabKeystroke({ symbol: auto_navigate_to });
  if (!keystroke.sent) {
    return {
      success: false,
      error: `OS keystroke failed: ${keystroke.error || keystroke.output || 'unknown'}. Press Ctrl+T manually, then call tab_wait_for_new.`,
      keystroke,
    };
  }

  // After the keystroke sequence, expect either:
  //  - A new tradingview.com/chart tab (when symbol was given → layout was created)
  //  - A file:// landing page (when no symbol → just Ctrl+T)
  const expectChart = !!auto_navigate_to;
  const detected = await waitForNew({
    timeout_ms: Math.max(timeout_ms, expectChart ? 20000 : 10000),
    expect_chart_url: expectChart,
    before_ids: beforeIds,
  });

  // If a chart tab appeared and a symbol was requested, set it via CDP
  // (the new tab opens with TV's default symbol; we need to override).
  if (detected.success && expectChart) {
    try {
      await new Promise(r => setTimeout(r, 1500));  // chart settle
      const chart = await import('./chart.js');
      await chart.setSymbol({ symbol: auto_navigate_to });
    } catch (e) {
      detected.symbol_set_warning = e.message;
    }
  }

  return {
    success: detected.success,
    action: expectChart ? 'new_tab_opened_with_layout' : 'new_tab_opened_via_keystroke',
    symbol: auto_navigate_to || null,
    layout_name: keystroke.layout_name || null,
    keystroke,
    ...detected,
  };
}

/**
 * Send a symbol search string + Enter via OS-level keystrokes to type into
 * the focused symbol search input (e.g., on TV's new-tab landing page).
 */
/**
 * Type a symbol via TV's universal search (Ctrl+K). Re-activates TV first
 * since the previous PowerShell call may have stolen focus.
 *
 * Flow: AppActivate TV → Ctrl+K (open search) → type symbol → Enter.
 */
async function sendSymbolKeystroke(symbol) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      // SendKeys reserves ^ + % ~ and {} for modifiers; the symbol text
      // (e.g. BINANCE:AVAXUSDT.P) contains none of those so direct send is OK.
      const safeSym = String(symbol).replace(/'/g, "''");
      const script = `
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
$proc = Get-Process | Where-Object { $_.Name -eq 'TradingView' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output 'no_tradingview_process'; exit 1 }
[Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id)
Start-Sleep -Milliseconds 250
# Open TV's universal symbol search (Ctrl+K) — works on any tab state
[System.Windows.Forms.SendKeys]::SendWait('^k')
Start-Sleep -Milliseconds 600
[System.Windows.Forms.SendKeys]::SendWait('${safeSym}')
Start-Sleep -Milliseconds 400
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Write-Output 'sent'
`.trim();
      const r = await runPowerShell(script, 7000);
      return { platform, sent: r.stdout.includes('sent'), output: r.stdout };
    }
    if (platform === 'darwin') {
      const osa = `tell application "TradingView" to activate
delay 0.25
tell application "System Events"
keystroke "k" using command down
delay 0.6
keystroke "${symbol.replace(/"/g, '\\"')}"
delay 0.4
key code 36
end tell`;
      await execAsync(`osascript -e '${osa.replace(/'/g, `'\\''`)}'`, { timeout: 8000 });
      return { platform, sent: true };
    }
    if (platform === 'linux') {
      const safeSym = String(symbol).replace(/"/g, '\\"');
      await execAsync(
        `xdotool search --name "TradingView" windowactivate --sync key ctrl+k && ` +
          `sleep 0.6 && xdotool type "${safeSym}" && sleep 0.4 && xdotool key Return`,
        { timeout: 8000 },
      );
      return { platform, sent: true };
    }
    return { platform, sent: false, error: `Unsupported platform: ${platform}` };
  } catch (err) {
    return { platform, sent: false, error: err.message };
  }
}

/**
 * Poll /json/list waiting for a new TradingView tab to appear. Detects both:
 *   - Chart pages (https://www.tradingview.com/chart/...)
 *   - TV Desktop "New tab" landing pages (file:///.../TradingView.Desktop.../...)
 *
 * Use after manually pressing Ctrl+T (or after tab_new fires the OS keystroke).
 *
 * The landing-page case has a wrinkle: file:// targets do NOT have a
 * webSocketDebuggerUrl, so CDP cannot connect to them — they're "visible but
 * unreachable" from the MCP server. If `expect_chart_url:true` (default), we
 * keep waiting until the new tab navigates to a tradingview.com/chart URL,
 * then bind. Set `expect_chart_url:false` to return as soon as the landing
 * page is detected (informational only — bind will be skipped).
 *
 * @param {Object} opts
 * @param {number}  opts.timeout_ms        max wait (default 30000)
 * @param {number}  opts.poll_interval_ms  polling cadence (default 500)
 * @param {boolean} opts.expect_chart_url  require URL to become a chart (default true)
 * @param {Set}     opts.before_ids        optional baseline of target ids to ignore
 */
export async function waitForNew({
  timeout_ms = 30000,
  poll_interval_ms = 500,
  expect_chart_url = true,
  before_ids,
} = {}) {
  const beforeTargets = await fetchTargets();
  const beforeIdSet = before_ids
    ? before_ids
    : new Set(beforeTargets.filter(t => t.type === 'page').map(t => t.id));

  const startedAt = Date.now();
  const deadline = startedAt + Math.max(1000, Math.min(timeout_ms, 600000));
  const interval = Math.max(100, Math.min(poll_interval_ms, 5000));

  // Track the new target ID even if it starts as a landing page so we can
  // detect when it navigates to a chart URL.
  let landingTargetId = null;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    const targets = await fetchTargets();

    // First-pass: any new target on a chart URL (preferred outcome — bindable)
    const newChart = targets.find(
      t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url) && !beforeIdSet.has(t.id),
    );
    if (newChart) {
      try {
        const bound = await setActiveTarget(newChart.id);
        const tabs = shapeTabs(targets, getActiveTargetId());
        return {
          success: true,
          action: 'new_tab_detected',
          new_tab_id: newChart.id,
          chart_id: newChart.url.match(/\/chart\/([^/?]+)/)?.[1] || null,
          bound,
          tab_count: tabs.length,
          waited_ms: Date.now() - startedAt,
        };
      } catch (err) {
        return {
          success: false,
          error: `New chart tab detected (id=${newChart.id}) but rebind failed: ${err.message}`,
          new_tab_id: newChart.id,
        };
      }
    }

    // Second-pass: a TV Desktop landing page ("New tab")
    const isTvLanding = (t) =>
      t.type === 'page'
      && !beforeIdSet.has(t.id)
      && (
        /TradingView\.Desktop/i.test(t.url + ' ' + (t.title || ''))
        || (t.title === 'New tab' && /^file:/i.test(t.url || ''))
      );
    const landing = targets.find(isTvLanding);
    if (landing) {
      landingTargetId = landing.id;
      if (!expect_chart_url) {
        return {
          success: true,
          action: 'landing_page_detected',
          new_tab_id: landing.id,
          url: landing.url,
          note: 'TV "New tab" landing page detected. file:// targets are not CDP-bindable; navigate it (e.g., type a symbol) to get a chart URL.',
          waited_ms: Date.now() - startedAt,
        };
      }
      // Continue polling — landing page exists, waiting for it to navigate
    }
  }

  if (landingTargetId) {
    return {
      success: false,
      error:
        `Landing page detected (id=${landingTargetId}) but never navigated to a chart URL within ${timeout_ms}ms. ` +
        'Pick a symbol in the new tab to make it bindable, or pass expect_chart_url:false to accept the landing page itself.',
      landing_target_id: landingTargetId,
      waited_ms: timeout_ms,
    };
  }
  return {
    success: false,
    error: `Timed out after ${timeout_ms}ms — no new TradingView tab appeared. Did Ctrl+T fire?`,
    waited_ms: timeout_ms,
  };
}

/**
 * Close the current tab via keyboard shortcut (Ctrl+W / Cmd+W). If the bound
 * tab no longer exists, rebind to whichever tab remains visible.
 */
export async function closeTab() {
  const before = await list();
  if (before.tab_count <= 1) {
    throw new Error('Cannot close the last tab. Use tv_launch to restart TradingView instead.');
  }

  const c = await getClient();
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 4 : 2;

  await c.Input.dispatchKeyEvent({
    type: 'keyDown',
    modifiers: mod,
    key: 'w',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
  });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'w', code: 'KeyW' });

  await new Promise(r => setTimeout(r, 1000));

  const afterTargets = await fetchTargets();
  const tabs = shapeTabs(afterTargets, getActiveTargetId());
  const previousId = getActiveTargetId();
  const stillThere = afterTargets.some(t => t.type === 'page' && t.id === previousId);

  let rebound = null;
  if (!stillThere && tabs.length > 0) {
    try {
      // Activate the first remaining tab visually + rebind
      await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/activate/${tabs[0].id}`);
      await new Promise(r => setTimeout(r, 150));
      rebound = await setActiveTarget(tabs[0].id);
    } catch (err) {
      rebound = { error: err.message };
    }
  }

  return {
    success: true,
    action: 'tab_closed',
    tabs_before: before.tab_count,
    tabs_after: tabs.length,
    rebound_to: rebound,
  };
}

/**
 * Switch to a tab by index. Brings it to the foreground via /json/activate
 * AND rebinds the global CDP client to its target, so subsequent tools
 * operate on the newly active tab.
 */
export async function switchTab({ index }) {
  const tabs = await list();
  const idx = Number(index);

  if (idx >= tabs.tab_count) {
    throw new Error(`Tab index ${idx} out of range (have ${tabs.tab_count} tabs)`);
  }

  const target = tabs.tabs[idx];

  // Visual switch — bring tab to front
  try {
    await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/activate/${target.id}`);
  } catch (e) {
    throw new Error(`Failed to activate tab ${idx}: ${e.message}`);
  }

  // Let activation settle, then rebind the CDP client
  await new Promise(r => setTimeout(r, 150));
  const bound = await setActiveTarget(target.id);

  return {
    success: true,
    action: 'switched',
    index: idx,
    tab_id: target.id,
    chart_id: target.chart_id,
    bound,
  };
}

/**
 * Return information about the tab the MCP CDP client is currently bound to,
 * including its index in the list.
 */
export async function getActive() {
  const boundId = getActiveTargetId();
  if (!boundId) {
    return { success: true, bound: false, message: 'No active CDP client (call tab_list or any chart tool to initialize)' };
  }
  const targets = await fetchTargets();
  const tabs = shapeTabs(targets, boundId);
  const active = tabs.find(t => t.is_bound);
  return {
    success: true,
    bound: true,
    bound_target_id: boundId,
    tab: active || null,
  };
}
