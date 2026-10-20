import { formatMoney, type Goal, type Sip } from '@folio/shared';
import { FlagIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { shortName } from '../components/FundTable.js';
import { GoalDialog, GoalHoldingsDialog, SipDialog } from '../components/PlanDialogs.js';
import { useDeleteGoal, useDeleteSip, useGoals, useSips, useUpdateSip } from '../lib/plan.js';
import { SkeletonRows } from './MarketsPage.js';

const inr = (v: string) => formatMoney(v, 'INR');
const wholeInr = (v: string) => formatMoney(Math.round(Number(v)), 'INR').replace(/\.00$/, '');

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function duration(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [
    years && `${years} ${years === 1 ? 'year' : 'years'}`,
    rest && `${rest} ${rest === 1 ? 'month' : 'months'}`,
  ];
  return parts.filter(Boolean).join(' ') || 'this month';
}

export function GoalsPage() {
  const goals = useGoals();
  const sips = useSips();
  const [goalDialog, setGoalDialog] = useState(false);
  const [sipDialog, setSipDialog] = useState<{ goalId?: string } | null>(null);
  const [editing, setEditing] = useState<Goal | undefined>();

  return (
    <div className="page">
      <header className="page-head row">
        <div>
          <h1>Goals and SIPs</h1>
          <p className="muted">What your money is for, and the monthly investments getting it there.</p>
        </div>
        <div className="head-actions">
          <button type="button" className="button secondary" onClick={() => setSipDialog({})}>
            <PlusIcon size={14} weight="bold" /> Start a SIP
          </button>
          <button type="button" className="button" onClick={() => setGoalDialog(true)}>
            <PlusIcon size={14} weight="bold" /> New goal
          </button>
        </div>
      </header>

      {goals.error && <p className="inline-error">{goals.error.message}</p>}
      {goals.isPending ? (
        <SkeletonRows count={3} />
      ) : goals.data?.length === 0 ? (
        <section className="panel empty-state">
          <FlagIcon size={28} className="muted" />
          <p className="strong">No goals yet</p>
          <p className="muted">
            An emergency fund, a house deposit, retirement. Give each a target and date, link the holdings and SIPs that
            are for it, and see whether you are on track.
          </p>
          <button type="button" className="button" onClick={() => setGoalDialog(true)}>
            Create your first goal
          </button>
        </section>
      ) : (
        <div className="goal-grid">
          {goals.data?.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              onEditHoldings={() => setEditing(g)}
              onAddSip={() => setSipDialog({ goalId: g.id })}
            />
          ))}
        </div>
      )}

      <SipList sips={sips.data} pending={sips.isPending} error={sips.error} onAdd={() => setSipDialog({})} />

      <GoalDialog open={goalDialog} onClose={() => setGoalDialog(false)} />
      <SipDialog open={sipDialog !== null} goalId={sipDialog?.goalId} onClose={() => setSipDialog(null)} />
      <GoalHoldingsDialog goal={editing} onClose={() => setEditing(undefined)} />
    </div>
  );
}

function GoalCard({
  goal,
  onEditHoldings,
  onAddSip,
}: {
  goal: Goal;
  onEditHoldings: () => void;
  onAddSip: () => void;
}) {
  const remove = useDeleteGoal();
  const required = goal.requiredMonthlyInr ? Number(goal.requiredMonthlyInr) : null;
  const sipping = Number(goal.monthlySipInr);

  return (
    <section className="panel goal-card" aria-label={goal.name}>
      <header className="goal-head">
        <div>
          <h2>{goal.name}</h2>
          <p className="muted small">
            {wholeInr(goal.targetAmount)}
            {goal.targetDate && ` by ${formatDate(goal.targetDate)}`}
            {goal.monthsLeft !== null && `, ${duration(goal.monthsLeft)} left`}
          </p>
        </div>
        {goal.onTrack !== null && (
          <span className={`tag ${goal.onTrack ? 'accent' : 'warn'}`}>{goal.onTrack ? 'On track' : 'Behind'}</span>
        )}
      </header>

      <div
        className="goal-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={goal.progressPct}
        aria-label={`${goal.progressPct}% of target`}
      >
        <span style={{ width: `${Math.max(goal.progressPct, goal.progressPct > 0 ? 1 : 0)}%` }} />
      </div>
      <p className="goal-figures">
        <span className="mono strong">{inr(goal.currentInr)}</span>
        <span className="muted"> saved, {goal.progressPct}%</span>
      </p>

      {goal.projectedInr !== null && required !== null && (
        <p className="goal-advice">
          {goal.onTrack ? (
            <>
              At {Math.round(goal.assumedReturn * 100)}% a year you would reach about{' '}
              <span className="strong">{wholeInr(goal.projectedInr)}</span>.
            </>
          ) : (
            <>
              To get there at {Math.round(goal.assumedReturn * 100)}% a year, invest about{' '}
              <span className="strong">{wholeInr(String(required))}</span> a month
              {sipping > 0 ? ` (you are investing ${wholeInr(goal.monthlySipInr)})` : ''}.
            </>
          )}
        </p>
      )}
      {goal.targetDate === null && <p className="muted small">Add a target date to see the monthly SIP you need.</p>}

      <dl className="goal-links">
        <div>
          <dt>Holdings</dt>
          <dd>
            {goal.holdings.length === 0
              ? 'None linked'
              : goal.holdings
                  .map(
                    (h) =>
                      `${h.instrumentKey.startsWith('MF-') ? shortName(h.name) : h.instrumentKey}${h.share < 1 ? ` (${Math.round(h.share * 100)}%)` : ''}`,
                  )
                  .join(', ')}
          </dd>
        </div>
        <div>
          <dt>SIPs</dt>
          <dd>
            {goal.sips.length === 0
              ? 'None linked'
              : goal.sips
                  .map(
                    (s) =>
                      `${shortName(s.fundName)}, ${wholeInr(s.amount)}${s.status !== 'active' ? ` (${s.status})` : ''}`,
                  )
                  .join('; ')}
          </dd>
        </div>
      </dl>

      <footer className="goal-actions">
        <button type="button" className="link-button" onClick={onEditHoldings}>
          Choose holdings
        </button>
        <button type="button" className="link-button" onClick={onAddSip}>
          Add a SIP
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`Delete goal ${goal.name}`}
          onClick={() => {
            if (window.confirm(`Delete the goal "${goal.name}"? Holdings and SIPs stay; they are just unlinked.`)) {
              remove.mutate(goal.id);
            }
          }}
        >
          <TrashIcon size={15} />
        </button>
      </footer>
      <p className="disclaimer">Projections assume a steady return; real returns vary year to year.</p>
    </section>
  );
}

