import { useState } from 'react';
import { FundLookup } from './components/FundLookup.js';
import { PriceChart } from './components/PriceChart.js';
import { StatusBar } from './components/StatusBar.js';
import { SymbolSearch } from './components/SymbolSearch.js';
import { Watchlist } from './components/Watchlist.js';
import { useWatchlist } from './hooks.js';

export function App() {
  const watchlist = useWatchlist();
  // Selection is independent of starring: unstarring the open chart keeps it open so it can be re-starred.
  const [selected, setSelected] = useState<string | undefined>();
  const active = selected ?? watchlist.items[0]?.symbol;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          folio<span className="brand-dot">.</span>
        </span>
        <StatusBar />
      </header>

      <main className="layout">
        <section className="panel watch" aria-label="Watchlist">
          <header className="panel-head">
            <h2>Watchlist</h2>
            <span className="muted small">NSE, BSE and US</span>
          </header>
          <SymbolSearch
            isStarred={watchlist.isStarred}
            onPick={(match) => {
              if (!watchlist.isStarred(match.symbol)) {
                watchlist.star(match);
              }
              setSelected(match.symbol);
            }}
          />
          {watchlist.error && <p className="inline-error">{watchlist.error.message}</p>}
          <Watchlist items={watchlist.items} loading={watchlist.isPending} selected={active} onSelect={setSelected} />
        </section>

        {active ? (
          <PriceChart symbol={active} />
        ) : (
          <section className="panel chart-panel empty">
            <p className="strong">No symbol selected</p>
            <p className="muted">Star something to see its price history here.</p>
          </section>
        )}

        <FundLookup />
      </main>
    </div>
  );
}
