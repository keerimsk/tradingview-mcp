/**
 * Classic TradingView Screener — REST wrapper.
 *
 * Hits scanner.tradingview.com via in-page fetch (credentials:'include' so the
 * page's session cookies authenticate the request). Pattern mirrors pine.js's
 * pine-facade.tradingview.com calls and alerts.js's pricealerts.tradingview.com
 * calls — proven safe for the TV ecosystem.
 *
 * Constraint: this module does NOT touch chart indicators (chart_manage_indicator
 * is never called from here). Screener is a separate read-only surface.
 */
import { evaluateAsync, safeString } from '../connection.js';

const ENDPOINT_BASE = 'https://scanner.tradingview.com';

// Default columns when caller passes none — broad mix of identity, price,
// fundamentals, and technicals so a single call gives a useful screen.
export const DEFAULT_COLUMNS = [
  'name',
  'close',
  'change',
  'volume',
  'market_cap_basic',
  'sector',
  'RSI',
  'ATR',
  'price_earnings_ttm',
];

// Whitelisted operations supported by scanner.tradingview.com. Useful as a
// reference and to validate input before sending the request.
export const SCREENER_OPERATIONS = [
  { op: 'greater', desc: 'Field value > right (numeric)' },
  { op: 'egreater', desc: 'Field value >= right' },
  { op: 'less', desc: 'Field value < right' },
  { op: 'eless', desc: 'Field value <= right' },
  { op: 'equal', desc: 'Field value == right' },
  { op: 'nequal', desc: 'Field value != right' },
  { op: 'in_range', desc: 'right is [low, high]; field within inclusive range' },
  { op: 'not_in_range', desc: 'right is [low, high]; field outside range' },
  { op: 'crosses', desc: 'Field crosses right (any direction)' },
  { op: 'crosses_above', desc: 'Field crosses right from below' },
  { op: 'crosses_below', desc: 'Field crosses right from above' },
  { op: 'match', desc: 'Field matches right (string contains, e.g., sector="Technology Services")' },
  { op: 'nmatch', desc: 'Field does not match right' },
  { op: 'in_day_range', desc: "Today's range comparison" },
  { op: 'above%', desc: 'Field is X% above right' },
  { op: 'below%', desc: 'Field is X% below right' },
];

