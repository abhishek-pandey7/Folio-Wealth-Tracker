import { FxRateSchema } from '@folio/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { getJson } from '../api.js';
import { pct, price, tone } from '../lib/format.js';
import { useQuotes } from '../lib/queries.js';

const INDICES: { symbol: string; label: string }[] = [
  { symbol: '^NSEI', label: 'NIFTY 50' },
  { symbol: '^BSESN', label: 'SENSEX' },
  { symbol: '^NSEBANK', label: 'NIFTY BANK' },
  { symbol: '^CNXIT', label: 'NIFTY IT' },
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'NASDAQ' },
];

/** The morning glance: headline indices and the rupee. */
export function IndexStrip() {
  const quotes = useQuotes(INDICES.map((i) => i.symbol));
  const fx = useQuery({
    queryKey: ['fx', 'USD', 'INR'],
    queryFn: () => getJson('/api/market/fx?base=USD&quote=INR', FxRateSchema),
    staleTime: 30 * 60_000,
  });
  const bySymbol = new Map(quotes.data?.quotes.map((q) => [q.symbol, q]));

  return (
    <section className="index-strip" aria-label="Market indices">
      {INDICES.map(({ symbol, label }) => {
        const q = bySymbol.get(symbol);
        const change = q ? Number(q.changePercent) : null;
        return (
          <Link key={symbol} to={`/stock/${encodeURIComponent(symbol)}`} className="index-card">
            <span className="index-name">{label}</span>
            {q ? (
              <>
                <span className="mono strong">{price(q.price, q.currency, true)}</span>
                <span className={`mono small ${tone(change)}`}>{pct(change)}</span>
              </>
            ) : (
              <>
                <span className="skeleton" style={{ width: '6rem' }} />
                <span className="skeleton" style={{ width: '3rem' }} />
              </>
            )}
          </Link>
        );
      })}
      <div className="index-card">
        <span className="index-name">USD/INR</span>
        {fx.data ? (
          <>
            <span className="mono strong">₹{Number(fx.data.rate).toFixed(2)}</span>
            <span className="muted small">ECB, {fx.data.date}</span>
          </>
        ) : (
          <span className="skeleton" style={{ width: '5rem' }} />
        )}
      </div>
    </section>
  );
}
