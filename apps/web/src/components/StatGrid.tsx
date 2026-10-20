import type { Metrics, Period } from '@folio/shared';
import { PERIOD_LABELS, pct, plainPct, ratio, tone } from '../lib/format.js';

const RETURN_PERIODS: Period[] = ['1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y'];

export function ReturnsStrip({ metrics }: { metrics: Metrics }) {
  return (
    <section className="panel" aria-label="Returns">
      <header className="panel-head">
        <h2>Returns</h2>
        <span className="muted small">3Y and 5Y are per year (annualized)</span>
      </header>
      <dl className="returns-strip">
        {RETURN_PERIODS.map((p) => (
          <div key={p}>
            <dt>{PERIOD_LABELS[p]}</dt>
            <dd className={`mono ${tone(metrics.returns[p])}`}>{pct(metrics.returns[p])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface RiskProps {
  metrics: Metrics;
  range52w?: { low: number | null; high: number | null; current: number; fromHigh: number | null };
}

/** The "how reliable is it" view: swings, worst fall, reward per unit of risk, consistency. */
export function RiskPanel({ metrics, range52w }: RiskProps) {
  return (
    <section className="panel" aria-label="Risk and consistency">
      <header className="panel-head">
        <h2>Risk and consistency</h2>
        <span className="muted small">Last 12 months</span>
      </header>
      <dl className="risk-grid">
        <div>
          <dt>Volatility</dt>
          <dd className="mono">{plainPct(metrics.volatility1y)}</dd>
          <p className="explain">How much it swings in a typical year. Under 15% is calm; over 35% is a rough ride.</p>
        </div>
        <div>
          <dt>Worst drop</dt>
          <dd className="mono down-soft">{pct(metrics.maxDrawdown1y, 1)}</dd>
          <p className="explain">The most you would have been down from a peak.</p>
        </div>
        <div>
          <dt>Return per unit of risk</dt>
          <dd className="mono">{ratio(metrics.riskAdjusted1y)}</dd>
          <p className="explain">1-year return divided by volatility. Above 1 is strong; below 0 lost money.</p>
        </div>
        <div>
          <dt>Up months</dt>
          <dd className="mono">{metrics.months ? `${metrics.upMonths} of ${metrics.months}` : 'n/a'}</dd>
          <p className="explain">Months that ended higher than they started.</p>
        </div>
      </dl>
      {range52w && range52w.low !== null && range52w.high !== null && range52w.high > range52w.low && (
        <RangeBar low={range52w.low} high={range52w.high} current={range52w.current} fromHigh={range52w.fromHigh} />
      )}
    </section>
  );
}

function RangeBar({
  low,
  high,
  current,
  fromHigh,
}: {
  low: number;
  high: number;
  current: number;
  fromHigh: number | null;
}) {
  const position = Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100));
  const fmt = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return (
    <div className="range">
      <div className="range-head">
        <span className="muted small">52-week range</span>
        {fromHigh !== null && (
          <span className="small">
            {fromHigh >= -0.5 ? 'At its 52-week high' : `${Math.abs(fromHigh).toFixed(1)}% below the high`}
          </span>
        )}
      </div>
      <div
        className="range-track"
        role="img"
        aria-label={`Price ${fmt(current)} within a 52-week range of ${fmt(low)} to ${fmt(high)}`}
      >
        <span className="range-marker" style={{ left: `${position}%` }} />
      </div>
      <div className="range-ends mono small">
        <span>{fmt(low)}</span>
        <span>{fmt(high)}</span>
      </div>
    </div>
  );
}
