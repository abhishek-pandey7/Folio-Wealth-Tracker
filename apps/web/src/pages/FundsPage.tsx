import { FundMatchSchema } from '@folio/shared';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { getJson } from '../api.js';
import { FundTable, shortName } from '../components/FundTable.js';
import { Segmented } from '../components/Segmented.js';
import { useDebounced } from '../hooks.js';
import { PERIOD_LABELS } from '../lib/format.js';
import { useFundCategories, useFundScreen } from '../lib/queries.js';
import { useScreenParams } from './DiscoverPage.js';
import { SkeletonRows } from './MarketsPage.js';

const FUND_PERIODS = ['1y', '3y', '5y'] as const;

export function FundsPage() {
  const { categoryId = 'flexi-cap' } = useParams();
  const categories = useFundCategories();
  const { period, sort, order, update, onSort } = useScreenParams({ period: '3y', sort: 'return' });
  const fundPeriod = (FUND_PERIODS as readonly string[]).includes(period)
    ? (period as (typeof FUND_PERIODS)[number])
    : '3y';
  const screen = useFundScreen({ category: categoryId, period: fundPeriod, sort, order, limit: 100 });
  const current = categories.data?.find((c) => c.id === categoryId);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Mutual funds</h1>
        <p className="muted">
          Direct growth plans only: no distributor commission, and gains stay invested, so returns are comparable.
        </p>
      </header>

      <FundSearch />

      <div className="pill-row" role="tablist" aria-label="Fund category">
        {(categories.data ?? []).map((c) => (
          <Link
            key={c.id}
            to={`/funds/${c.id}?period=${fundPeriod}&sort=${sort}&order=${order}`}
            role="tab"
            aria-selected={c.id === categoryId}
            className="pill"
          >
            {c.name}
            <span className="muted">{c.count}</span>
          </Link>
        ))}
      </div>

      <section className="panel" aria-label={current?.name ?? 'Funds'}>
        <header className="panel-head wrap">
          <div>
            <h2>{current?.name ?? 'Funds'}</h2>
            {current && <p className="muted small">{current.description}</p>}
          </div>
          <Segmented
            label="Compare over"
            value={fundPeriod}
            options={FUND_PERIODS}
            onChange={(p) => update({ period: p })}
            format={(p) => PERIOD_LABELS[p]}
          />
        </header>
        {screen.isPending ? (
          <>
            <p className="muted small">Ranking every fund in this category. The first load can take a few seconds.</p>
            <SkeletonRows count={8} />
          </>
        ) : screen.error ? (
          <p className="inline-error">{screen.error.message}</p>
        ) : (
          <FundTable rows={screen.data.rows} period={fundPeriod} sortState={{ sort, order, onSort }} rank />
        )}
      </section>
      <p className="disclaimer">
        Returns from AMFI's published NAVs; 3Y and 5Y are annualized. Past performance does not predict future returns.
      </p>
    </div>
  );
}

function FundSearch() {
  const id = useId();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const query = useDebounced(text.trim());
  const results = useQuery({
    queryKey: ['fund-search', query],
    queryFn: () => getJson(`/api/market/funds/search?q=${encodeURIComponent(query)}`, z.array(FundMatchSchema)),
    enabled: query.length >= 2,
    staleTime: 60 * 60_000,
  });
  const matches = (results.data ?? []).filter((f) => /direct/i.test(f.name) && /growth/i.test(f.name));

  return (
    <div className="field fund-search">
      <label htmlFor={id}>Find a specific fund</label>
      <div className="search">
        <MagnifyingGlassIcon className="search-icon" size={16} aria-hidden />
        <input
          id={id}
          type="search"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setText('')}
          placeholder="Parag Parikh flexi cap, UTI Nifty 50"
        />
        {query.length >= 2 && text && (
          <div className="search-results">
            {results.isFetching && !results.data && <p className="search-note">Searching</p>}
            {results.data && matches.length === 0 && <p className="search-note">No direct growth plans match</p>}
            {matches.map((f) => (
              <button key={f.schemeCode} type="button" onClick={() => navigate(`/fund/${f.schemeCode}`)}>
                <span className="truncate">{shortName(f.name)}</span>
                <span className="tag mono">{f.schemeCode}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
