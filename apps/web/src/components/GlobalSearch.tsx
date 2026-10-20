import { FundMatchSchema, SymbolMatchSchema } from '@folio/shared';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { getJson } from '../api.js';
import { useDebounced } from '../hooks.js';
import { shortName } from './FundTable.js';

const TYPE_LABELS = { equity: 'Stock', etf: 'ETF', mutual_fund: 'Fund', index: 'Index' } as const;

/** One search box for everything: stocks, ETFs and indices from Yahoo, mutual funds from AMFI. */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const query = useDebounced(text.trim());
  const enabled = query.length >= 2;

  const symbols = useQuery({
    queryKey: ['search', query],
    queryFn: () => getJson(`/api/market/search?q=${encodeURIComponent(query)}`, z.array(SymbolMatchSchema)),
    enabled,
    staleTime: 60 * 60_000,
  });
  const funds = useQuery({
    queryKey: ['fund-search', query],
    queryFn: () => getJson(`/api/market/funds/search?q=${encodeURIComponent(query)}`, z.array(FundMatchSchema)),
    enabled,
    staleTime: 60 * 60_000,
  });

  // Yahoo lists mutual funds under odd codes; fund results come from AMFI instead.
  const stockResults = (symbols.data ?? []).filter((m) => m.type !== 'mutual_fund').slice(0, 6);
  const fundResults = (funds.data ?? []).filter((f) => /direct/i.test(f.name) && /growth/i.test(f.name)).slice(0, 5);

  function go(path: string) {
    navigate(path);
    setText('');
    setOpen(false);
  }

  const first = stockResults[0]
    ? `/stock/${encodeURIComponent(stockResults[0].symbol)}`
    : fundResults[0]
      ? `/fund/${fundResults[0].schemeCode}`
      : undefined;

  return (
    <div className="search global-search">
      <MagnifyingGlassIcon className="search-icon" size={16} aria-hidden />
      <input
        type="search"
        autoComplete="off"
        aria-label="Search stocks, ETFs and mutual funds"
        placeholder="Search stocks, ETFs, funds"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay closing so a click on a result lands before the list disappears.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setText('');
            setOpen(false);
          }
          if (event.key === 'Enter' && first) {
            go(first);
          }
        }}
      />
      {open && enabled && (
        <div className="search-results">
          <p className="search-group">Stocks, ETFs and indices</p>
          {symbols.isFetching && !symbols.data && <p className="search-note">Searching</p>}
          {symbols.data && stockResults.length === 0 && <p className="search-note">No matches</p>}
          {stockResults.map((m) => (
            <button key={m.symbol} type="button" onClick={() => go(`/stock/${encodeURIComponent(m.symbol)}`)}>
              <span className="mono strong">{m.symbol}</span>
              <span className="truncate muted">{m.name}</span>
              <span className="tag">
                {m.exchange} {TYPE_LABELS[m.type]}
              </span>
            </button>
          ))}
          <p className="search-group">Mutual funds</p>
          {funds.isFetching && !funds.data && <p className="search-note">Searching</p>}
          {funds.data && fundResults.length === 0 && <p className="search-note">No direct growth plans match</p>}
          {fundResults.map((f) => (
            <button key={f.schemeCode} type="button" onClick={() => go(`/fund/${f.schemeCode}`)}>
              <span className="truncate">{shortName(f.name)}</span>
              <span />
              <span className="tag">Fund</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