const STATUS_LABEL = { active: 'Active', paused: 'Paused', stopped: 'Stopped' } as const;

function SipList({
  sips,
  pending,
  error,
  onAdd,
}: {
  sips: Sip[] | undefined;
  pending: boolean;
  error: Error | null;
  onAdd: () => void;
}) {
  const update = useUpdateSip();
  const remove = useDeleteSip();
  const monthly = (sips ?? []).filter((s) => s.status === 'active').reduce((sum, s) => sum + Number(s.amount), 0);

  return (
    <section className="panel" aria-label="SIPs">
      <header className="panel-head">
        <div>
          <h2>SIPs</h2>
          {monthly > 0 && <p className="muted small">{wholeInr(String(monthly))} a month across active SIPs</p>}
        </div>
      </header>
      {error && <p className="inline-error">{error.message}</p>}
      {(update.error || remove.error) && <p className="inline-error">{(update.error ?? remove.error)?.message}</p>}
      {pending ? (
        <SkeletonRows count={3} />
      ) : !sips || sips.length === 0 ? (
        <div className="empty">
          <p className="strong">No SIPs yet</p>
          <p className="muted">
            Add a SIP you already have with the date it started: every past instalment is recorded at its real NAV.
          </p>
          <p>
            <button type="button" className="button" onClick={onAdd}>
              Start a SIP
            </button>
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Fund</th>
                <th scope="col" className="num">
                  Monthly
                </th>
                <th scope="col">Next</th>
                <th scope="col" className="num">
                  Instalments
                </th>
                <th scope="col" className="num">
                  Invested
                </th>
                <th scope="col">Goal</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sips.map((s) => (
                <tr key={s.id}>
                  <td className="name-cell wide">
                    <Link to={`/fund/${s.schemeCode}`} className="name-link">
                      <span className="strong truncate">{shortName(s.fundName)}</span>
                      <span className="row-sub truncate">
                        {s.accountName}, since {formatDate(s.startDate)}
                      </span>
                    </Link>
                  </td>
                  <td className="num mono">{wholeInr(s.amount)}</td>
                  <td>{s.nextDue ? formatDate(s.nextDue) : <span className="muted">n/a</span>}</td>
                  <td className="num mono">{s.instalments}</td>
                  <td className="num mono">{inr(s.investedInr)}</td>
                  <td>{s.goalName ?? <span className="muted">None</span>}</td>
                  <td>
                    <span className={`tag${s.status === 'active' ? ' accent' : ''}`}>{STATUS_LABEL[s.status]}</span>
                  </td>
                  <td className="row-actions">
                    {s.status === 'active' && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => update.mutate({ id: s.id, status: 'paused' })}
                      >
                        Pause
                      </button>
                    )}
                    {s.status === 'paused' && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => update.mutate({ id: s.id, status: 'active' })}
                      >
                        Resume
                      </button>
                    )}
                    {s.status !== 'stopped' && (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          if (window.confirm('Stop this SIP for good? Recorded instalments stay in your portfolio.')) {
                            update.mutate({ id: s.id, status: 'stopped' });
                          }
                        }}
                      >
                        Stop
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Delete SIP in ${s.fundName}`}
                      onClick={() => {
                        if (window.confirm('Delete this SIP? Instalments already recorded stay in your portfolio.')) {
                          remove.mutate(s.id);
                        }
                      }}
                    >
                      <TrashIcon size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