// Common columns reference. Not exhaustive — TV exposes hundreds; this is
// the practical subset most callers will use. Caller can request any column
// by name; TV returns null for unknown ones.
export const SCREENER_COLUMNS = [
  // Identity
  { name: 'name', desc: 'Ticker symbol' },
  { name: 'description', desc: 'Company name' },
  { name: 'logoid', desc: 'Logo identifier' },
  { name: 'type', desc: 'Asset type (stock, crypto, etc.)' },
  { name: 'subtype', desc: 'Asset subtype (common, etf, etc.)' },
  { name: 'exchange', desc: 'Exchange code' },

  // Price/volume
  { name: 'close', desc: 'Last price' },
  { name: 'open', desc: 'Open price' },
  { name: 'high', desc: 'High' },
  { name: 'low', desc: 'Low' },
  { name: 'change', desc: 'Daily change %' },
  { name: 'change_abs', desc: 'Daily change in absolute value' },
  { name: 'volume', desc: 'Daily volume' },
  { name: 'average_volume_10d_calc', desc: '10-day average volume' },
  { name: 'relative_volume_10d_calc', desc: 'Relative volume (today / 10d avg)' },
  { name: 'gap', desc: 'Gap % from yesterday close' },

  // Fundamentals (stocks)
  { name: 'market_cap_basic', desc: 'Market capitalization' },
  { name: 'price_earnings_ttm', desc: 'P/E ratio (trailing 12mo)' },
  { name: 'price_book_fq', desc: 'P/B ratio (latest quarter)' },
  { name: 'price_sales_current', desc: 'P/S ratio' },
  { name: 'dividend_yield_recent', desc: 'Dividend yield %' },
  { name: 'earnings_per_share_basic_ttm', desc: 'EPS (basic, TTM)' },
  { name: 'sector', desc: 'Sector classification' },
  { name: 'industry', desc: 'Industry classification' },
  { name: 'country', desc: 'Country' },
  { name: 'number_of_employees', desc: 'Employee count' },

  // Technicals
  { name: 'RSI', desc: 'Relative Strength Index (14)' },
  { name: 'RSI7', desc: 'RSI (7)' },
  { name: 'ATR', desc: 'Average True Range' },
  { name: 'ADX', desc: 'Average Directional Index' },
  { name: 'MACD.macd', desc: 'MACD line value' },
  { name: 'MACD.signal', desc: 'MACD signal line' },
  { name: 'BB.upper', desc: 'Bollinger Band upper' },
  { name: 'BB.lower', desc: 'Bollinger Band lower' },
  { name: 'EMA20', desc: '20-period EMA' },
  { name: 'EMA50', desc: '50-period EMA' },
  { name: 'EMA200', desc: '200-period EMA' },
  { name: 'SMA20', desc: '20-period SMA' },
  { name: 'SMA50', desc: '50-period SMA' },
  { name: 'SMA200', desc: '200-period SMA' },
  { name: 'Stoch.K', desc: 'Stochastic %K' },
  { name: 'Stoch.D', desc: 'Stochastic %D' },
  { name: 'Volatility.D', desc: 'Daily volatility' },
  { name: 'Volatility.W', desc: 'Weekly volatility' },
  { name: 'Volatility.M', desc: 'Monthly volatility' },
  { name: 'Recommend.All', desc: 'Aggregated technical recommendation (-1 to 1)' },
  { name: 'Recommend.MA', desc: 'Moving averages recommendation' },
  { name: 'Recommend.Other', desc: 'Oscillators recommendation' },

  // Performance
  { name: 'Perf.W', desc: 'Weekly performance %' },
  { name: 'Perf.1M', desc: 'Monthly performance %' },
  { name: 'Perf.3M', desc: '3-month performance %' },
  { name: 'Perf.6M', desc: '6-month performance %' },
  { name: 'Perf.Y', desc: '1-year performance %' },
  { name: 'Perf.YTD', desc: 'Year-to-date performance %' },
  { name: 'High.1M', desc: '1-month high' },
  { name: 'Low.1M', desc: '1-month low' },
  { name: 'High.3M', desc: '3-month high' },
  { name: 'Low.3M', desc: '3-month low' },
  { name: 'High.All', desc: 'All-time high' },
  { name: 'Low.All', desc: 'All-time low' },
];

const VALID_OP_NAMES = new Set(SCREENER_OPERATIONS.map(o => o.op));

const MAX_RANGE_SPAN = 500;
const DEFAULT_RANGE = [0, 50];

// TV's market name → /scan path segment. "global" works for most queries
// but specific markets are faster and have richer fundamental data.
const VALID_MARKETS = new Set([
  'america', 'crypto', 'forex', 'cfd',
  'india', 'uk', 'germany', 'japan', 'turkey', 'brazil', 'canada', 'australia',
  'france', 'spain', 'italy', 'china', 'hongkong', 'korea', 'mexico',
  'global',
]);

function validateFilters(filters) {
  if (!Array.isArray(filters)) return [];
  const out = [];
  for (const f of filters) {
    if (!f || typeof f !== 'object') continue;
    const left = String(f.field || f.left || '').trim();
    const op = String(f.operation || f.op || '').trim();
    if (!left || !op) continue;
    if (!VALID_OP_NAMES.has(op)) {
      throw new Error(
        `Unknown screener operation "${op}". Use screener_operations to list valid ops.`,
      );
    }
    // value can be number, string, array (for in_range), or boolean
    const right = f.value !== undefined ? f.value : f.right;
    out.push({ left, operation: op, right });
  }
  return out;
}

