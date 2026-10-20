import { FundMatchSchema, FundSchema, formatMoney } from '@folio/shared';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { z } from 'zod';
import { getJson } from '../api.js';
import { useDebounced } from '../hooks.js';

// Parag Parikh Flexi Cap (Direct, Growth): a common first fund, so the panel is never empty.
const DEFAULT_SCHEME = '122639';

export function FundLookup() {
  const id = useId();
  const [text, setText] = useState('');
  const [schemeCode, setSchemeCode] = useState(DEFAULT_SCHEME);
  const query = useDebounced(text.trim());
  const open = query.length >= 2 && text.trim().length > 0;

  const search = useQuery({
    queryKey: ['fund-search', query],
    queryFn: () => getJson(`/api/market/funds/search?q=${encodeURIComponent(query)}`, z.array(FundMatchSchema)),
    enabled: query.length >= 2,
    staleTime: 60 * 60_000,
  });

  const fund = useQuery({
    queryKey: ['fund', schemeCode],
    queryFn: () => getJson(`/api/market/funds/${schemeCode}`, FundSchema),
    staleTime: 30 * 60_000,
  });

  return (
    <section className="panel funds" aria-labelledby={`${id}-title`}>
      <header className="panel-head">
        <h2 id={`${id}-title`}>Mutual funds</h2>
        <span className="muted small">Daily NAV published by AMFI</span>
      </header>

      <div className="funds-body">
        <div className="field">
          <label htmlFor={id}>Find a scheme</label>
          <div className="search">
            <MagnifyingGlassIcon className="search-icon" size={16} aria-hidden />
            <input
              id={id}
              type="search"
              autoComplete="off"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setText('')}
              placeholder="Parag Parikh flexi cap, Nifty 50 index"
            />
            {open && (
              <ul className="search-results search-results-funds">
                {search.isFetching && !search.data && <li className="search-note">Searching</li>}
                {search.data?.length === 0 && <li className="search-note">No schemes match "{query}"</li>}
                {search.data?.map((match) => (
                  <li key={match.schemeCode}>
                    <button
                      type="button"
                      onClick={() => {
                        setSchemeCode(match.schemeCode);
                        setText('');
                      }}
                    >
                      <span className="truncate">{match.name}</span>
                      <span className="tag mono">{match.schemeCode}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {fund.error && <p className="inline-error">{fund.error.message}</p>}
        {fund.isPending && <div className="skeleton fund-skeleton" />}
        {fund.data && (
          <div className="fund">
            <p className="fund-name">{fund.data.name}</p>
            <dl className="fund-facts">
              <div>
                <dt>NAV</dt>
                <dd className="figure">{formatMoney(fund.data.nav, 'INR')}</dd>
              </div>
              <div>
                <dt>As of</dt>
                <dd>{fund.data.navDate}</dd>
              </div>
              <div>
                <dt>Fund house</dt>
                <dd>{fund.data.fundHouse}</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{fund.data.category.replace(/^Equity Scheme - /, '')}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
