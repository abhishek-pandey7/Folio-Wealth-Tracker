import { useState } from 'react';
import { FundLookup } from './components/FundLookup.js';
import { PriceChart } from './components/PriceChart.js';
import { StatusBar } from './components/StatusBar.js';
import { SymbolSearch } from './components/SymbolSearch.js';
import { Watchlist } from './components/Watchlist.js';
import { useWatchlist } from './hooks.js';

export function App() {
  const watchlist = useWatchlist();
  const [selected, setSelected] = useState<string | undefined>(watchlist.symbols[0]);
  const active = selected && watchlist.symbols.includes(selected) ? selected : watchlist.symbols[0];

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
            onPick={(symbol) => {
              watchlist.add(symbol);
              setSelected(symbol);
            }}
          />
          <Watchlist symbols={watchlist.symbols} selected={active} onSelect={setSelected} onRemove={watchlist.remove} />
        </section>

        {active ? (
          <PriceChart symbol={active} />
        ) : (
          <section className="panel chart-panel empty">
            <p className="strong">No symbol selected</p>
            <p className="muted">Add something to your watchlist to see its price history.</p>
          </section>
        )}

        <FundLookup />
      </main>
    </div>
  );
}
