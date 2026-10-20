import { formatMoney } from '@folio/shared';
import { PlusIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { pct, tone } from '../lib/format.js';
import { usePortfolio } from '../lib/portfolio.js';
import { type PickedInstrument, TransactionDialog } from './TransactionDialog.js';

/** On a stock or fund page: what you own of it, and a shortcut to record a trade. */
export function PositionPanel({ instrumentKey, picked }: { instrumentKey: string; picked: PickedInstrument }) {
  const portfolio = usePortfolio();
  const [open, setOpen] = useState(false);
  const holding = portfolio.data?.holdings.find((h) => h.instrumentKey === instrumentKey);

  return (
    <section className="panel position-panel" aria-label="Your position">
      {holding ? (
        <dl className="position-facts">
          <div>
            <dt>You own</dt>
            <dd className="mono">{Number(holding.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })}</dd>
          </div>
          <div>
            <dt>Average cost</dt>
            <dd className="mono">{formatMoney(holding.avgCost, holding.currency)}</dd>
          </div>
          <div>
            <dt>Value</dt>
            <dd className="mono">{formatMoney(holding.valueInr, 'INR')}</dd>
          </div>
          <div>
            <dt>Profit</dt>
            <dd className={`mono ${tone(holding.unrealizedPct)}`}>
              {formatMoney(holding.unrealizedInr, 'INR')} ({pct(holding.unrealizedPct)})
            </dd>
          </div>
        </dl>
      ) : (
        <p className="muted">
          You don't own this yet. <Link to="/portfolio">Your portfolio</Link> updates as soon as you record a buy.
        </p>
      )}
      <button type="button" className="button secondary" onClick={() => setOpen(true)}>
        <PlusIcon size={14} weight="bold" /> Record a trade
      </button>
      <TransactionDialog open={open} onClose={() => setOpen(false)} initialInstrument={picked} />
    </section>
  );
}
