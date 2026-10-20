import { type SymbolMatch, type WatchlistItem, WatchlistItemSchema } from '@folio/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { deleteJson, getJson, putJson } from './api.js';

export function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const WATCHLIST_KEY = ['watchlist'] as const;

/** Something that can be starred: a ticker (stock, ETF, index) or a mutual fund scheme. */
export type StarTarget =
  | { kind: 'symbol'; symbol: string; name?: string; type?: SymbolMatch['type'] }
  | { kind: 'fund'; code: string; name?: string };

/** The watchlist key the server stores the target under. */
export function starKey(target: StarTarget): string {
  return target.kind === 'fund' ? `MF-${target.code}` : target.symbol;
}

function starPath(target: StarTarget): string {
  return target.kind === 'fund'
    ? `/api/watchlist/funds/${encodeURIComponent(target.code)}`
    : `/api/watchlist/${encodeURIComponent(target.symbol)}`;
}

/**
 * Starred stocks and funds, stored server-side. Star and unstar update the
 * cache optimistically so the UI responds instantly, roll back if the server
 * refuses (unknown symbol, unsupported currency), then refetch the truth.
 */
export function useWatchlist() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: WATCHLIST_KEY,
    queryFn: () => getJson('/api/watchlist', z.array(WatchlistItemSchema)),
    staleTime: 60_000,
  });

  const snapshot = async () => {
    await queryClient.cancelQueries({ queryKey: WATCHLIST_KEY });
    return { previous: queryClient.getQueryData<WatchlistItem[]>(WATCHLIST_KEY) };
  };
  const rollback = (_error: Error, _target: StarTarget, context?: { previous?: WatchlistItem[] }) => {
    queryClient.setQueryData(WATCHLIST_KEY, context?.previous);
  };
  const refetch = () => queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY });

  const star = useMutation({
    mutationFn: (target: StarTarget) =>
      putJson(
        starPath(target),
        target.kind === 'symbol' ? { name: target.name, type: target.type } : {},
        WatchlistItemSchema,
      ),
    onMutate: async (target) => {
      const context = await snapshot();
      const key = starKey(target);
      const placeholder: WatchlistItem = {
        symbol: key,
        name: target.name ?? key,
        assetClass: target.kind === 'fund' ? 'mutual_fund' : 'equity',
        currency: 'INR', // replaced by the server's answer on refetch
        starredAt: new Date().toISOString(),
        schemeCode: target.kind === 'fund' ? target.code : null,
      };
      queryClient.setQueryData<WatchlistItem[]>(WATCHLIST_KEY, (items = []) =>
        items.some((i) => i.symbol === key) ? items : [...items, placeholder],
      );
      return context;
    },
    onError: rollback,
    onSettled: refetch,
  });

  const unstar = useMutation({
    mutationFn: (target: StarTarget) => deleteJson(starPath(target)),
    onMutate: async (target) => {
      const context = await snapshot();
      const key = starKey(target);
      queryClient.setQueryData<WatchlistItem[]>(WATCHLIST_KEY, (items = []) => items.filter((i) => i.symbol !== key));
      return context;
    },
    onError: rollback,
    onSettled: refetch,
  });

  const items = query.data ?? [];
  return {
    items,
    stocks: items.filter((i) => i.schemeCode === null),
    funds: items.filter((i) => i.schemeCode !== null),
    isPending: query.isPending,
    error: query.error ?? star.error ?? unstar.error,
    isStarred: (target: StarTarget) => items.some((i) => i.symbol === starKey(target)),
    star: star.mutate,
    unstar: unstar.mutate,
  };
}
