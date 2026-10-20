// Indian mutual fund NAVs from mfapi.in, a free mirror of what AMFI publishes
// for every scheme. Unlike the Go gateway, which loads a fund's whole history,
// the Worker asks for a date range: five years is about 48 KB, a few cents of
// CPU, where twenty years of history would not fit an invocation's budget.

import { NotFoundError, UnprocessableError, UpstreamError } from '@folio/core';
import type { Fund, FundMatch } from '@folio/shared';
import { isoDate, type Point, toDate } from './analytics.js';
import { decimal, getJson } from './upstream.js';

const BASE = 'https://api.mfapi.in';
const MAX_MATCHES = 20;

interface NavResponse {
  meta: { fund_house: string; scheme_category: string; scheme_name: string };
  data: { date: string; nav: string }[];
}

export interface NavSeries {
  schemeCode: string;
  name: string;
  fundHouse: string;
  category: string;
  nav: string;
  navDate: string;
  /** Oldest first. */
  points: Point[];
}

/** mfapi dates are DD-MM-YYYY. */
const fromDmy = (dmy: string): string | undefined => {
  const [d, m, y] = dmy.split('-');
  return d && m && y ? `${y}-${m}-${d}` : undefined;
};

function check(code: string, res: NavResponse): void {
  // Unknown scheme codes come back as 200 with empty meta and data.
  if (!res.meta?.scheme_name || res.data.length === 0) {
    throw new NotFoundError(`No mutual fund with scheme code ${code}`);
  }
}

export async function latest(code: string): Promise<Fund> {
  const res = await getJson<NavResponse>(`${BASE}/mf/${encodeURIComponent(code)}/latest`);
  check(code, res);
  const row = res.data[0] as NavResponse['data'][number];
  const navDate = fromDmy(row.date);
  if (!navDate || !Number.isFinite(Number(row.nav)))
    throw new UpstreamError(`mfapi sent an unreadable NAV for ${code}`);
  return {
    schemeCode: code,
    name: res.meta.scheme_name,
    fundHouse: res.meta.fund_house,
    category: res.meta.scheme_category,
    nav: decimal(Number(row.nav), 6),
    navDate,
    source: 'mfapi',
    stale: false,
  };
}

/** NAVs between two ISO dates (inclusive), oldest first. */
export async function navs(code: string, from: string, to: string): Promise<NavSeries> {
  const res = await getJson<NavResponse>(`${BASE}/mf/${encodeURIComponent(code)}?startDate=${from}&endDate=${to}`);
  check(code, res);
  const points: Point[] = [];
  // mfapi serves newest first, as strings.
  for (let i = res.data.length - 1; i >= 0; i--) {
    const row = res.data[i] as NavResponse['data'][number];
    const iso = fromDmy(row.date);
    const nav = Number(row.nav);
    if (!iso || !(nav > 0)) continue;
    const date = toDate(iso);
    if (Number.isNaN(date) || (points.length && date <= (points.at(-1) as Point).date)) continue; // duplicate or out of order
    points.push({ date, value: nav });
  }
  const last = points.at(-1);
  // Segregated portfolios publish a NAV of zero; nothing about that will change on a retry.
  if (!last) throw new UnprocessableError(`No usable NAVs for fund ${code}`);
  return {
    schemeCode: code,
    name: res.meta.scheme_name,
    fundHouse: res.meta.fund_house,
    category: res.meta.scheme_category,
    nav: decimal(last.value, 6),
    navDate: isoDate(last.date),
    points,
  };
}

export async function searchFunds(query: string): Promise<FundMatch[]> {
  const res = await getJson<{ schemeCode: number; schemeName: string }[]>(
    `${BASE}/mf/search?q=${encodeURIComponent(query)}`,
  );
  return res.slice(0, MAX_MATCHES).map((r) => ({ schemeCode: String(r.schemeCode), name: r.schemeName }));
}
