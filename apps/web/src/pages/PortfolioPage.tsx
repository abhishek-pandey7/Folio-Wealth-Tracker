import { type Account, formatMoney, type Holding, type PortfolioSummary } from '@folio/shared';
import { PlusIcon, TrashIcon, WalletIcon } from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AllocationBar } from '../components/AllocationBar.js';
import { shortName } from '../components/FundTable.js';
import { Segmented } from '../components/Segmented.js';
import { TransactionDialog } from '../components/TransactionDialog.js';
import { pct, tone } from '../lib/format.js';
import {
  useAccounts,
  useCreateAccount,
  useDeleteAccount,
  useDeleteTransaction,
  usePortfolio,
  useTransactions,
} from '../lib/portfolio.js';
import { SkeletonRows } from './MarketsPage.js';

const inr = (v: string) => formatMoney(v, 'INR');
const signedInr = (v: string) => `${Number(v) > 0 ? '+' : ''}${inr(v)}`;

export function PortfolioPage() {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<string>('all');
  const filter = accountId === 'all' ? undefined : accountId;
  const portfolio = usePortfolio(filter);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (accounts.isPending) {
    return (
      <div className="page">
        <SkeletonRows count={6} />
      </div>
    );
  }

  if (accounts.data?.length === 0) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Portfolio</h1>
        </header>
        <section className="panel empty-state">
          <WalletIcon size={28} className="muted" />
          <p className="strong">Start with a broker account</p>
          <p className="muted">
            Add each place you invest (Zerodha, Groww, Coin, a US broker). Then record buys, sells and dividends, and
            Folio works out your holdings, profit and XIRR from them.
          </p>
          <AccountForm />
        </section>
      </div>
    );
  }

  const options = ['all', ...(accounts.data ?? []).map((a) => a.id)];
  const names = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));
  const summary = portfolio.data;

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Portfolio</h1>
          <p className="muted">Live value in rupees, from every buy, sell and dividend you have recorded.</p>
        </div>
        <button type="button" className="button" onClick={() => setDialogOpen(true)}>
          <PlusIcon size={16} weight="bold" /> Add transaction
        </button>
      </header>

      {options.length > 2 && (
        <Segmented
          label="Account"
          value={accountId}
          options={options}
          onChange={setAccountId}
          format={(id) => (id === 'all' ? 'All accounts' : (names.get(id) ?? id))}
        />
      )}

      {portfolio.error && <p className="inline-error">{portfolio.error.message}</p>}
      {portfolio.isPending || !summary ? (
        <SkeletonRows count={5} />
      ) : summary.transactionCount === 0 ? (
        <section className="panel empty-state">
          <p className="strong">No transactions yet</p>
          <p className="muted">
            Record what you already own as buys on the dates you bought them, so returns are accurate.
          </p>
          <button type="button" className="button" onClick={() => setDialogOpen(true)}>
            Add your first transaction
          </button>
        </section>
      ) : (
        <>
          <Totals summary={summary} />
          <div className="grid-2 portfolio-grid">
            <Allocation summary={summary} />
            <Earnings summary={summary} />
          </div>
          <Holdings holdings={summary.holdings} />
        </>
      )}

      <div className="grid-2">
        <Transactions accountId={filter} />
        <Accounts accounts={accounts.data ?? []} />
      </div>

      <TransactionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} initialAccountId={filter} />
    </div>
  );
}

function Totals({ summary }: { summary: PortfolioSummary }) {
  const t = summary.totals;
  return (
    <section className="summary-grid four" aria-label="Totals">
      <div className="summary-card">
        <span className="muted small">Current value</span>
        <span className="figure">{inr(t.valueInr)}</span>
        <span className="muted small">Invested {inr(t.investedInr)}</span>
      </div>
      <div className="summary-card">
        <span className="muted small">Profit on holdings</span>
        <span className={`figure ${tone(Number(t.unrealizedInr))}`}>{signedInr(t.unrealizedInr)}</span>
        <span className={`small ${tone(t.unrealizedPct)}`}>{pct(t.unrealizedPct)}</span>
      </div>
      <div className="summary-card">
        <span className="muted small">Today</span>
        <span className={`figure ${tone(Number(t.dayChangeInr))}`}>{signedInr(t.dayChangeInr)}</span>
        <span className={`small ${tone(t.dayChangePct)}`}>{pct(t.dayChangePct)}</span>
      </div>
      <div className="summary-card">
        <span className="muted small" title="Annualized return that accounts for when each rupee went in">
          XIRR
        </span>
        <span className={`figure ${tone(t.xirr)}`}>{t.xirr === null ? 'n/a' : pct(t.xirr * 100)}</span>
        <span className="muted small">Per year, timing-weighted</span>
      </div>
    </section>
  );
}

