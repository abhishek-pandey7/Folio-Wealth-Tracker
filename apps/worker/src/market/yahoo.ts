// Yahoo Finance's public endpoints: unofficial and undocumented, but free,
// keyless, and covering NSE, BSE and US listings with one symbol format.
//
// Two endpoints matter. `chart` returns one symbol with its identity (name,
// exchange, currency) and closes adjusted for splits and dividends, which
// statistics need: unadjusted, a high-dividend stock looks years behind. Five
// years of daily data is ~120 KB and parses in under half a millisecond.
// `spark` returns the latest price for up to 20 symbols at once, for quotes.

import { NotFoundError, UnprocessableError } from '@folio/core';
import type { HistoryRange, Quote, SymbolMatch } from '@folio/shared';
import { isoDate, type Point } from './analytics.js';
import { decimal, getJson } from './upstream.js';

const BASE = 'https://query1.finance.yahoo.com';
export const SPARK_BATCH = 20; // the endpoint rejects more

const DAY_MS = 86_400_000;
const SUPPORTED = new Set(['INR', 'USD']);

interface ChartMeta {
  symbol: string;
  currency?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  regularMarketTime?: number;
  longName?: string;
  shortName?: string;
  fullExchangeName?: string;
}

interface ChartResponse {
  chart: {
    result:
      | {
          meta: ChartMeta;
          timestamp?: number[];
          indicators: {
            quote: { close?: (number | null)[] }[];
            adjclose?: { adjclose?: (number | null)[] }[];
          };
        }[]
      | null;
  };
}

export interface Identity {
  symbol: string;
  name: string;
  exchange: string;
  currency: 'INR' | 'USD';
}

export interface Chart {
  identity: Identity;
  /**
   * Built from the chart's previous close, which is the close before the
   * requested range: today's quote only when the range is 1d.
   */
  quote: Quote;
  /** Closes by UTC date, oldest first. */
  points: { date: string; close: number }[];
  /**
   * Closes adjusted for splits and dividends, so returns are total returns.
   * Indices have no adjusted series and use plain closes. Never mixed: filling
   * one missing adjusted value with a plain close would splice two price scales.
   */
  adjusted: Point[];
}

export async function chart(symbol: string, range = '1d', interval = '1d'): Promise<Chart> {
  const url = `${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await getJson<ChartResponse>(url);
  const result = res.chart.result?.[0];
  if (!result) throw new NotFoundError(`No market data for ${symbol}`);
  const { meta } = result;
  if (!meta.currency || !SUPPORTED.has(meta.currency)) {
    throw new UnprocessableError(
      `${symbol} trades in ${meta.currency ?? 'an unknown currency'}; only INR and USD are supported`,
    );
  }
  if (meta.regularMarketPrice === undefined || meta.chartPreviousClose === undefined) {
    throw new NotFoundError(`No price for ${symbol}`);
  }

  const points: Chart['points'] = [];
  const closes = result.indicators.quote[0]?.close ?? [];
  (result.timestamp ?? []).forEach((ts, i) => {
    const close = closes[i];
    if (close === null || close === undefined) return; // holidays and halts are padded with nulls
    const date = isoDate(ts * 1000);
    // The live bar can share a date with the last completed one; keep the latest.
    if (points.at(-1)?.date === date) points.pop();
    points.push({ date, close });
  });

  const adjclose = result.indicators.adjclose?.[0]?.adjclose;
  const series = adjclose?.length ? adjclose : closes;
  const adjusted: Point[] = [];
  (result.timestamp ?? []).forEach((ts, i) => {
    const v = series[i];
    if (v === null || v === undefined || v <= 0) return;
    const date = Math.floor((ts * 1000) / DAY_MS) * DAY_MS;
    if (adjusted.at(-1)?.date === date) adjusted.pop();
    adjusted.push({ date, value: v });
  });

  const identity: Identity = {
    symbol: meta.symbol,
    name: meta.longName || meta.shortName || meta.symbol,
    exchange: meta.fullExchangeName ?? '',
    currency: meta.currency as Identity['currency'],
  };
  return {
    identity,
    quote: toQuote(
      identity,
      meta.regularMarketPrice,
      meta.chartPreviousClose,
      meta.regularMarketTime ?? Date.now() / 1000,
    ),
    points,
    adjusted,
  };
}

export function toQuote(identity: Identity, price: number, previous: number, epochSeconds: number): Quote {
  const change = price - previous;
  return {
    symbol: identity.symbol,
    currency: identity.currency,
    price: decimal(price),
    change: decimal(change),
    changePercent: previous === 0 ? '0' : ((change / previous) * 100).toFixed(2),
    previousClose: decimal(previous),
    asOf: new Date(epochSeconds * 1000).toISOString(),
    source: 'yahoo',
    stale: false,
  };
}

interface SparkSeries {
  symbol: string;
  timestamp?: number[];
  close?: (number | null)[];
  chartPreviousClose?: number;
}

/** Latest prices for up to 20 symbols in one request. Unknown symbols are simply absent from the result. */
export async function spark(symbols: string[], range = '1d', interval = '1d'): Promise<Map<string, SparkSeries>> {
  if (symbols.length > SPARK_BATCH) throw new Error(`spark takes at most ${SPARK_BATCH} symbols`);
  const url = `${BASE}/v8/finance/spark?symbols=${symbols.map(encodeURIComponent).join(',')}&range=${range}&interval=${interval}`;
  const res = await getJson<Record<string, SparkSeries>>(url);
  return new Map(Object.values(res).map((s) => [s.symbol, s]));
}

const SEARCHABLE: Record<string, SymbolMatch['type']> = {
  EQUITY: 'equity',
  ETF: 'etf',
  MUTUALFUND: 'mutual_fund',
  INDEX: 'index',
};

interface SearchResponse {
  quotes?: {
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
    exchDisp?: string;
    quoteType?: string;
  }[];
}

export async function search(query: string): Promise<SymbolMatch[]> {
  const res = await getJson<SearchResponse>(
    `${BASE}/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`,
  );
  return (res.quotes ?? []).flatMap((q) => {
    const type = q.quoteType && SEARCHABLE[q.quoteType];
    if (!type || !q.symbol) return [];
    return [
      {
        symbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        exchange: q.exchDisp || q.exchange || '',
        type,
      },
    ];
  });
}

export const HISTORY_INTERVAL: Record<HistoryRange, string> = {
  '1mo': '1d',
  '3mo': '1d',
  '6mo': '1d',
  '1y': '1d',
  '5y': '1wk',
};
