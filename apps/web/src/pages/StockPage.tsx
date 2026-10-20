import { ArrowLeftIcon } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router';
import { PositionPanel } from '../components/PositionPanel.js';
import { PriceChart } from '../components/PriceChart.js';
import { StarButton } from '../components/StarButton.js';
import { ReturnsStrip, RiskPanel } from '../components/StatGrid.js';
import { isIndexSymbol, pct, price, tone } from '../lib/format.js';
import { useQuote, useStats } from '../lib/queries.js';
import { SkeletonRows } from './MarketsPage.js';

export function StockPage() {
  const { symbol = '' } = useParams();
  const stats = useStats(symbol);
  const quote = useQuote(symbol);
  const isIndex = isIndexSymbol(symbol);

  const live = quote.data;
  const currentPrice = live?.price ?? stats.data?.price;
  const currency = live?.currency ?? stats.data?.currency;
  const change = live ? Number(live.changePercent) : (stats.data?.metrics.returns['1d'] ?? null);

  return (
    <div className="page">
      <Link to="/discover" className="back-link">
        <ArrowLeftIcon size={14} /> Discover
      </Link>

      <header className="detail-head">
        <div>
          <h1>{stats.data?.name ?? symbol}</h1>
          <p className="detail-meta">
            <span className="mono">{symbol}</span>
            {stats.data?.exchange && <span>{stats.data.exchange}</span>}
            {stats.data?.sector && <span className="tag">{stats.data.sector}</span>}
            {isIndex && <span className="tag">Index</span>}
          </p>
        </div>
        <div className="detail-price">
          {currentPrice && currency ? (
            <>
              <span className="figure">{price(currentPrice, currency, isIndex)}</span>
              <span className={`mono ${tone(change)}`}>{pct(change)} today</span>
              {live?.stale && <span className="tag warn">delayed</span>}
            </>
          ) : (
            <span className="skeleton" style={{ width: '8rem', height: '1.75rem' }} />
          )}
          <StarButton target={{ kind: 'symbol', symbol, name: stats.data?.name }} label />
        </div>
      </header>

      {stats.error && <p className="inline-error">{stats.error.message}</p>}

      {!isIndex && (
        <PositionPanel
          instrumentKey={stats.data?.symbol ?? symbol}
          picked={{
            ref: { kind: 'symbol', symbol, name: stats.data?.name },
            label: stats.data ? `${symbol}, ${stats.data.name}` : symbol,
          }}
        />
      )}

      <PriceChart source={{ kind: 'symbol', symbol }} isIndex={isIndex} />

      {stats.isPending ? (
        <SkeletonRows count={4} />
      ) : (
        stats.data && (
          <div className="grid-2">
            <ReturnsStrip metrics={stats.data.metrics} />
            <RiskPanel
              metrics={stats.data.metrics}
              range52w={{
                low: stats.data.low52w,
                high: stats.data.high52w,
                current: Number(currentPrice ?? stats.data.price),
                fromHigh: stats.data.fromHigh52w,
              }}
            />
          </div>
        )
      )}
      <p className="disclaimer">
        Past performance, computed from adjusted daily closes. Not a forecast or a recommendation.
      </p>
    </div>
  );
}
