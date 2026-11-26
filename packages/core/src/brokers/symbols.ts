import type { AssetClass } from '@folio/shared';

// NSE series suffixes some brokers append (Angel One sends RELIANCE-EQ); Yahoo has none.
const SERIES = /-(EQ|BE|BZ|BL|SM|ST|GB|IV|RR)$/;
const INDIAN = /^[A-Z0-9][A-Z0-9&-]{0,16}$/;
// Yahoo writes US share classes with a dash (BRK-B); brokers often use a dot (BRK.B).
const US = /^[A-Z][A-Z0-9-]{0,9}$/;

/**
 * The Yahoo symbol Folio prices a broker holding under: NSE listings end in
 * .NS, BSE-only ones in .BO, US tickers have no suffix. Returns null for
 * anything that cannot be a listed symbol, so it is reported, not stored.
 */
export function yahooSymbol(tradingSymbol: string, exchange: string): string | null {
  const raw = tradingSymbol.trim().toUpperCase();
  const market = exchange.trim().toUpperCase();
  if (market === 'US' || market === 'NASDAQ' || market === 'NYSE') {
    const ticker = raw.replace('.', '-');
    return US.test(ticker) ? ticker : null;
  }
  const base = raw.replace(SERIES, '');
  if (!INDIAN.test(base)) return null;
  return `${base}${market.startsWith('BSE') ? '.BO' : '.NS'}`;
}

/** Brokers do not say what a holding is; the symbol usually does. */
export function assetClassOf(symbol: string): AssetClass {
  const base = symbol.replace(/\.(NS|BO)$/, '');
  if (base.startsWith('SGB')) return 'gold'; // Sovereign Gold Bonds
  if (base.endsWith('BEES') || base.includes('ETF')) return 'etf';
  return 'equity';
}
