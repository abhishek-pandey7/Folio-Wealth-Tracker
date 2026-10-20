import { BatchQuotesSchema, Decimal, formatMoney, formatPercent } from '@folio/shared';
import { XIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '../api.js';

interface Props {
  symbols: string[];
  selected: string | undefined;
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

export function Watchlist({ symbols, selected, onSelect, onRemove }: Props) {
  // One batched request for the whole list; the gateway fans it out concurrently.
  const { data, error, isPending, dataUpdatedAt } = useQuery({
    queryKey: ['quotes', symbols],
    queryFn: () => getJson(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`, BatchQuotesSchema),
    enabled: symbols.length > 0,
    refetchInterval: 15_000,
  });

  if (symbols.length === 0) {
    return (
      <div className="empty">
        <p className="strong">Nothing on your watchlist yet</p>
        <p className="muted">Search for a stock, ETF or index above to start tracking it.</p>
      </div>
    );
  }

  const quotes = new Map(data?.quotes.map((q) => [q.symbol, q]));

  return (
    <>
      {error && <p className="inline-error">{error.message}</p>}
      <table className="watchlist">
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col" className="num">
              Price
            </th>
            <th scope="col" className="num col-change">
              Today
            </th>
            <th scope="col">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((symbol) => {
            const quote = quotes.get(symbol);
            const failure = data?.errors[symbol];
            const up = quote ? !new Decimal(quote.change).isNegative() : true;
            return (
              <tr
                key={symbol}
                className={symbol === selected ? 'selected' : undefined}
                onClick={() => onSelect(symbol)}
                onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onSelect(symbol)}
                tabIndex={0}
                aria-selected={symbol === selected}
              >
                <td>
                  <span className="mono strong">{symbol}</span>
                  {quote?.stale && (
                    <span className="tag warn" title="The live source failed, so this is the last good price">
                      delayed
                    </span>
                  )}
                </td>
                <td className="num">
                  {quote ? (
                    <>
                      {formatMoney(quote.price, quote.currency)}
                      {/* Narrow screens drop the Today column and show the change under the price. */}
                      <span className={`change-inline ${up ? 'up' : 'down'}`}>
                        {up ? '+' : ''}
                        {formatPercent(quote.changePercent)}
                      </span>
                    </>
                  ) : isPending ? (
                    <span className="skeleton" style={{ width: '5.5rem' }} />
                  ) : (
                    <span className="muted">n/a</span>
                  )}
                </td>
                <td className={`num col-change ${quote ? (up ? 'up' : 'down') : ''}`}>
                  {quote ? (
                    `${up ? '+' : ''}${formatPercent(quote.changePercent)}`
                  ) : isPending ? (
                    <span className="skeleton" style={{ width: '3.5rem' }} />
                  ) : (
                    failure && (
                      <span className="muted" title={failure}>
                        unavailable
                      </span>
                    )
                  )}
                </td>
                <td className="row-action">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${symbol}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(symbol);
                    }}
                  >
                    <XIcon size={14} weight="bold" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {dataUpdatedAt > 0 && (
        <p className="footnote">Updated {new Date(dataUpdatedAt).toLocaleTimeString()}, refreshes every 15s</p>
      )}
    </>
  );
}
