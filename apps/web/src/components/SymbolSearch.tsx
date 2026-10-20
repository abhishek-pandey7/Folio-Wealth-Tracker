import { type SymbolMatch, SymbolMatchSchema } from '@folio/shared';
import { MagnifyingGlassIcon, StarIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { z } from 'zod';
import { getJson } from '../api.js';
import { useDebounced } from '../hooks.js';

const TYPE_LABELS = { equity: 'Stock', etf: 'ETF', mutual_fund: 'Fund', index: 'Index' } as const;

interface Props {
  isStarred: (symbol: string) => boolean;
  onPick: (match: SymbolMatch) => void;
}

export function SymbolSearch({ isStarred, onPick }: Props) {
  const id = useId();
  const [text, setText] = useState('');
  const query = useDebounced(text.trim());
  const open = query.length >= 2 && text.trim().length > 0;

  const { data, isFetching, error } = useQuery({
    queryKey: ['search', query],
    queryFn: () => getJson(`/api/market/search?q=${encodeURIComponent(query)}`, z.array(SymbolMatchSchema)),
    enabled: query.length >= 2,
    staleTime: 60 * 60_000,
  });

  function pick(match: SymbolMatch) {
    onPick(match);
    setText('');
  }

  return (
    <div className="field">
      <label htmlFor={id}>Find and star a symbol</label>
      <div className="search">
        <MagnifyingGlassIcon className="search-icon" size={16} aria-hidden />
        <input
          id={id}
          type="search"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && setText('')}
          placeholder="Reliance, Nifty BeES, Apple"
        />
        {open && (
          <ul className="search-results">
            {isFetching && !data && <li className="search-note">Searching</li>}
            {error && <li className="search-note error">{error.message}</li>}
            {data?.length === 0 && <li className="search-note">No matches for "{query}"</li>}
            {data?.map((match) => {
              const starred = isStarred(match.symbol);
              return (
                <li key={match.symbol}>
                  <button type="button" onClick={() => pick(match)}>
                    <span className="mono strong">{match.symbol}</span>
                    <span className="truncate muted">{match.name}</span>
                    <span className="tag">
                      {match.exchange} {TYPE_LABELS[match.type]}
                    </span>
                    <StarIcon
                      className={starred ? 'result-star on' : 'result-star'}
                      size={15}
                      weight={starred ? 'fill' : 'regular'}
                      aria-label={starred ? 'Starred' : 'Not starred'}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
