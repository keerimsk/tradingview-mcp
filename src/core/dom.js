/**
 * DOM (Depth of Market) panel reader.
 *
 * Reads the bid/ask ladder from TradingView's DOM widget. Pre-condition: the
 * DOM panel must be open in TV — it's a Premium/Ultimate broker-bound widget
 * that only appears when:
 *   1. A live broker (TradeStation, IBKR, AMP, OANDA, etc.) is connected, AND
 *   2. The bottom-left "Trade" button is set to DOM mode (not Order Panel)
 *
 * If the panel isn't visible, returns { success: false, panel_open: false }
 * with guidance — never throws.
 *
 * DOM structure (discovered live):
 *   [class*="tv-dom-panel"]                       — panel root
 *   [class*="tv-dom-widget-main__row"]            — each price level
 *     [class*="tv-dom-widget-main__value"]        — a cell
 *       --buy             — bid size cell
 *       --sell            — ask size cell
 *       --price           — price cell
 *       --header          — header row marker
 *       --orders-buy / --orders-sell — user's resting orders
 *       --highlighted     — current trade price / spread highlight
 *
 * Each row contains duplicated cells (icon + label spans), so we dedupe by
 * type when extracting.
 */
import { evaluate } from '../connection.js';

export async function read({ depth = 20 } = {}) {
  const max = Math.max(1, Math.min(Math.floor(Number(depth) || 20), 100));

  const data = await evaluate(`
    (function() {
      var panel = document.querySelector('[class*="tv-dom-panel"]');
      if (!panel || !panel.offsetParent) {
        return { panel_open: false };
      }

      // Find the active symbol if the panel exposes it
      var symbolEl = panel.querySelector('[class*="symbol"], [data-name*="symbol"]');
      var symbolText = symbolEl ? (symbolEl.textContent || '').trim() : null;

      // Pull rows
      var rowEls = panel.querySelectorAll('[class*="tv-dom-widget-main__row"]');
      var rows = [];
      for (var i = 0; i < rowEls.length; i++) {
        var rowEl = rowEls[i];
        var cells = rowEl.querySelectorAll('[class*="tv-dom-widget-main__value"]');

        var isHeader = false;
        var bidSize = null;
        var askSize = null;
        var price = null;
        var userBuyOrders = [];
        var userSellOrders = [];
        var highlighted = false;

        for (var j = 0; j < cells.length; j++) {
          var cell = cells[j];
          var cls = cell.getAttribute('class') || '';
          var text = (cell.textContent || '').trim();
          if (!text) continue;

          var hasBuy = /--buy(?!ton)/.test(cls);
          var hasSell = /--sell/.test(cls);
          var hasPrice = /--price/.test(cls);
          var hasHeader = /--header/.test(cls);
          var hasOrdersBuy = /--orders-buy/.test(cls);
          var hasOrdersSell = /--orders-sell/.test(cls);
          var hasHighlighted = /--highlighted/.test(cls);
          var hasMeter = /__meter/.test(cls);

          if (hasHeader) { isHeader = true; continue; }
          if (hasMeter) continue;  // skip visual meter bars
          if (hasHighlighted) highlighted = true;

          // TV's --orders-* cells display "Limit" as a placeholder for "click
          // here to place an order" — only count as a real user order if the
          // text includes a quantity (digit) or extra detail.
          if (hasOrdersBuy && /\\d/.test(text)) { userBuyOrders.push(text); continue; }
          if (hasOrdersSell && /\\d/.test(text)) { userSellOrders.push(text); continue; }
          if (hasOrdersBuy || hasOrdersSell) continue;  // placeholder, skip

          // Dedupe: take the first occurrence per category in this row
          if (hasPrice && price === null) {
            // Strip commas, parse number
            var p = parseFloat(text.replace(/,/g, ''));
            if (!isNaN(p)) price = p;
            else price = text;  // keep raw if not numeric
          } else if (hasSell && askSize === null) {
            // ask side (sell limit orders at this price)
            var a = parseFloat(text.replace(/,/g, ''));
            askSize = isNaN(a) ? text : a;
          } else if (hasBuy && bidSize === null) {
            // bid side (buy limit orders at this price)
            var b = parseFloat(text.replace(/,/g, ''));
            bidSize = isNaN(b) ? text : b;
          }
        }

        if (isHeader) continue;

        // Only emit rows that have a price + at least one size
        if (price !== null && (bidSize !== null || askSize !== null)) {
          rows.push({
            price: price,
            bid_size: bidSize,
            ask_size: askSize,
            highlighted: highlighted || undefined,
            user_buy_orders: userBuyOrders.length ? userBuyOrders : undefined,
            user_sell_orders: userSellOrders.length ? userSellOrders : undefined,
          });
        }
      }

      return {
        panel_open: true,
        symbol: symbolText,
        row_count: rows.length,
        rows: rows,
      };
    })()
  `);

  if (!data?.panel_open) {
    return {
      success: false,
      panel_open: false,
      error:
        'DOM panel not visible. Open it manually: connect a broker (Paper Trading does NOT support DOM), ' +
        'click the bottom-left "Trade" button, and select DOM mode (not Order Panel). ' +
        'DOM requires a Premium/Ultimate TradingView plan with a real broker bridge ' +
        '(TradeStation, IBKR, AMP, OANDA, etc.).',
    };
  }

  const allRows = data.rows;

  // Split into bids (have bid_size, no ask_size) and asks (have ask_size).
  // Mixed rows (both — when crossed quote or at touch) go into both.
  const asks = [];
  const bids = [];
  for (const r of allRows) {
    if (r.ask_size !== null && r.ask_size !== undefined) {
      asks.push({
        price: r.price,
        size: r.ask_size,
        user_orders: r.user_sell_orders,
      });
    }
    if (r.bid_size !== null && r.bid_size !== undefined) {
      bids.push({
        price: r.price,
        size: r.bid_size,
        user_orders: r.user_buy_orders,
      });
    }
  }

  // Asks ascending by price (best ask first = lowest), bids descending
  // (best bid first = highest).
  asks.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
  bids.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));

  const askTrim = asks.slice(0, max);
  const bidTrim = bids.slice(0, max);

  // Touch + spread
  const best_ask = askTrim[0]?.price ?? null;
  const best_bid = bidTrim[0]?.price ?? null;
  const spread =
    typeof best_ask === 'number' && typeof best_bid === 'number'
      ? best_ask - best_bid
      : null;

  // Sum sizes
  const sumSize = (arr) =>
    arr.reduce((s, r) => s + (typeof r.size === 'number' ? r.size : 0), 0);

  return {
    success: true,
    panel_open: true,
    symbol: data.symbol,
    rows_in_panel: data.row_count,
    depth_returned: { asks: askTrim.length, bids: bidTrim.length },
    best_bid,
    best_ask,
    spread,
    total_bid_size: sumSize(bidTrim),
    total_ask_size: sumSize(askTrim),
    asks: askTrim,
    bids: bidTrim,
  };
}
