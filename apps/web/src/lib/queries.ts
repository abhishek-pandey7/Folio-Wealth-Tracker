import {
  BatchQuotesSchema,
  FundCategorySchema,
  FundScreenResultSchema,
  FundStatsSchema,
  type Period,
  QuoteSchema,
  ScreenResultSchema,
  type SortKey,
  SymbolStatsSchema,
  UniverseSchema,
} from '@folio/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { getJson } from '../api.js';

function search(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') sp.set(key, String(value));
  }
  return sp.toString();
}

export interface ScreenParams {
  universe?: string;
  symbols?: string[];
  period: Period;
  sort: SortKey;
  order: 'best' | 'worst';
  limit?: number;
}

export function useUniverses() {
  return useQuery({
    queryKey: ['universes'],
    queryFn: () => getJson('/api/market/universes', z.array(UniverseSchema)),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useScreen(params: ScreenParams, enabled = true) {
  const qs = search({
    universe: params.universe,
    symbols: params.symbols?.join(','),
    period: params.period,
    sort: params.sort,
    order: params.order,
    limit: params.limit,
  });
  return useQuery({
    queryKey: ['screen', qs],
    queryFn: () => getJson(`/api/market/screener?${qs}`, ScreenResultSchema),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    // Keep the old table on screen while a new period or sort loads.
    placeholderData: keepPreviousData,
  });
}

export function useStats(symbol: string) {
  return useQuery({
    queryKey: ['stats', symbol],
    queryFn: () => getJson(`/api/market/stats/${encodeURIComponent(symbol)}`, SymbolStatsSchema),
    staleTime: 5 * 60_000,
  });
}

export function useQuote(symbol: string) {
  return useQuery({
    queryKey: ['quote', symbol],
    queryFn: () => getJson(`/api/market/quotes/${encodeURIComponent(symbol)}`, QuoteSchema),
    refetchInterval: 15_000,
  });
}

export function useQuotes(symbols: string[]) {
  return useQuery({
    queryKey: ['quotes', symbols],
    queryFn: () => getJson(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, BatchQuotesSchema),
    enabled: symbols.length > 0,
    refetchInterval: 30_000,
  });
}

export function useFundCategories() {
  return useQuery({
    queryKey: ['fund-categories'],
    queryFn: () => getJson('/api/market/funds/categories', z.array(FundCategorySchema)),
    staleTime: 60 * 60_000,
  });
}

export interface FundScreenParams {
  category?: string;
  codes?: string[];
  period: Period;
  sort: SortKey;
  order: 'best' | 'worst';
  limit?: number;
}

export function useFundScreen(params: FundScreenParams, enabled = true) {
  const qs = search({
    category: params.category,
    codes: params.codes?.join(','),
    period: params.period,
    sort: params.sort,
    order: params.order,
    limit: params.limit,
  });
  return useQuery({
    queryKey: ['fund-screen', qs],
    queryFn: () => getJson(`/api/market/funds/screener?${qs}`, FundScreenResultSchema),
    enabled,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useFundStats(code: string) {
  return useQuery({
    queryKey: ['fund-stats', code],
    queryFn: () => getJson(`/api/market/funds/${encodeURIComponent(code)}/stats`, FundStatsSchema),
    staleTime: 30 * 60_000,
  });
}
