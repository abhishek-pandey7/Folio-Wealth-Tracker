import { PERIODS } from '@folio/shared';
import { StarIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { FundTable, shortName } from '../components/FundTable.js';
import { ScreenTable } from '../components/ScreenTable.js';
import { Segmented } from '../components/Segmented.js';
import { useWatchlist } from '../hooks.js';
import { PERIOD_LABELS, pct, returnHeading, tone } from '../lib/format.js';
import { useFundScreen, useScreen } from '../lib/queries.js';
import { useScreenParams } from './DiscoverPage.js';
import { SkeletonRows } from './MarketsPage.js';

// The screener accepts up to 50 symbols per request.
const MAX_PER_SCREEN = 50;

interface Performer {
  key: string;
  label: string;
  href: string;
  value: number;
}

export function StarredPage() {
  const watchlist = useWatchlist();
  const { period, sort, order, update, onSort } = useScreenParams({ period: '1y', sort: 'return' });

  const symbols = watchlist.stocks.map((s) => s.symbol).slice(0, MAX_PER_SCREEN);
  const codes = watchlist.funds.flatMap((f) => (f.schemeCode ? [f.schemeCode] : [])).slice(0, MAX_PER_SCREEN);
  const stockScreen = useScreen({ symbols, period, sort, order, limit: 100 }, symbols.length > 0);
  const fundScreen = useFundScreen({ codes, period, sort, order, limit: 100 }, codes.length > 0);

  if (watchlist.isPending) {
    return (
      <div className="page">
        <SkeletonRows count={6} />
      </div>
    );
  }

  if (watchlist.items.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Starred</h1>
        </header>
        <section className="panel empty-state">
          <StarIcon size={28} className="muted" />
          <p className="strong">Nothing starred yet</p>
          <p className="muted">
            Star stocks, ETFs, indices or mutual funds anywhere in the app and they will collect here, with how each has
            done over the period you pick.
          </p>
          <div className="empty-actions">
            <Link to="/discover" className="button">
              Browse stocks
            </Link>
            <Link to="/funds" className="button secondary">
              Browse funds
            </Link>
          </div>
        </section>
      </div>
    );
  }

  // Best and worst across everything starred, for the chosen period.
  const performers: Performer[] = [
    ...(stockScreen.data?.rows ?? []).flatMap((r) => {
      const v = r.metrics.returns[period];
      return v === null
        ? []
        : [{ key: r.symbol, label: r.name, href: `/stock/${encodeURIComponent(r.symbol)}`, value: v }];
    }),
    ...(fundScreen.data?.rows ?? []).flatMap((r) => {
      const v = r.metrics.returns[period];
      return v === null
        ? []
        : [{ key: r.schemeCode, label: shortName(r.name), href: `/fund/${r.schemeCode}`, value: v }];
    }),
  ].sort((a, b) => b.value - a.value);
  const best = performers[0];
  const worst = performers.length > 1 ? performers.at(-1) : undefined;
  const average = performers.length ? performers.reduce((sum, p) => sum + p.value, 0) / performers.length : null;

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Starred</h1>
          <p className="muted">
            {watchlist.stocks.length} {watchlist.stocks.length === 1 ? 'stock or ETF' : 'stocks and ETFs'},{' '}
            {watchlist.funds.length} {watchlist.funds.length === 1 ? 'fund' : 'funds'}
          </p>
        </div>
        <Segmented
          label="Period"
          value={period}
          options={PERIODS}
          onChange={(p) => update({ period: p })}
          format={(p) => PERIOD_LABELS[p]}
        />
      </header>

      <div className="summary-grid">
        <SummaryCard title={`Best over ${PERIOD_LABELS[period]}`} performer={best} />
        <SummaryCard title={`Worst over ${PERIOD_LABELS[period]}`} performer={worst} />
        <div className="summary-card">
          <span className="muted small">Average {returnHeading(period).toLowerCase()}</span>
          <span className={`figure ${tone(average)}`}>{pct(average)}</span>
          <span className="muted small">Equal weight across {performers.length} starred</span>
        </div>
      </div>

      {watchlist.stocks.length > 0 && (
        <section className="panel" aria-label="Starred stocks">
          <header className="panel-head">
            <h2>Stocks, ETFs and indices</h2>
          </header>
          {stockScreen.isPending ? (
            <SkeletonRows count={Math.min(symbols.length, 6)} />
          ) : stockScreen.error ? (
            <p className="inline-error">{stockScreen.error.message}</p>
          ) : (
            <ScreenTable rows={stockScreen.data.rows} period={period} sortState={{ sort, order, onSort }} />
          )}
        </section>
      )}

      {watchlist.funds.length > 0 && (
        <section className="panel" aria-label="Starred funds">
          <header className="panel-head">
            <h2>Mutual funds</h2>
          </header>
          {fundScreen.isPending ? (
            <SkeletonRows count={Math.min(codes.length, 6)} />
          ) : fundScreen.error ? (
            <p className="inline-error">{fundScreen.error.message}</p>
          ) : (
            <FundTable rows={fundScreen.data.rows} period={period} sortState={{ sort, order, onSort }} />
          )}
        </section>
      )}
    </div>
  );
}

function SummaryCard({ title, performer }: { title: string; performer: Performer | undefined }) {
  return (
    <div className="summary-card">
      <span className="muted small">{title}</span>
      {performer ? (
        <>
          <span className={`figure ${tone(performer.value)}`}>{pct(performer.value)}</span>
          <Link to={performer.href} className="truncate">
            {performer.label}
          </Link>
        </>
      ) : (
        <span className="muted">Not enough history</span>
      )}
    </div>
  );
}
