import {
  CreateTransactionSchema,
  Decimal,
  FundMatchSchema,
  FundStatsSchema,
  type InstrumentRef,
  QuoteSchema,
  SymbolMatchSchema,
} from '@folio/shared';
import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { getJson } from '../api.js';
import { useDebounced } from '../hooks.js';
import { useAccounts, useCreateTransaction } from '../lib/portfolio.js';
import { shortName } from './FundTable.js';
import { Segmented } from './Segmented.js';

export interface PickedInstrument {
  ref: InstrumentRef;
  label: string;
}

const TYPE_LABELS = { buy: 'Buy', sell: 'Sell', dividend: 'Dividend' } as const;
type TxType = keyof typeof TYPE_LABELS;

const localToday = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the user's timezone

interface Props {
  open: boolean;
  onClose: () => void;
  initialInstrument?: PickedInstrument;
  initialAccountId?: string;
}

export function TransactionDialog({ open, onClose, initialInstrument, initialAccountId }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const accounts = useAccounts();
  const create = useCreateTransaction();

  const [accountId, setAccountId] = useState(initialAccountId ?? '');
  const [type, setType] = useState<TxType>('buy');
  const [instrument, setInstrument] = useState<PickedInstrument | undefined>(initialInstrument);
  const [tradeDate, setTradeDate] = useState(localToday());
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [fees, setFees] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setInstrument(initialInstrument);
      setAccountId((current) => current || initialAccountId || '');
      create.reset();
      setFieldErrors({});
    } else if (!open && el.open) {
      el.close();
    }
  }, [open, initialInstrument, initialAccountId, create.reset]);

  // Default to the first account once accounts load.
  useEffect(() => {
    if (!accountId && accounts.data?.[0]) setAccountId(accounts.data[0].id);
  }, [accountId, accounts.data]);

  // Prefill the price with today's quote or NAV; the user can overwrite it.
  const livePrice = useQuery({
    queryKey: ['prefill', instrument?.ref],
    queryFn: async () => {
      const ref = instrument?.ref;
      if (!ref) return null;
      if (ref.kind === 'fund') return (await getJson(`/api/market/funds/${ref.code}/stats`, FundStatsSchema)).nav;
      return (await getJson(`/api/market/quotes/${encodeURIComponent(ref.symbol)}`, QuoteSchema)).price;
    },
    enabled: Boolean(instrument),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (livePrice.data && !price) setPrice(new Decimal(livePrice.data).toDecimalPlaces(4).toString());
  }, [livePrice.data, price]);

  function reset() {
    setQuantity('');
    setPrice('');
    setFees('');
    setAmount('');
    setNotes('');
    setTradeDate(localToday());
    setFieldErrors({});
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      accountId,
      instrument: instrument?.ref,
      type,
      tradeDate,
      ...(type === 'dividend'
        ? { amount: amount || undefined }
        : { quantity: quantity || undefined, price: price || undefined }),
      fees: fees || undefined,
      notes: notes || undefined,
    };
    // Same schema the API validates with, so most mistakes are caught before a round trip.
    const parsed = CreateTransactionSchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0] ?? 'form')] ??= issue.message;
      }
      if (!instrument) errors.instrument = 'Pick a stock, ETF or fund';
      if (!accountId) errors.accountId = 'Pick an account';
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    create.mutate(parsed.data, {
      onSuccess: () => {
        reset();
        onClose();
      },
    });
  }

  const total =
    type !== 'dividend' && quantity && price && !Number.isNaN(Number(quantity)) && !Number.isNaN(Number(price))
      ? new Decimal(quantity).times(price).plus(type === 'buy' ? fees || 0 : new Decimal(fees || 0).negated())
      : null;

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} aria-labelledby="tx-title">
      <form onSubmit={submit} noValidate>
        <header className="dialog-head">
          <h2 id="tx-title">Add a transaction</h2>
          <button type="button" className="icon-button visible" aria-label="Close" onClick={onClose}>
            <XIcon size={16} />
          </button>
        </header>

        {accounts.data?.length === 0 ? (
          <p className="inline-error">Add a broker account first, from the Accounts panel.</p>
        ) : (
          <div className="form-grid">
            <Field label="Account" error={fieldErrors.accountId}>
              {(id) => (
                <select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.data?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.broker ? ` (${a.broker})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <div className="field">
              <span className="field-label">Type</span>
              <Segmented
                label="Transaction type"
                value={type}
                options={['buy', 'sell', 'dividend'] as const}
                onChange={setType}
                format={(t) => TYPE_LABELS[t]}
              />
            </div>

            <div className="span-2">
              <InstrumentPicker
                value={instrument}
                onChange={(i) => {
                  setInstrument(i);
                  setPrice('');
                }}
                error={fieldErrors.instrument}
              />
            </div>

            <Field label="Date" error={fieldErrors.tradeDate}>
              {(id) => (
                <input
                  id={id}
                  type="date"
                  max={localToday()}
                  value={tradeDate}
                  onChange={(e) => setTradeDate(e.target.value)}
                />
              )}
            </Field>

            {type === 'dividend' ? (
              <Field label="Amount received" error={fieldErrors.amount}>
                {(id) => (
                  <input
                    id={id}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                )}
              </Field>
            ) : (
              <>
                <Field label={instrument?.ref.kind === 'fund' ? 'Units' : 'Quantity'} error={fieldErrors.quantity}>
                  {(id) => (
                    <input
                      id={id}
                      inputMode="decimal"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="0"
                    />
                  )}
                </Field>
                <Field
                  label={instrument?.ref.kind === 'fund' ? 'NAV per unit' : 'Price per share'}
                  error={fieldErrors.price}
                  hint={livePrice.data ? 'Prefilled with the latest price; change it to what you paid.' : undefined}
                >
                  {(id) => (
                    <input
                      id={id}
                      inputMode="decimal"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.00"
                    />
                  )}
                </Field>
              </>
            )}

            <Field label="Charges (optional)" error={fieldErrors.fees} hint="Brokerage, STT, stamp duty">
              {(id) => (
                <input
                  id={id}
                  inputMode="decimal"
                  value={fees}
                  onChange={(e) => setFees(e.target.value)}
                  placeholder="0.00"
                />
              )}
            </Field>

            <div className="span-2">
              <Field
                label="Note (optional)"
                error={fieldErrors.notes}
                hint="Why you bought or sold, for your future self"
              >
                {(id) => <input id={id} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
            </div>
          </div>
        )}

        {create.error && <p className="inline-error">{create.error.message}</p>}

        <footer className="dialog-foot">
          <span className="muted">
            {total && (
              <>
                {type === 'buy' ? 'You pay ' : 'You receive '}
                <span className="mono strong">
                  {total.toNumber().toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </span>
              </>
            )}
          </span>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={create.isPending}>
            {create.isPending ? 'Saving' : `Add ${TYPE_LABELS[type].toLowerCase()}`}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children(id)}
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** Finds a stock, ETF or index (Yahoo) or a mutual fund (AMFI) to transact in. */
function InstrumentPicker({
  value,
  onChange,
  error,
}: {
  value: PickedInstrument | undefined;
  onChange: (value: PickedInstrument | undefined) => void;
  error?: string;
}) {
  const id = useId();
  const [text, setText] = useState('');
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

  if (value) {
    return (
      <div className="field">
        <span className="field-label">Stock, ETF or fund</span>
        <div className="picked">
          <span className="truncate strong">{value.label}</span>
          <button type="button" className="link-button" onClick={() => onChange(undefined)}>
            Change
          </button>
        </div>
      </div>
    );
  }

  const stockResults = (symbols.data ?? []).filter((m) => m.type !== 'mutual_fund' && m.type !== 'index').slice(0, 5);
  const fundResults = (funds.data ?? []).filter((f) => /direct/i.test(f.name) && /growth/i.test(f.name)).slice(0, 5);

  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        Stock, ETF or fund
      </label>
      <div className="search">
        <MagnifyingGlassIcon className="search-icon" size={16} aria-hidden />
        <input
          id={id}
          type="search"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by name or ticker"
        />
        {enabled && (
          <div className="search-results">
            {stockResults.map((m) => (
              <button
                key={m.symbol}
                type="button"
                onClick={() =>
                  onChange({
                    ref: { kind: 'symbol', symbol: m.symbol, name: m.name, type: m.type },
                    label: `${m.symbol}, ${m.name}`,
                  })
                }
              >
                <span className="mono strong">{m.symbol}</span>
                <span className="truncate muted">{m.name}</span>
                <span className="tag">{m.exchange}</span>
              </button>
            ))}
            {fundResults.map((f) => (
              <button
                key={f.schemeCode}
                type="button"
                onClick={() => onChange({ ref: { kind: 'fund', code: f.schemeCode }, label: shortName(f.name) })}
              >
                <span className="truncate">{shortName(f.name)}</span>
                <span />
                <span className="tag">Fund</span>
              </button>
            ))}
            {symbols.data && funds.data && stockResults.length + fundResults.length === 0 && (
              <p className="search-note">No matches</p>
            )}
          </div>
        )}
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
