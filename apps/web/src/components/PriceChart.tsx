import {
  Decimal,
  formatMoney,
  formatPercent,
  HISTORY_RANGES,
  type HistoryRange,
  PriceHistorySchema,
} from '@folio/shared';
import { useQuery } from '@tanstack/react-query';
import { type MouseEvent, useMemo, useState } from 'react';
import { getJson } from '../api.js';

const W = 640;
const H = 260;
const PAD = { top: 12, right: 4, bottom: 4, left: 4 };

export function PriceChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<HistoryRange>('6mo');
  const [hover, setHover] = useState<number | null>(null);

  const { data, error, isPending } = useQuery({
    queryKey: ['history', symbol, range],
    queryFn: () => getJson(`/api/market/history/${encodeURIComponent(symbol)}?range=${range}`, PriceHistorySchema),
  });

  const chart = useMemo(() => {
    const points = data?.points ?? [];
    if (points.length < 2) {
      return null;
    }
    // Floats are fine here: they only position pixels and never feed back into money math.
    const closes = points.map((p) => Number(p.close));
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (points.length - 1);
    const y = (v: number) => PAD.top + ((max - v) / span) * (H - PAD.top - PAD.bottom);
    const line = closes.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1)},${H}L${x(0)},${H}Z`;

    const first = new Decimal(points[0]?.close ?? 0);
    const last = new Decimal(points.at(-1)?.close ?? 0);
    const change = first.isZero() ? new Decimal(0) : last.minus(first).dividedBy(first).times(100);

    return { points, closes, x, y, line, area, change, up: !change.isNegative() };
  }, [data]);

  function onMove(event: MouseEvent<SVGSVGElement>) {
    if (!chart) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const ratio = (px - PAD.left) / (W - PAD.left - PAD.right);
    setHover(Math.max(0, Math.min(chart.points.length - 1, Math.round(ratio * (chart.points.length - 1)))));
  }

  const hovered = chart && hover !== null ? chart.points[hover] : undefined;
  const shown = hovered ?? chart?.points.at(-1);

  return (
    <section className="panel chart-panel" aria-label={`${symbol} price history`}>
      <header className="chart-head">
        <div className="chart-title">
          <h2 className="mono">{symbol}</h2>
          {data && shown ? (
            <p className="chart-readout">
              <span className="figure">{formatMoney(shown.close, data.currency)}</span>
              {hovered ? (
                <span className="muted">Close on {hovered.date}</span>
              ) : (
                chart && (
                  <>
                    <span className="muted">Last close</span>
                    <span className={chart.up ? 'up' : 'down'}>
                      {chart.up ? '+' : ''}
                      {formatPercent(chart.change)} over {range}
                    </span>
                  </>
                )
              )}
            </p>
          ) : (
            <p className="chart-readout">
              <span className="skeleton" style={{ width: '8rem', height: '1.75rem' }} />
            </p>
          )}
        </div>
        <div className="segmented" role="tablist" aria-label="Time range">
          {HISTORY_RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={r === range} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </header>

      <div className="chart-frame">
        {isPending && <div className="skeleton chart-skeleton" />}
        {error && <p className="inline-error">{error.message}</p>}
        {chart && (
          <svg
            className={`chart ${chart.up ? 'up' : 'down'}`}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={`${symbol} closing prices over ${range}`}
          >
            <defs>
              <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="chart-area" d={chart.area} fill="url(#chart-fill)" />
            <path className="chart-line" d={chart.line} vectorEffect="non-scaling-stroke" />
            {hover !== null && chart.closes[hover] !== undefined && (
              <g className="chart-cursor">
                <line x1={chart.x(hover)} x2={chart.x(hover)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
                <circle cx={chart.x(hover)} cy={chart.y(chart.closes[hover])} r={3.5} />
              </g>
            )}
          </svg>
        )}
      </div>
    </section>
  );
}
