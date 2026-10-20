// The curated lists the screener ranks. Mirrors services/market/internal/universe;
// see there for why the lists are hand-curated rather than index memberships.

import type { FundCategory, Universe } from '@folio/shared';

const SECTORS = {
  it: 'IT services',
  financials: 'Banks and financials',
  auto: 'Auto',
  healthcare: 'Pharma and healthcare',
  consumer: 'Consumer',
  energy: 'Energy and utilities',
  materials: 'Metals and materials',
  industrials: 'Industrials and infra',
  services: 'Telecom, travel and services',
  tech: 'Technology',
  fund: 'Fund',
} as const;
type Sector = keyof typeof SECTORS;

interface Member {
  symbol: string;
  sector: Sector;
}

const m = (sector: Sector, ...symbols: string[]): Member[] => symbols.map((symbol) => ({ symbol, sector }));

const indiaLargeCaps = [
  ...m('it', 'TCS.NS', 'INFY.NS', 'HCLTECH.NS', 'WIPRO.NS', 'TECHM.NS'),
  ...m(
    'financials',
    'HDFCBANK.NS',
    'ICICIBANK.NS',
    'KOTAKBANK.NS',
    'AXISBANK.NS',
    'SBIN.NS',
    'INDUSINDBK.NS',
    'BAJFINANCE.NS',
    'BAJAJFINSV.NS',
    'HDFCLIFE.NS',
    'SBILIFE.NS',
    'SHRIRAMFIN.NS',
    'JIOFIN.NS',
  ),
  ...m('auto', 'MARUTI.NS', 'M&M.NS', 'BAJAJ-AUTO.NS', 'EICHERMOT.NS', 'HEROMOTOCO.NS', 'TMPV.NS'),
  ...m('healthcare', 'SUNPHARMA.NS', 'CIPLA.NS', 'DRREDDY.NS', 'APOLLOHOSP.NS', 'DIVISLAB.NS', 'MAXHEALTH.NS'),
  ...m(
    'consumer',
    'HINDUNILVR.NS',
    'ITC.NS',
    'NESTLEIND.NS',
    'TATACONSUM.NS',
    'BRITANNIA.NS',
    'TITAN.NS',
    'ASIANPAINT.NS',
    'TRENT.NS',
    'DMART.NS',
    'PIDILITIND.NS',
  ),
  ...m('energy', 'RELIANCE.NS', 'ONGC.NS', 'NTPC.NS', 'POWERGRID.NS', 'COALINDIA.NS', 'BPCL.NS', 'ADANIGREEN.NS'),
  ...m('materials', 'TATASTEEL.NS', 'JSWSTEEL.NS', 'HINDALCO.NS', 'ULTRACEMCO.NS', 'GRASIM.NS'),
  ...m('industrials', 'LT.NS', 'ADANIPORTS.NS', 'ADANIENT.NS', 'BEL.NS', 'HAL.NS'),
  ...m('services', 'BHARTIARTL.NS', 'INDIGO.NS', 'ETERNAL.NS'),
];

const indiaMidCaps = [
  ...m('it', 'PERSISTENT.NS', 'MPHASIS.NS', 'COFORGE.NS', 'KPITTECH.NS', 'TATAELXSI.NS'),
  ...m('financials', 'FEDERALBNK.NS', 'IDFCFIRSTB.NS', 'YESBANK.NS', 'ABCAPITAL.NS'),
  ...m('auto', 'ASHOKLEY.NS', 'BHARATFORG.NS', 'MRF.NS'),
  ...m('healthcare', 'LUPIN.NS', 'AUROPHARMA.NS'),
  ...m('consumer', 'DIXON.NS', 'VOLTAS.NS', 'PAGEIND.NS'),
  ...m('energy', 'TORNTPOWER.NS', 'SUZLON.NS'),
  ...m('materials', 'PIIND.NS', 'ASTRAL.NS'),
  ...m('industrials', 'POLYCAB.NS', 'CUMMINSIND.NS'),
  ...m('services', 'INDHOTEL.NS', 'IRCTC.NS'),
];

