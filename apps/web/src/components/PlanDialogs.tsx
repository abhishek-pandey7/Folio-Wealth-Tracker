import { CreateGoalSchema, CreateSipSchema, formatMoney, type Goal, MAX_SIP_DAY } from '@folio/shared';
import { XIcon } from '@phosphor-icons/react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useCreateGoal, useCreateSip, useGoals, useSetGoalHoldings } from '../lib/plan.js';
import { useAccounts, usePortfolio } from '../lib/portfolio.js';
import { shortName } from './FundTable.js';
import { Field, InstrumentPicker, type PickedInstrument } from './TransactionDialog.js';

const localToday = () => new Date().toLocaleDateString('en-CA');

/** A native <dialog>: focus trap, Esc to close and an inert background come from the browser. */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label={title}>
      <div className="dialog-head dialog-pad">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </div>
      {open && children}
    </dialog>
  );
}

function issuesByField(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    errors[String(issue.path[0] ?? 'form')] ??= issue.message;
  }
  return errors;
}

const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

export function SipDialog({ open, onClose, goalId }: { open: boolean; onClose: () => void; goalId?: string }) {
  return (
    <Modal open={open} onClose={onClose} title="Start a SIP">
      <SipForm onDone={onClose} initialGoalId={goalId} />
    </Modal>
  );
}

