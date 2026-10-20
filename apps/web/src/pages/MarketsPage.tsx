import type { Period, Universe } from '@folio/shared';
import { ArrowRightIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { IndexStrip } from '../components/IndexStrip.js';
import { ScreenTable } from '../components/ScreenTable.js';
import { Segmented } from '../components/Segmented.js';
import { StarButton } from '../components/StarButton.js';
import { isIndexSymbol, PERIOD_LABELS, pct, price, tone } from '../lib/format.js';
import { useScreen, useUniverses } from '../lib/queries.js';

const REGIONS = { India: 'in-large', US: 'us-large' } as const;
type Region = keyof typeof REGIONS;

const TOP_UNIVERSES = ['in-large', 'in-mid', 'us-large', 'in-etf', 'us-etf'] as const;
const TOP_PERIODS = ['1m', '3m', '6m', '1y', '3y', '5y'] as const satisfies readonly Period[];

export function MarketsPage() {
  return (
    <div className="page">
      <IndexStrip />
      <div className="grid-2">
        <Movers order="best" title="Top gainers today" />
        <Movers order="worst" title="Top losers today" />
      </div>
      <TopPerformers />
      <SteadyPerformers />
      <CategoryGrid />
    </div>
  );
}

function Movers({ order, title }: { order: 'best' | 'worst'; title: string }) {
  const [region, setRegion] = useState<Region>('India');
  const screen = useScreen({ universe: REGIONS[region], period: '1d', sort: 'return', order, limit: 5 });

  return (
    <section className="panel" aria-label={title}>
      <header className="panel-head">
        <h2>{title}</h2>
        <Segmented label="Region" value={region} options={Object.keys(REGIONS) as Region[]} onChange={setRegion} />
      </header>
      {screen.isPending ? (
        <SkeletonRows count={5} />
      ) : screen.error ? (
        <p className="inline-error">{screen.error.message}</p>
      ) : (
        <ul className="mover-list">
          {screen.data.rows.map((row) => (
            <li key={row.symbol}>
              <Link to={`/stock/${encodeURIComponent(row.symbol)}`}>
                <span className="mover-name">
                  <span className="mono strong">{row.symbol}</span>
                  <span className="row-sub truncate">{row.name}</span>
                </span>
                <span className="mono">{price(row.price, row.currency, isIndexSymbol(row.symbol))}</span>
                <span className={`mono strong mover-change ${tone(row.changePercent)}`}>{pct(row.changePercent)}</span>
              </Link>
              <StarButton target={{ kind: 'symbol', symbol: row.symbol, name: row.name }} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TopPerformers() {
  const universes = useUniverses();
  const [universe, setUniverse] = useState<(typeof TOP_UNIVERSES)[number]>('in-large');
  const [period, setPeriod] = useState<(typeof TOP_PERIODS)[number]>('1y');
  const screen = useScreen({ universe, period, sort: 'return', order: 'best', limit: 10 });
  const names = new Map(universes.data?.map((u) => [u.id, u.name]));

  return (
    <section className="panel" aria-label="Best performers">
      <header className="panel-head wrap">
        <h2>Best performers</h2>
        <Segmented
          label="Period"
          value={period}
          options={TOP_PERIODS}
          onChange={setPeriod}
          format={(p) => PERIOD_LABELS[p]}
        />
      </header>
      <div className="pill-row" role="tablist" aria-label="Category">
        {TOP_UNIVERSES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === universe}
            className="pill"
            onClick={() => setUniverse(id)}
          >
            {names.get(id) ?? id}
          </button>
        ))}
      </div>
      {screen.isPending ? (
        <SkeletonRows count={6} />
      ) : screen.error ? (
        <p className="inline-error">{screen.error.message}</p>
      ) : (
        <ScreenTable rows={screen.data.rows} period={period} compact rank />
      )}
      <Link to={`/discover/${universe}?period=${period}`} className="more-link">
        See all of {names.get(universe) ?? 'this category'} <ArrowRightIcon size={14} />
      </Link>
    </section>
  );
}

function SteadyPerformers() {
  const screen = useScreen({ universe: 'in-large', period: '1y', sort: 'risk_adjusted', order: 'best', limit: 6 });

  return (
    <section className="panel" aria-label="Steady performers">
      <header className="panel-head">
        <div>
          <h2>Steady performers</h2>
          <p className="muted small">
            India large caps with the most return for each unit of volatility over the last year.
          </p>
        </div>
      </header>
      {screen.isPending ? (
        <SkeletonRows count={6} />
      ) : screen.error ? (
        <p className="inline-error">{screen.error.message}</p>
      ) : (
        <ScreenTable rows={screen.data.rows} period="1y" rank />
      )}
      <Link to="/discover/in-large?sort=risk_adjusted" className="more-link">
        Rank every category by consistency <ArrowRightIcon size={14} />
      </Link>
    </section>
  );
}

function CategoryGrid() {
  const universes = useUniverses();
  const groups = new Map<string, Universe[]>();
  for (const u of universes.data ?? []) {
    groups.set(u.group, [...(groups.get(u.group) ?? []), u]);
  }

  return (
    <section aria-label="Browse categories">
      <h2 className="section-title">Browse by category</h2>
      {universes.isPending && <SkeletonRows count={3} />}
      {[...groups].map(([group, list]) => (
        <div key={group} className="category-group">
          <h3>{group}</h3>
          <div className="category-grid">
            {list.map((u) => (
              <Link key={u.id} to={`/discover/${u.id}`} className="category-card">
                <span className="strong">{u.name}</span>
                <span className="muted small">{u.count} listed</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="skeleton-rows" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <span key={i} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}
