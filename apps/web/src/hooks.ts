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

export type StarTarget = Pick<SymbolMatch, 'symbol'> & Partial<Pick<SymbolMatch, 'name' | 'type'>>;

/**
 * Starred symbols, stored server-side. Star and unstar update the cache
 * optimistically so the UI responds instantly, roll back if the server
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
  const rollback = (_error: Error, _variables: unknown, context?: { previous?: WatchlistItem[] }) => {
    queryClient.setQueryData(WATCHLIST_KEY, context?.previous);
  };
  const refetch = () => queryClient.invalidateQueries({ queryKey: WATCHLIST_KEY });

  const star = useMutation({
    mutationFn: ({ symbol, name, type }: StarTarget) =>
      putJson(`/api/watchlist/${encodeURIComponent(symbol)}`, { name, type }, WatchlistItemSchema),
    onMutate: async (target) => {
      const context = await snapshot();
      const placeholder: WatchlistItem = {
        symbol: target.symbol,
        name: target.name ?? target.symbol,
        assetClass: 'equity',
        currency: 'INR', // replaced by the server's answer on refetch; not shown in the UI
        starredAt: new Date().toISOString(),
      };
      queryClient.setQueryData<WatchlistItem[]>(WATCHLIST_KEY, (items = []) =>
        items.some((i) => i.symbol === target.symbol) ? items : [...items, placeholder],
      );
      return context;
    },
    onError: rollback,
    onSettled: refetch,
  });

  const unstar = useMutation({
    mutationFn: (symbol: string) => deleteJson(`/api/watchlist/${encodeURIComponent(symbol)}`),
    onMutate: async (symbol) => {
      const context = await snapshot();
      queryClient.setQueryData<WatchlistItem[]>(WATCHLIST_KEY, (items = []) =>
        items.filter((i) => i.symbol !== symbol),
      );
      return context;
    },
    onError: rollback,
    onSettled: refetch,
  });

  const items = query.data ?? [];
  return {
    items,
    isPending: query.isPending,
    error: query.error ?? star.error ?? unstar.error,
    isStarred: (symbol: string) => items.some((i) => i.symbol === symbol),
    star: star.mutate,
    unstar: unstar.mutate,
  };
}
