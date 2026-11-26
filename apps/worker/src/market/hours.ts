// When each market trades, in UTC. NSE: 09:15 to 15:30 IST, which is 03:45 to
// 10:00 UTC all year. NYSE: 09:30 to 16:00 New York time, which is 13:30 to
// 20:00 UTC in summer and an hour later in winter; the window covers both.

export type Market = 'IN' | 'US';

const WINDOWS: Record<Market, [number, number]> = {
  IN: [3 * 60 + 45, 10 * 60],
  US: [13 * 60 + 30, 21 * 60],
};

/** Whether `market` is in its trading hours on a weekday. Exchange holidays are not modelled. */
export function marketOpen(market: Market, now: Date): boolean {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [open, close] = WINDOWS[market];
  return minutes >= open && minutes <= close;
}

/** Either exchange trading means some quotes move. */
export const marketsOpen = (now: Date): boolean => marketOpen('IN', now) || marketOpen('US', now);

// Indian indices on Yahoo: ^NSEI, ^NSEBANK, ^NSMIDCP, ^CNXIT, ^BSESN.
const INDIAN_INDEX = /^\^(NS|CNX|BSE)/;

/** The market a Yahoo symbol trades on: NSE and BSE listings and Indian indices, else US. */
export function marketOf(symbol: string): Market {
  return symbol.endsWith('.NS') || symbol.endsWith('.BO') || INDIAN_INDEX.test(symbol) ? 'IN' : 'US';
}
