#!/usr/bin/env node
// Builds the Nifty 500 and S&P 500 member lists the screener ranks, for both
// runtimes, from the two published constituent files:
//
//   Nifty 500: https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv
//   S&P 500:   https://github.com/datasets/s-and-p-500-companies (data/constituents.csv)
//
// Index memberships change at each rebalance (NSE twice a year, S&P every
// quarter) and are not available from a free API, so the lists are committed
// and refreshed by downloading both files and running:
//
//   node scripts/index-lists.mjs <nifty500.csv> <sp500.csv>
//
// It writes apps/worker/src/market/indexes.ts and
// services/market/internal/universe/indexes_gen.go.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [niftyPath, spPath] = process.argv.slice(2);
if (!niftyPath || !spPath) {
  console.error('usage: node scripts/index-lists.mjs <nifty500.csv> <sp500.csv>');
  process.exit(1);
}

/** Minimal RFC 4180 parsing: quoted fields may contain commas and doubled quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// NSE's industry classification and GICS sectors, folded into the app's sectors.
const NSE_SECTOR = {
  'Information Technology': 'it',
  'Financial Services': 'financials',
  'Automobile and Auto Components': 'auto',
  Healthcare: 'healthcare',
  'Fast Moving Consumer Goods': 'consumer',
  'Consumer Durables': 'consumer',
  'Consumer Services': 'consumer',
  Textiles: 'consumer',
  'Oil Gas & Consumable Fuels': 'energy',
  Power: 'energy',
  'Metals & Mining': 'materials',
  Chemicals: 'materials',
  'Construction Materials': 'materials',
  'Forest Materials': 'materials',
  'Capital Goods': 'industrials',
  Construction: 'industrials',
  Realty: 'industrials',
  Diversified: 'industrials',
  Telecommunication: 'services',
  Services: 'services',
  'Media Entertainment & Publication': 'services',
};

// Communication services (Alphabet, Meta) sit with technology, as in the curated US list.
const GICS_SECTOR = {
  'Information Technology': 'tech',
  'Communication Services': 'tech',
  'Consumer Discretionary': 'consumer',
  'Consumer Staples': 'consumer',
  Energy: 'energy',
  Utilities: 'energy',
  Financials: 'financials',
  'Health Care': 'healthcare',
  Industrials: 'industrials',
  'Real Estate': 'industrials',
  Materials: 'materials',
};

const INDIAN = /^[A-Z0-9][A-Z0-9&-]{0,16}$/;
const US = /^[A-Z][A-Z-]{0,9}$/;

function build(rows, { symbolOf, sectorOf, pattern, sectors, name }) {
  const groups = new Map();
  const seen = new Set();
  for (const row of rows) {
    const symbol = symbolOf(row);
    const sector = sectors[sectorOf(row)];
    if (!pattern.test(symbol)) throw new Error(`${name}: unexpected symbol "${symbol}"`);
    if (!sector) throw new Error(`${name}: no sector mapping for "${sectorOf(row)}" (${symbol})`);
    if (seen.has(symbol)) throw new Error(`${name}: duplicate symbol ${symbol}`);
    seen.add(symbol);
    groups.set(sector, [...(groups.get(sector) ?? []), symbol]);
  }
  const order = [...new Set(Object.values(sectors))].filter((s) => groups.has(s));
  return { order, groups: new Map(order.map((s) => [s, groups.get(s).sort()])), count: seen.size };
}

const nifty = build(parseCsv(readFileSync(niftyPath, 'utf8')), {
  name: 'Nifty 500',
  symbolOf: (r) => r.Symbol,
  sectorOf: (r) => r.Industry,
  pattern: INDIAN,
  sectors: NSE_SECTOR,
});
const sp = build(parseCsv(readFileSync(spPath, 'utf8')), {
  name: 'S&P 500',
  symbolOf: (r) => r.Symbol.replace('.', '-'), // Yahoo writes share classes as BRK-B
  sectorOf: (r) => r['GICS Sector'],
  pattern: US,
  sectors: GICS_SECTOR,
});
if (nifty.count < 480 || sp.count < 480) throw new Error(`lists look incomplete: ${nifty.count}, ${sp.count}`);

/** Symbols as space-separated lines of about 100 characters, so diffs stay readable. */
function lines(symbols) {
  const out = [];
  let line = '';
  for (const s of symbols) {
    if (line && line.length + s.length + 1 > 100) {
      out.push(line);
      line = '';
    }
    line = line ? `${line} ${s}` : s;
  }
  if (line) out.push(line);
  return out;
}

const today = new Date().toISOString().slice(0, 10);
const header = (comment) =>
  [
    `${comment} Generated by scripts/index-lists.mjs on ${today}; do not edit by hand.`,
    `${comment} Nifty 500: ${nifty.count} companies (NSE symbols, .NS added at load).`,
    `${comment} S&P 500: ${sp.count} share classes (Yahoo symbols).`,
  ].join('\n');

// Laid out as Biome formats it: an array that fits in 120 columns stays on one line.
const tsGroup = (sector, symbols) => {
  const parts = lines(symbols);
  const oneLine = `  ${sector}: ['${parts[0]}'],`;
  if (parts.length === 1 && oneLine.length <= 120) return oneLine;
  return `  ${sector}: [\n${parts.map((l) => `    '${l}',`).join('\n')}\n  ],`;
};

const ts = (list) =>
  list.order
    .map((s) => tsGroup(s, list.groups.get(s)))
    .join('\n');

writeFileSync(
  join(root, 'apps/worker/src/market/indexes.ts'),
  `${header('//')}

/** Nifty 500 members by sector, as NSE symbols. */
export const NIFTY_500 = {
${ts(nifty)}
} as const;

/** S&P 500 members by sector, as Yahoo symbols. */
export const SP_500 = {
${ts(sp)}
} as const;
`,
);

const goName = (s) => `Sector${s === 'it' ? 'IT' : s[0].toUpperCase() + s.slice(1)}`;
const go = (list) =>
  list.order
    .map(
      (s) =>
        `\t{${goName(s)}, fields(\n${lines(list.groups.get(s))
          .map((l) => `\t\t"${l}",`)
          .join('\n')}\n\t)},`,
    )
    .join('\n');

writeFileSync(
  join(root, 'services/market/internal/universe/indexes_gen.go'),
  `// Code generated by scripts/index-lists.mjs; DO NOT EDIT.
${header('//').split('\n').slice(1).join('\n')}

package universe

// nifty500 lists Nifty 500 members by sector, as NSE symbols.
var nifty500 = []indexGroup{
${go(nifty)}
}

// sp500 lists S&P 500 members by sector, as Yahoo symbols.
var sp500 = []indexGroup{
${go(sp)}
}
`,
);

console.log(
  `Nifty 500: ${nifty.count} in ${nifty.order.length} sectors; S&P 500: ${sp.count} in ${sp.order.length} sectors`,
);
