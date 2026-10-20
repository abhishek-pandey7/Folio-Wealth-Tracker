// Generates docs/diagrams/data-model.svg (run: node docs/diagrams/data-model.cjs docs/diagrams/data-model.svg). Columns: [name, note], where a note starting with "→" is a foreign key.
const fs = require('node:fs');

const W = 1160;
const COL_W = 256;
const XS = [32, 312, 592, 872];
const ROW_H = 22;
const HEAD_H = 36;

const user = [
  { col: 0, y: 128, name: 'users', cols: [['id', 'PK'], ['email', 'unique'], ['display_name'], ['base_currency']] },
  {
    col: 1,
    y: 128,
    name: 'portfolios',
    sub: 'one per broker account',
    cols: [['id', 'PK'], ['user_id', '→ users'], ['name'], ['broker'], ['currency', 'INR or USD'], ['drift_threshold']],
  },
  {
    col: 1,
    y: 340,
    name: 'target_allocations',
    cols: [
      ['portfolio_id', '→ portfolios'],
      ['instrument_id', '→ instruments'],
      ['weight', 'fraction'],
    ],
  },
  {
    col: 2,
    y: 128,
    name: 'transactions',
    sub: 'the ledger',
    cols: [
      ['id', 'PK'],
      ['portfolio_id', '→ portfolios'],
      ['instrument_id', '→ instruments'],
      ['sip_id', '→ sips'],
      ['type', 'buy, sell, dividend'],
      ['trade_date'],
      ['quantity', 'NUMERIC'],
      ['price', 'NUMERIC'],
      ['amount', 'signed cash'],
      ['fees'],
      ['currency'],
    ],
  },
  {
    col: 3,
    y: 128,
    name: 'instruments',
    sub: 'shared by all users',
    cols: [['id', 'PK'], ['symbol', 'unique, MF-<code> for funds'], ['name'], ['asset_class'], ['currency']],
  },
  {
    col: 3,
    y: 340,
    name: 'watchlist_items',
    cols: [
      ['user_id', '→ users'],
      ['instrument_id', '→ instruments'],
    ],
  },
  {
    col: 0,
    y: 488,
    name: 'goals',
    cols: [['id', 'PK'], ['user_id', '→ users'], ['name'], ['target_amount'], ['target_date'], ['assumed_return']],
  },
  {
    col: 1,
    y: 488,
    name: 'goal_holdings',
    cols: [
      ['goal_id', '→ goals'],
      ['instrument_id', '→ instruments'],
      ['share', '0 to 1'],
    ],
  },
  {
    col: 2,
    y: 488,
    name: 'sips',
    cols: [
      ['id', 'PK'],
      ['user_id', '→ users'],
      ['portfolio_id', '→ portfolios'],
      ['instrument_id', '→ instruments'],
      ['goal_id', '→ goals'],
      ['amount'],
      ['day_of_month'],
      ['active_from'],
      ['status', 'active, paused, stopped'],
    ],
  },
];

const MARKET_Y = 818;
const market = [
  {
    col: 0,
    y: MARKET_Y,
    name: 'symbol_data',
    cols: [['symbol', 'PK'], ['name, exchange, currency'], ['stats', 'jsonb'], ['quote', 'jsonb'], ['error, error_at']],
  },
  {
    col: 1,
    y: MARKET_Y,
    name: 'fund_data',
    cols: [['scheme_code', 'PK'], ['category_id'], ['nav_date, seen_at'], ['stats', 'jsonb'], ['error, error_at']],
  },
  {
    col: 2,
    y: MARKET_Y,
    name: 'market_cache',
    sub: 'stale-while-revalidate',
    cols: [['key', 'PK'], ['value', 'jsonb'], ['fetched_at']],
  },
  {
    col: 3,
    y: MARKET_Y,
    name: 'job_state',
    sub: 'cron progress',
    cols: [
      ['name', 'PK'],
      ['state', 'jsonb'],
      ['report', 'jsonb'],
    ],
  },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function table(t, fill, stroke) {
  const x = XS[t.col];
  const h = HEAD_H + t.cols.length * ROW_H + 12;
  let out = `<rect x="${x}" y="${t.y}" width="${COL_W}" height="${h}" rx="10" fill="#ffffff" stroke="${stroke}" stroke-width="1.5"/>`;
  out += `<path d="M${x},${t.y + 10} a10,10 0 0 1 10,-10 h${COL_W - 20} a10,10 0 0 1 10,10 v${HEAD_H - 10} h-${COL_W} z" fill="${fill}"/>`;
  out += `<text x="${x + 14}" y="${t.y + 24}" font-size="15" font-weight="700" fill="#1f2328">${esc(t.name)}</text>`;
  if (t.sub)
    out += `<text x="${x + COL_W - 12}" y="${t.y + 24}" font-size="12" fill="#57606a" text-anchor="end">${esc(t.sub)}</text>`;
  t.cols.forEach(([name, note], i) => {
    const y = t.y + HEAD_H + 16 + i * ROW_H;
    const pk = note === 'PK';
    out += `<text x="${x + 14}" y="${y}" font-size="13.5" ${pk ? 'font-weight="700" ' : ''}fill="#1f2328">${esc(name)}</text>`;
    if (note && !pk) {
      const fk = note.startsWith('→');
      out += `<text x="${x + COL_W - 12}" y="${y}" font-size="12.5" fill="${fk ? '#0969da' : '#57606a'}" text-anchor="end">${esc(note)}</text>`;
    }
  });
  return out;
}

const H = 1000;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">
  <title>Folio data model</title>
  <rect x="0" y="0" width="${W}" height="${H}" rx="16" fill="#ffffff"/>
  <text x="32" y="44" font-size="22" font-weight="700" fill="#1f2328">Data model (PostgreSQL)</text>
  <text x="32" y="70" font-size="15" fill="#57606a">Holdings are never stored: they are replayed from transactions. Blue notes are foreign keys; deleting a user cascades to all of their rows.</text>
  <text x="32" y="112" font-size="16" font-weight="700" fill="#1f2328">Per user</text>
`;
for (const t of user) svg += `  ${table(t, '#ddf4ff', '#54aeff')}\n`;
svg += `  <text x="32" y="${MARKET_Y - 16}" font-size="16" font-weight="700" fill="#1f2328">Market data, shared and written by the cron Worker (Cloudflare deployment)</text>\n`;
for (const t of market) svg += `  ${table(t, '#fff8c5', '#d4a72c')}\n`;
svg += '</svg>\n';

fs.writeFileSync(process.argv[2], svg);
console.log('wrote', process.argv[2]);