function clampRange(range) {
  let from = 0, to = DEFAULT_RANGE[1];
  if (Array.isArray(range) && range.length === 2) {
    from = Math.max(0, Math.floor(Number(range[0]) || 0));
    to = Math.max(from + 1, Math.floor(Number(range[1]) || 0));
  }
  if (to - from > MAX_RANGE_SPAN) {
    to = from + MAX_RANGE_SPAN;
  }
  return [from, to];
}

/**
 * Pure: assemble the scanner.tradingview.com POST payload + url.
 * Exposed so unit tests can validate request shape without mocking fetch.
 * Throws on invalid market or operation.
 */
export function buildScanRequest({
  market = 'america',
  filters = [],
  columns,
  sort,
  range,
  tickers,
  lang = 'en',
} = {}) {
  if (!VALID_MARKETS.has(market)) {
    throw new Error(`Unknown market "${market}". Examples: america, crypto, forex, india, uk, global`);
  }
  const cleanFilters = validateFilters(filters);
  const cols = Array.isArray(columns) && columns.length > 0 ? columns : DEFAULT_COLUMNS;
  const [from, to] = clampRange(range);
  const sortBy = sort?.by || sort?.sortBy || 'market_cap_basic';
  const sortOrder = (sort?.order || sort?.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  const payload = {
    filter: cleanFilters,
    options: { lang },
    markets: [market],
    symbols: { query: { types: [] }, tickers: Array.isArray(tickers) ? tickers : [] },
    columns: cols,
    sort: { sortBy, sortOrder },
    range: [from, to],
  };

  const url = `${ENDPOINT_BASE}/${market}/scan`;
  return { url, payload, range: [from, to], columns: cols };
}

/**
 * Run a screener scan. Posts to scanner.tradingview.com/{market}/scan.
 *
 * @param {Object} opts
 * @param {string} opts.market           e.g. "america", "crypto", "forex" (default "america")
 * @param {Array}  opts.filters          [{field, operation, value}, ...]
 * @param {Array}  opts.columns          column names to return (default DEFAULT_COLUMNS)
 * @param {Object} opts.sort             { by: 'market_cap_basic', order: 'desc' }
 * @param {Array}  opts.range            [from, to] inclusive-exclusive (default [0, 50], max span 500)
 * @param {Array}  opts.tickers          optional preset list "EXCHANGE:SYMBOL" — only scan these
 * @param {string} opts.lang             response language (default "en")
 */
export async function scan(opts = {}) {
  const { url, payload, range: [from, to], columns: cols } = buildScanRequest(opts);
  const market = opts.market || 'america';

  // Run the fetch inside the page context so credentials:'include' picks up
  // the user's TV session cookies. NOTE: Content-Type must be 'text/plain'
  // (a CORS "simple request" content-type) to skip the OPTIONS preflight —
  // scanner.tradingview.com does not respond to preflight from the chart
  // page origin, but accepts a plain POST. Body is still JSON; the server
  // ignores Content-Type and parses by shape.
  const expr = `
    (function() {
      var url = ${safeString(url)};
      var body = ${safeString(JSON.stringify(payload))};
      return fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: body,
      })
      .then(function(r) {
        return r.text().then(function(t) {
          return { ok: r.ok, status: r.status, text: t };
        });
      })
      .catch(function(e) { return { ok: false, status: 0, error: e.message }; });
    })()
  `;

  const resp = await evaluateAsync(expr);
  if (!resp || resp.error) {
    throw new Error(`Screener fetch failed: ${resp?.error || 'no response'}`);
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error(
      `Screener returned ${resp.status} — TradingView session not present. ` +
        `Make sure you're logged in to TV in this browser session.`,
    );
  }
  if (!resp.ok) {
    throw new Error(`Screener returned ${resp.status}: ${(resp.text || '').slice(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(resp.text);
  } catch (e) {
    throw new Error(`Screener returned non-JSON: ${(resp.text || '').slice(0, 200)}`);
  }

  const rawRows = Array.isArray(data?.data) ? data.data : [];
  const rows = rawRows.map(r => {
    const ticker = r.s || r.ticker || '';
    const [exchange, symbol] = ticker.includes(':') ? ticker.split(':') : ['', ticker];
    const dataArr = Array.isArray(r.d) ? r.d : [];
    const cells = {};
    cols.forEach((col, i) => {
      cells[col] = i < dataArr.length ? dataArr[i] : null;
    });
    return { ticker, exchange, symbol, ...cells };
  });

  return {
    success: true,
    market,
    total_count: data?.totalCount ?? rows.length,
    returned_count: rows.length,
    range: [from, to],
    columns: cols,
    rows,
  };
}

/**
 * Active Lists / Top Movers — preset filters that mimic TV's "Top gainers /
 * losers / most active" widgets. Built on the screener scan API.
 *
 *   list_type:
 *     - 'most_active'   most volume today
 *     - 'gainers'       biggest % gains, min volume threshold
 *     - 'losers'        biggest % losses, min volume threshold
 *     - 'high_volume'   relative_volume_10d_calc > 2
 *     - '52w_highs'     close at or near 52-week high
 *     - '52w_lows'      close at or near 52-week low
 */
export async function getActiveList({
  list_type = 'most_active',
  market = 'america',
  range,
  columns,
  min_volume = 1_000_000,
} = {}) {
  const presets = {
    most_active: {
      filters: [{ field: 'is_primary', operation: 'equal', value: true }],
      sort: { by: 'volume', order: 'desc' },
    },
    gainers: {
      filters: [
        { field: 'is_primary', operation: 'equal', value: true },
        { field: 'volume', operation: 'greater', value: min_volume },
      ],
      sort: { by: 'change', order: 'desc' },
    },
    losers: {
      filters: [
        { field: 'is_primary', operation: 'equal', value: true },
        { field: 'volume', operation: 'greater', value: min_volume },
      ],
      sort: { by: 'change', order: 'asc' },
    },
    high_volume: {
      filters: [
        { field: 'is_primary', operation: 'equal', value: true },
        { field: 'relative_volume_10d_calc', operation: 'greater', value: 2 },
      ],
      sort: { by: 'relative_volume_10d_calc', order: 'desc' },
    },
    '52w_highs': {
      filters: [
        { field: 'is_primary', operation: 'equal', value: true },
        { field: 'High.All', operation: 'equal', value: 'close' },
      ],
      sort: { by: 'volume', order: 'desc' },
    },
    '52w_lows': {
      filters: [
        { field: 'is_primary', operation: 'equal', value: true },
        { field: 'Low.All', operation: 'equal', value: 'close' },
      ],
      sort: { by: 'volume', order: 'desc' },
    },
  };
  const preset = presets[list_type];
  if (!preset) {
    throw new Error(
      `Unknown list_type "${list_type}". Use one of: ${Object.keys(presets).join(', ')}`,
    );
  }
  const cols = Array.isArray(columns) && columns.length > 0
    ? columns
    : ['name', 'close', 'change', 'volume', 'market_cap_basic', 'sector'];

  return scan({
    market,
    filters: preset.filters,
    columns: cols,
    sort: preset.sort,
    range,
  });
}

export function listColumns() {
  return {
    success: true,
    count: SCREENER_COLUMNS.length,
    columns: SCREENER_COLUMNS,
    note: 'These are common columns. TV exposes hundreds — request any column name; unknown ones return null.',
  };
}

export function listOperations() {
  return {
    success: true,
    count: SCREENER_OPERATIONS.length,
    operations: SCREENER_OPERATIONS,
    examples: [
      { description: 'RSI oversold US stocks', filter: { field: 'RSI', operation: 'less', value: 30 } },
      { description: 'Mid-cap and above', filter: { field: 'market_cap_basic', operation: 'egreater', value: 2_000_000_000 } },
      { description: 'High relative volume', filter: { field: 'relative_volume_10d_calc', operation: 'greater', value: 2 } },
      { description: 'Tech sector only', filter: { field: 'sector', operation: 'match', value: 'Technology Services' } },
      { description: 'Price between 10 and 100', filter: { field: 'close', operation: 'in_range', value: [10, 100] } },
    ],
  };
}
