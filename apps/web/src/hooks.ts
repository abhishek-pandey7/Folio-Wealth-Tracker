import { useCallback, useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const WATCHLIST_KEY = 'folio.watchlist';
const DEFAULT_WATCHLIST = ['NIFTYBEES.NS', 'RELIANCE.NS', 'TCS.NS', 'AAPL', 'VTI'];

function readWatchlist(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? 'null');
    return Array.isArray(stored) && stored.every((s) => typeof s === 'string') ? stored : DEFAULT_WATCHLIST;
  } catch {
    return DEFAULT_WATCHLIST;
  }
}

/**
 * Watchlist kept in the browser until accounts exist; the watchlist_items
 * table is already in the schema for when it moves server-side.
 */
export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(readWatchlist);

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(symbols));
    } catch {
      // Storage can be unavailable (private mode); the list still works for this session.
    }
  }, [symbols]);

  const add = useCallback((symbol: string) => {
    setSymbols((current) => (current.includes(symbol) ? current : [...current, symbol]));
  }, []);
  const remove = useCallback((symbol: string) => {
    setSymbols((current) => current.filter((s) => s !== symbol));
  }, []);

  return { symbols, add, remove };
}