const usLargeCaps = [
  ...m('tech', 'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'AVGO', 'ORCL', 'CRM', 'AMD', 'ADBE'),
  ...m('financials', 'BRK-B', 'JPM', 'V', 'MA', 'BAC'),
  ...m('healthcare', 'LLY', 'UNH', 'JNJ'),
  ...m('consumer', 'AMZN', 'TSLA', 'PG', 'COST', 'HD', 'KO', 'PEP', 'WMT', 'NFLX'),
  ...m('energy', 'XOM'),
];

// LIQUIDBEES is deliberately absent: it pays returns as daily dividend units
// while its price stays flat, so price-based returns show it at 0%.
const indiaETFs = m(
  'fund',
  'NIFTYBEES.NS',
  'JUNIORBEES.NS',
  'MIDCAPETF.NS',
  'BANKBEES.NS',
  'PSUBNKBEES.NS',
  'ITBEES.NS',
  'CPSEETF.NS',
  'MON100.NS',
  'MAFANG.NS',
  'GOLDBEES.NS',
  'SILVERBEES.NS',
);

const usETFs = m('fund', 'VOO', 'VTI', 'QQQ', 'SCHD', 'IWM', 'XLK', 'VXUS', 'VWO', 'BND', 'GLD');

const indices = m('fund', '^NSEI', '^BSESN', '^NSEBANK', '^CNXIT', '^NSMIDCP', '^GSPC', '^IXIC', '^DJI');

interface UniverseDef extends Omit<Universe, 'count'> {
  members: Member[];
}

const defs: UniverseDef[] = [
  {
    id: 'in-large',
    name: 'India large caps',
    group: 'India',
    region: 'IN',
    description: 'The biggest, most traded companies on the NSE.',
    members: indiaLargeCaps,
  },
  {
    id: 'in-mid',
    name: 'India mid caps',
    group: 'India',
    region: 'IN',
    description: 'Established mid-sized companies with more room to grow, and more volatility.',
    members: indiaMidCaps,
  },
  {
    id: 'in-etf',
    name: 'India ETFs',
    group: 'ETFs',
    region: 'IN',
    description: 'Exchange-traded funds on the NSE: index, sector, gold, silver and international.',
    members: indiaETFs,
  },
  {
    id: 'us-large',
    name: 'US large caps',
    group: 'US',
    region: 'US',
    description: 'The largest US companies by market value.',
    members: usLargeCaps,
  },
  {
    id: 'us-etf',
    name: 'US ETFs',
    group: 'ETFs',
    region: 'US',
    description: 'Popular low-cost US index, dividend, bond and gold ETFs.',
    members: usETFs,
  },
  {
    id: 'indices',
    name: 'Market indices',
    group: 'Indices',
    region: 'IN',
    description: 'Headline Indian and US indices. Not directly investable; use an index fund or ETF.',
    members: indices,
  },
];

const indian = [...indiaLargeCaps, ...indiaMidCaps];
for (const s of [
  'it',
  'financials',
  'auto',
  'healthcare',
  'consumer',
  'energy',
  'materials',
  'industrials',
  'services',
] as const) {
  defs.push({
    id: `in-sector-${s}`,
    name: SECTORS[s],
    group: 'India sectors',
    region: 'IN',
    description: `Indian large and mid caps in ${SECTORS[s]}.`,
    members: indian.filter((x) => x.sector === s),
  });
}
for (const s of ['tech', 'financials', 'healthcare', 'consumer'] as const) {
  defs.push({
    id: `us-sector-${s}`,
    name: SECTORS[s],
    group: 'US sectors',
    region: 'US',
    description: `US large caps in ${SECTORS[s]}.`,
    members: usLargeCaps.filter((x) => x.sector === s),
  });
}

const toUniverse = ({ members, ...u }: UniverseDef): Universe => ({ ...u, count: members.length });

export const universes = (): Universe[] => defs.map(toUniverse);

export function universe(id: string): { universe: Universe; symbols: string[] } | undefined {
  const def = defs.find((u) => u.id === id);
  return def && { universe: toUniverse(def), symbols: def.members.map((x) => x.symbol) };
}

/** Every distinct curated symbol, for the refresh jobs. */
export const allSymbols = (): string[] => [...new Set(defs.flatMap((u) => u.members.map((x) => x.symbol)))];

const sectorBySymbol = new Map(
  [...indiaLargeCaps, ...indiaMidCaps, ...usLargeCaps].map((x) => [x.symbol, SECTORS[x.sector]]),
);

/** The sector name for a curated company, or '' for funds, indices and unknown symbols. */
export const sectorOf = (symbol: string): string => sectorBySymbol.get(symbol) ?? '';

// Mutual fund categories, matched against the headings in AMFI's NAV file. AMFI
// has used two spellings ("Equity Scheme -" and "Equity Schemes -"), hence patterns.

interface FundCategoryDef extends Omit<FundCategory, 'count'> {
  heading: RegExp;
  /** Optional extra filter on the scheme name. */
  scheme?: RegExp;
}

const fundCategoryDefs: FundCategoryDef[] = [
  {
    id: 'flexi-cap',
    name: 'Flexi cap',
    heading: /Equity Schemes? - Flexi Cap/,
    description: 'Free to invest across large, mid and small caps. A common core holding.',
  },
  {
    id: 'large-cap',
    name: 'Large cap',
    heading: /Equity Schemes? - Large Cap/,
    description: 'At least 80% in the top 100 companies. Steadier, lower expected returns.',
  },
  {
    id: 'mid-cap',
    name: 'Mid cap',
    heading: /Equity Schemes? - Mid Cap/,
    description: 'At least 65% in companies ranked 101 to 250.',
  },
  {
    id: 'small-cap',
    name: 'Small cap',
    heading: /Equity Schemes? - Small Cap/,
    description: 'At least 65% in companies ranked 251 and below. Highest swings.',
  },
  {
    id: 'large-mid-cap',
    name: 'Large and mid cap',
    heading: /Equity Schemes? - Large & Mid Cap/,
    description: 'At least 35% each in large and mid caps.',
  },
  {
    id: 'multi-cap',
    name: 'Multi cap',
    heading: /Equity Schemes? - Multi Cap/,
    description: 'At least 25% each in large, mid and small caps.',
  },
  {
    id: 'elss',
    name: 'ELSS (tax saver)',
    heading: /Equity Schemes? - ELSS/,
    description: 'Tax deduction under Section 80C (old regime), with a 3-year lock-in.',
  },
  {
    id: 'value',
    name: 'Value',
    heading: /Equity Schemes? - Value/,
    description: 'Buys companies priced cheaply relative to their fundamentals.',
  },
  {
    id: 'index-nifty50',
    name: 'Nifty 50 and Sensex index',
    heading: /Index Funds/,
    scheme: /(nifty 50|sensex) index/i,
    description: 'Passive funds that track the Nifty 50 or Sensex. Lowest cost.',
  },
  {
    id: 'aggressive-hybrid',
    name: 'Aggressive hybrid',
    heading: /Hybrid Schemes? - Aggressive Hybrid/,
    description: '65 to 80% equity, the rest debt.',
  },
  {
    id: 'balanced-advantage',
    name: 'Balanced advantage',
    heading: /Hybrid Schemes? - (Balanced Advantage|Dynamic Asset Allocation)/,
    description: 'Shifts between equity and debt based on market valuations.',
  },
];

export const fundCategories = (): Omit<FundCategory, 'count'>[] =>
  fundCategoryDefs.map(({ id, name, description }) => ({ id, name, description }));

export const fundCategory = (id: string) => fundCategories().find((c) => c.id === id);

/** The screener category for a scheme with this AMFI heading and name, if any. */
export function categoryOf(heading: string, schemeName: string): string | undefined {
  return fundCategoryDefs.find((c) => c.heading.test(heading) && (!c.scheme || c.scheme.test(schemeName)))?.id;
}

const EXCLUDED_OPTIONS = /idcw|dividend|bonus|payout|reinvest/i;

/**
 * Keeps only the plan most investors should compare: Direct (no distributor
 * commission) and Growth (gains stay invested, so NAV returns are total returns).
 */
export function isDirectGrowth(name: string, plan: string, option: string): boolean {
  const text = `${name} ${plan} ${option}`;
  const lower = text.toLowerCase();
  return lower.includes('direct') && lower.includes('growth') && !EXCLUDED_OPTIONS.test(text);
}
