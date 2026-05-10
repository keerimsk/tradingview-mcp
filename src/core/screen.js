/**
 * Annotated screenshot helpers — overlay a coordinate grid and bounding boxes
 * for clickable elements onto the page, capture, then remove the overlay.
 *
 * Designed for vision-based UI workflows where the model needs help estimating
 * pixel coordinates of UI controls.
 */
import { getClient, evaluate } from '../connection.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(dirname(dirname(__dirname)), 'screenshots');

const CLICKABLE_SELECTOR =
  'button, a, [role="button"], [role="checkbox"], [role="tab"], [role="menuitem"], [role="switch"], input, select, textarea';

/**
 * Inject an SVG overlay into the page (grid + clickable bounding boxes),
 * capture a PNG via CDP, then remove the overlay.
 *
 * @param {Object} opts
 * @param {boolean} opts.grid               Draw 100px coordinate grid (default true)
 * @param {number}  opts.grid_step          Grid step in CSS px (default 100)
 * @param {boolean} opts.boxes              Draw bounding boxes for clickable elements (default true)
 * @param {number}  opts.max_boxes          Cap to avoid clutter (default 80)
 * @param {boolean} opts.labels             Label boxes with their data-name/aria-label (default true)
 * @param {boolean} opts.return_inline      Return PNG as MCP image content (default true)
 * @param {string}  opts.filename           If set (or return_inline=false), also write to disk
 */
export async function inspect({
  grid = true,
  grid_step = 100,
  boxes = true,
  max_boxes = 80,
  labels = true,
  return_inline = true,
  filename,
} = {}) {
  // Inject overlay
  const elementCount = await evaluate(`
    (function() {
      // Remove any leftover overlay from a previous call
      var prev = document.getElementById('__tvmcp_overlay__');
      if (prev) prev.remove();

      var ns = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(ns, 'svg');
      svg.id = '__tvmcp_overlay__';
      svg.setAttribute('width', window.innerWidth);
      svg.setAttribute('height', window.innerHeight);
      svg.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;';

      // Grid
      if (${JSON.stringify(grid)}) {
        var step = ${Number(grid_step) || 100};
        var w = window.innerWidth, h = window.innerHeight;
        for (var x = 0; x <= w; x += step) {
          var line = document.createElementNS(ns, 'line');
          line.setAttribute('x1', x); line.setAttribute('x2', x);
          line.setAttribute('y1', 0); line.setAttribute('y2', h);
          line.setAttribute('stroke', 'rgba(0, 200, 255, 0.25)');
          line.setAttribute('stroke-width', '1');
          svg.appendChild(line);
          if (x > 0) {
            var lbl = document.createElementNS(ns, 'text');
            lbl.setAttribute('x', x + 2); lbl.setAttribute('y', 12);
            lbl.setAttribute('fill', 'rgba(0, 200, 255, 0.9)');
            lbl.setAttribute('font-family', 'monospace');
            lbl.setAttribute('font-size', '10');
            lbl.textContent = String(x);
            svg.appendChild(lbl);
          }
        }
        for (var y = 0; y <= h; y += step) {
          var line2 = document.createElementNS(ns, 'line');
          line2.setAttribute('x1', 0); line2.setAttribute('x2', w);
          line2.setAttribute('y1', y); line2.setAttribute('y2', y);
          line2.setAttribute('stroke', 'rgba(0, 200, 255, 0.25)');
          line2.setAttribute('stroke-width', '1');
          svg.appendChild(line2);
          if (y > 0) {
            var lbl2 = document.createElementNS(ns, 'text');
            lbl2.setAttribute('x', 2); lbl2.setAttribute('y', y - 2);
            lbl2.setAttribute('fill', 'rgba(0, 200, 255, 0.9)');
            lbl2.setAttribute('font-family', 'monospace');
            lbl2.setAttribute('font-size', '10');
            lbl2.textContent = String(y);
            svg.appendChild(lbl2);
          }
        }
      }

      // Clickable bounding boxes
      var n = 0;
      if (${JSON.stringify(boxes)}) {
        var nodes = document.querySelectorAll(${JSON.stringify(CLICKABLE_SELECTOR)});
        var max = ${Number(max_boxes) || 80};
        for (var i = 0; i < nodes.length && n < max; i++) {
          var el = nodes[i];
          if (!el.offsetParent) continue;
          var r = el.getBoundingClientRect();
          if (r.width < 10 || r.height < 10) continue;
          if (r.x < 0 || r.y < 0 || r.x > window.innerWidth || r.y > window.innerHeight) continue;
          var rect = document.createElementNS(ns, 'rect');
          rect.setAttribute('x', r.x); rect.setAttribute('y', r.y);
          rect.setAttribute('width', r.width); rect.setAttribute('height', r.height);
          rect.setAttribute('fill', 'rgba(255, 200, 0, 0.08)');
          rect.setAttribute('stroke', 'rgba(255, 150, 0, 0.85)');
          rect.setAttribute('stroke-width', '1');
          svg.appendChild(rect);
          if (${JSON.stringify(labels)}) {
            var name = el.getAttribute('data-name') || el.getAttribute('aria-label')
              || (el.textContent || '').trim().substring(0, 24);
            if (name) {
              var t = document.createElementNS(ns, 'text');
              t.setAttribute('x', r.x + 2);
              t.setAttribute('y', r.y + 11);
              t.setAttribute('fill', 'rgba(255, 200, 0, 1)');
              t.setAttribute('font-family', 'monospace');
              t.setAttribute('font-size', '10');
              t.setAttribute('stroke', 'rgba(0, 0, 0, 0.6)');
              t.setAttribute('stroke-width', '0.4');
              t.textContent = name;
              svg.appendChild(t);
            }
          }
          n++;
        }
      }

      document.body.appendChild(svg);
      return n;
    })()
  `);

  // Capture
  const client = await getClient();
  const viewport = await evaluate(`
    ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 })
  `);
  const { data } = await client.Page.captureScreenshot({ format: 'png' });

  // Remove overlay
  await evaluate(`
    (function() { var n = document.getElementById('__tvmcp_overlay__'); if (n) n.remove(); })()
  `);

  const bytes = Buffer.from(data, 'base64').length;
  let filePath = null;
  if (!return_inline || filename) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fname = (filename || `tv_inspect_${ts}`).replace(/[\/\\]/g, '_');
    filePath = join(SCREENSHOT_DIR, `${fname}.png`);
    writeFileSync(filePath, Buffer.from(data, 'base64'));
  }

  const out = {
    success: true,
    annotated_elements: elementCount,
    grid_step: grid ? grid_step : null,
    viewport,
    size_bytes: bytes,
  };
  if (filePath) out.file_path = filePath;
  if (return_inline) out._inline_image = { mimeType: 'image/png', data };
  return out;
}