function SipForm({ onDone, initialGoalId }: { onDone: () => void; initialGoalId?: string }) {
  const accounts = useAccounts();
  const goals = useGoals();
  const create = useCreateSip();
  const [accountId, setAccountId] = useState(accounts.data?.[0]?.id ?? '');
  const [fund, setFund] = useState<PickedInstrument | undefined>();
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(5);
  const [startDate, setStartDate] = useState(localToday());
  const [goalId, setGoalId] = useState(initialGoalId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!accountId && accounts.data?.[0]) setAccountId(accounts.data[0].id);
  }, [accountId, accounts.data]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = CreateSipSchema.safeParse({
      accountId,
      schemeCode: fund?.ref.kind === 'fund' ? fund.ref.code : '',
      amount,
      dayOfMonth: day,
      startDate,
      goalId: goalId || undefined,
    });
    if (!parsed.success) {
      const next = issuesByField(parsed.error.issues);
      if (!fund) next.schemeCode = 'Pick a mutual fund';
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, { onSuccess: onDone });
  }

  if (accounts.data?.length === 0) {
    return <p className="inline-error dialog-pad">Add a broker account on the Portfolio page first.</p>;
  }

  const backfill = startDate < localToday();
  return (
    <form onSubmit={submit} noValidate className="dialog-body">
      <div className="form-grid">
        <div className="span-2">
          <InstrumentPicker fundsOnly value={fund} onChange={setFund} error={errors.schemeCode} />
        </div>
        <Field label="Monthly amount (₹)" error={errors.amount}>
          {(id) => (
            <input
              id={id}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="5000"
            />
          )}
        </Field>
        <Field
          label="Day of the month"
          error={errors.dayOfMonth}
          hint="Dates after the 28th do not exist in every month"
        >
          {(id) => (
            <select id={id} value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {Array.from({ length: MAX_SIP_DAY }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {ordinal(d)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label="Started on"
          error={errors.startDate}
          hint={backfill ? 'Every instalment since then is recorded at the NAV of its date.' : undefined}
        >
          {(id) => <input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
        </Field>
        <Field label="Account" error={errors.accountId}>
          {(id) => (
            <select id={id} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="span-2">
          <Field label="Goal (optional)">
            {(id) => (
              <select id={id} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">No goal</option>
                {goals.data?.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </div>
      {create.error && <p className="inline-error">{create.error.message}</p>}
      <footer className="dialog-foot">
        <span className="muted small">{backfill && 'Past instalments are added in one go.'}</span>
        <button type="button" className="button secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={create.isPending}>
          {create.isPending ? (backfill ? 'Recording past instalments' : 'Saving') : 'Start SIP'}
        </button>
      </footer>
    </form>
  );
}

export function GoalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="New goal">
      <GoalForm onDone={onClose} />
    </Modal>
  );
}

function GoalForm({ onDone }: { onDone: () => void }) {
  const create = useCreateGoal();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [returnPct, setReturnPct] = useState('10');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = CreateGoalSchema.safeParse({
      name,
      targetAmount: target,
      targetDate: date || undefined,
      assumedReturn: Number(returnPct) / 100,
    });
    if (!parsed.success) {
      setErrors(issuesByField(parsed.error.issues));
      return;
    }
    setErrors({});
    create.mutate(parsed.data, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} noValidate className="dialog-body">
      <div className="form-grid">
        <div className="span-2">
          <Field label="Goal" error={errors.name}>
            {(id) => (
              <input
                id={id}
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. House deposit"
              />
            )}
          </Field>
        </div>
        <Field label="Target amount (₹)" error={errors.targetAmount}>
          {(id) => (
            <input
              id={id}
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="2000000"
            />
          )}
        </Field>
        <Field label="Target date (optional)" error={errors.targetDate} hint="Needed for the monthly SIP estimate">
          {(id) => (
            <input id={id} type="date" min={localToday()} value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
        <div className="span-2">
          <Field
            label="Assumed yearly return (%)"
            error={errors.assumedReturn}
            hint="An assumption, not a promise. Equity funds have historically returned 10 to 12% a year over long periods; debt funds 6 to 7%."
          >
            {(id) => (
              <input id={id} inputMode="decimal" value={returnPct} onChange={(e) => setReturnPct(e.target.value)} />
            )}
          </Field>
        </div>
      </div>
      {create.error && <p className="inline-error">{create.error.message}</p>}
      <footer className="dialog-foot">
        <span />
        <button type="button" className="button secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={create.isPending}>
          Create goal
        </button>
      </footer>
    </form>
  );
}

export function GoalHoldingsDialog({ goal, onClose }: { goal: Goal | undefined; onClose: () => void }) {
  return (
    <Modal open={Boolean(goal)} onClose={onClose} title={goal ? `Holdings for ${goal.name}` : 'Holdings'}>
      {goal && <GoalHoldingsForm goal={goal} onDone={onClose} />}
    </Modal>
  );
}

function GoalHoldingsForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const portfolio = usePortfolio();
  const save = useSetGoalHoldings();
  // Percent of each holding counted toward this goal; absent means not linked.
  const [shares, setShares] = useState<Record<string, string>>(() =>
    Object.fromEntries(goal.holdings.map((h) => [h.instrumentKey, String(Math.round(h.share * 100))])),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const holdings = Object.entries(shares)
      .map(([instrumentKey, pct]) => ({ instrumentKey, share: Number(pct) / 100 }))
      .filter((h) => h.share > 0);
    save.mutate({ id: goal.id, holdings }, { onSuccess: onDone });
  }

  const holdings = portfolio.data?.holdings ?? [];
  return (
    <form onSubmit={submit} className="dialog-body">
      <p className="muted small">
        Count all or part of a holding toward this goal. A holding can be split across goals, up to 100% in total.
      </p>
      {holdings.length === 0 ? (
        <p className="muted">You have no holdings yet. Record a buy or start a SIP first.</p>
      ) : (
        <ul className="goal-pick">
          {holdings.map((h) => {
            const key = h.instrumentKey;
            const linked = key in shares;
            return (
              <li key={key}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={linked}
                    onChange={(e) =>
                      setShares((s) => {
                        const next = { ...s };
                        if (e.target.checked) next[key] = '100';
                        else delete next[key];
                        return next;
                      })
                    }
                  />
                  <span className="truncate">
                    <span className="strong">{h.symbol ?? shortName(h.name)}</span>
                    <span className="row-sub">{formatMoney(h.valueInr, 'INR')}</span>
                  </span>
                </label>
                {linked && (
                  <span className="share-input">
                    <input
                      aria-label={`Share of ${h.symbol ?? h.name} for this goal`}
                      inputMode="numeric"
                      value={shares[key]}
                      onChange={(e) =>
                        setShares((s) => ({ ...s, [key]: e.target.value.replace(/[^\d]/g, '').slice(0, 3) }))
                      }
                    />
                    %
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {save.error && <p className="inline-error">{save.error.message}</p>}
      <footer className="dialog-foot">
        <span />
        <button type="button" className="button secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={save.isPending}>
          Save
        </button>
      </footer>
    </form>
  );
}