const DIMENSIONS = { assetClass: 'Asset class', market: 'Market', sector: 'Stock sectors' } as const;
type Dimension = keyof typeof DIMENSIONS;

function Allocation({ summary }: { summary: PortfolioSummary }) {
  const [dimension, setDimension] = useState<Dimension>('assetClass');
  return (
    <section className="panel" aria-label="Allocation">
      <header className="panel-head wrap">
        <h2>Allocation</h2>
        <Segmented
          label="Allocation by"
          value={dimension}
          options={Object.keys(DIMENSIONS) as Dimension[]}
          onChange={setDimension}
          format={(d) => DIMENSIONS[d]}
        />
      </header>
      <AllocationBar
        slices={summary.allocation[dimension]}
        label={`Allocation by ${DIMENSIONS[dimension].toLowerCase()}`}
      />
    </section>
  );
}

function Earnings({ summary }: { summary: PortfolioSummary }) {
  const t = summary.totals;
  return (
    <section className="panel" aria-label="Earnings">
      <header className="panel-head">
        <h2>What you have earned</h2>
      </header>
      <dl className="risk-grid">
        <div>
          <dt>On holdings (not yet sold)</dt>
          <dd className={`mono ${tone(Number(t.unrealizedInr))}`}>{signedInr(t.unrealizedInr)}</dd>
        </div>
        <div>
          <dt>Booked from sales</dt>
          <dd className={`mono ${tone(Number(t.realizedInr))}`}>{signedInr(t.realizedInr)}</dd>
        </div>
        <div>
          <dt>Dividends received</dt>
          <dd className="mono">{inr(t.dividendsInr)}</dd>
        </div>
        <div>
          <dt>USD/INR used</dt>
          <dd className="mono">₹{Number(summary.usdInr).toFixed(2)}</dd>
          <p className="explain">US holdings convert at today's rate.</p>
        </div>
      </dl>
    </section>
  );
}

function holdingHref(h: Holding): string {
  return h.schemeCode ? `/fund/${h.schemeCode}` : `/stock/${encodeURIComponent(h.symbol ?? '')}`;
}

function Holdings({ holdings }: { holdings: Holding[] }) {
  const navigate = useNavigate();
  if (holdings.length === 0) {
    return (
      <section className="panel empty">
        <p className="muted">You have sold everything you bought. Booked profit and dividends are above.</p>
      </section>
    );
  }
  return (
    <section className="panel" aria-label="Holdings">
      <header className="panel-head">
        <h2>Holdings</h2>
        <span className="muted small">{holdings.length} positions</span>
      </header>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" className="num">
                Quantity
              </th>
              <th scope="col" className="num">
                Avg cost
              </th>
              <th scope="col" className="num">
                Price
              </th>
              <th scope="col" className="num">
                Value
              </th>
              <th scope="col" className="num">
                Profit
              </th>
              <th scope="col" className="num">
                Today
              </th>
              <th scope="col" className="num">
                XIRR
              </th>
              <th scope="col" className="num">
                Weight
              </th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const money = (v: string) => formatMoney(v, h.currency);
              return (
                <tr key={h.instrumentKey} className="clickable" onClick={() => navigate(holdingHref(h))}>
                  <td className="name-cell wide">
                    <Link to={holdingHref(h)} className="name-link" onClick={(e) => e.stopPropagation()}>
                      <span className={h.symbol ? 'mono strong' : 'strong truncate'}>
                        {h.symbol ?? shortName(h.name)}
                      </span>
                      <span className="row-sub truncate">
                        {h.symbol ? `${h.name}, ` : ''}
                        {h.accounts.join(', ')}
                      </span>
                    </Link>
                  </td>
                  <td className="num mono">
                    {Number(h.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                  </td>
                  <td className="num mono">{money(h.avgCost)}</td>
                  <td className="num mono">
                    {h.price ? (
                      money(h.price)
                    ) : (
                      <span className="tag warn" title="No live price; valued at cost">
                        no price
                      </span>
                    )}
                  </td>
                  <td className="num mono strong">{inr(h.valueInr)}</td>
                  <td className={`num mono ${tone(h.unrealizedPct)}`}>
                    {signedInr(h.unrealizedInr)}
                    <span className="row-sub">{pct(h.unrealizedPct)}</span>
                  </td>
                  <td className={`num mono ${tone(h.dayChangePct)}`}>{pct(h.dayChangePct)}</td>
                  <td className={`num mono ${tone(h.xirr)}`}>{h.xirr === null ? 'n/a' : pct(h.xirr * 100, 1)}</td>
                  <td className="num mono">{h.weight.toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const TX_LABEL = { buy: 'Buy', sell: 'Sell', dividend: 'Dividend' } as const;

function Transactions({ accountId }: { accountId?: string }) {
  const transactions = useTransactions(accountId);
  const remove = useDeleteTransaction();
  const rows = transactions.data ?? [];

  return (
    <section className="panel" aria-label="Transactions">
      <header className="panel-head">
        <h2>Recent transactions</h2>
        {rows.length > 0 && <span className="muted small">{rows.length} total</span>}
      </header>
      {remove.error && <p className="inline-error">{remove.error.message}</p>}
      {transactions.isPending ? (
        <SkeletonRows count={4} />
      ) : rows.length === 0 ? (
        <p className="muted small">Transactions you add will be listed here.</p>
      ) : (
        <ul className="tx-list">
          {rows.slice(0, 25).map((t) => (
            <li key={t.id}>
              <span className={`tx-type ${t.type}`}>{TX_LABEL[t.type]}</span>
              <span className="tx-main">
                <span className="truncate strong">{t.symbol ?? shortName(t.name)}</span>
                <span className="row-sub truncate">
                  {t.tradeDate}, {t.accountName}
                  {t.notes ? `, ${t.notes}` : ''}
                </span>
              </span>
              <span className="tx-amount mono">
                {t.quantity && t.price ? (
                  <span className="row-sub">
                    {Number(t.quantity).toLocaleString('en-IN')} × {formatMoney(t.price, t.currency)}
                  </span>
                ) : null}
                <span>{formatMoney(t.amount, t.currency)}</span>
              </span>
              <button
                type="button"
                className="icon-button visible"
                aria-label={`Delete ${TX_LABEL[t.type].toLowerCase()} of ${t.symbol ?? t.name} on ${t.tradeDate}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm('Delete this transaction? Holdings and returns will be recalculated.')) {
                    remove.mutate(t.id);
                  }
                }}
              >
                <TrashIcon size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Accounts({ accounts }: { accounts: Account[] }) {
  const remove = useDeleteAccount();
  return (
    <section className="panel" aria-label="Accounts">
      <header className="panel-head">
        <h2>Accounts</h2>
      </header>
      <ul className="tx-list">
        {accounts.map((a) => (
          <li key={a.id}>
            <span className="tx-main">
              <span className="strong">{a.name}</span>
              <span className="row-sub">
                {a.broker ?? 'No broker set'}, {a.currency}
              </span>
            </span>
            <button
              type="button"
              className="icon-button visible"
              aria-label={`Delete account ${a.name}`}
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Delete ${a.name} and every transaction in it? This cannot be undone.`)) {
                  remove.mutate(a.id);
                }
              }}
            >
              <TrashIcon size={15} />
            </button>
          </li>
        ))}
      </ul>
      <AccountForm compact />
    </section>
  );
}

function AccountForm({ compact = false }: { compact?: boolean }) {
  const create = useCreateAccount();
  const [name, setName] = useState('');
  const [broker, setBroker] = useState('');
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), broker: broker.trim() || undefined, currency },
      {
        onSuccess: () => {
          setName('');
          setBroker('');
        },
      },
    );
  }

  return (
    <form className={`account-form${compact ? ' compact' : ''}`} onSubmit={submit}>
      <div className="field">
        <label htmlFor="account-name" className="field-label">
          Account name
        </label>
        <input
          id="account-name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Zerodha"
        />
      </div>
      <div className="field">
        <label htmlFor="account-broker" className="field-label">
          Broker (optional)
        </label>
        <input
          id="account-broker"
          value={broker}
          maxLength={60}
          onChange={(e) => setBroker(e.target.value)}
          placeholder="e.g. Kite"
        />
      </div>
      <div className="field">
        <span className="field-label">Currency</span>
        <Segmented label="Account currency" value={currency} options={['INR', 'USD'] as const} onChange={setCurrency} />
      </div>
      <button type="submit" className="button" disabled={create.isPending || !name.trim()}>
        Add account
      </button>
      {create.error && <p className="inline-error span-all">{create.error.message}</p>}
    </form>
  );
}
