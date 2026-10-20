import { Decimal, HISTORY_RANGES, type HistoryRange, PriceHistorySchema } from '@folio/shared';
import { useQuery } from '@tanstack/react-query';
import { type MouseEvent, useMemo, useState } from 'react';
import { getJson } from '../api.js';
import { pct, price, tone } from '../lib/format.js';
import { Segmented } from './Segmented.js';

const W = 640;
const H = 260;
const PAD = { top: 12, right: 4, bottom: 4, left: 4 };

const RANGE_LABELS: Record<HistoryRange, string> = { '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y', '5y': '5Y' };

export type ChartSource = { kind: 'symbol'; symbol: string } | { kind: 'fund'; code: string };

function historyUrl(source: ChartSource, range: HistoryRange): string {
  return source.kind === 'fund'
    ? `/api/market/funds/${encodeURIComponent(source.code)}/history?range=${range}`
    : `/api/market/history/${encodeURIComponent(source.symbol)}?range=${range}`;
}

export function PriceChart({ source, isIndex = false }: { source: ChartSource; isIndex?: boolean }) {
  const [range, setRange] = useState<HistoryRange>('1y');
  const [hover, setHover] = useState<number | null>(null);
  const label = source.kind === 'fund' ? 'NAV' : 'Close';

  const { data, error, isPending } = useQuery({
    queryKey: ['history', source, range],
    queryFn: () => getJson(historyUrl(source, range), PriceHistorySchema),
    staleTime: 10 * 60_000,
  });

  const chart = useMemo(() => {
    const points = data?.points ?? [];
    if (points.length < 2) {
      return null;
    }
    // Floats are fine here: they only position pixels and never feed back into money math.
    const values = points.map((p) => Number(p.close));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (points.length - 1);
    const y = (v: number) => PAD.top + ((max - v) / span) * (H - PAD.top - PAD.bottom);
    const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const area = `${line}L${x(points.length - 1)},${H}L${x(0)},${H}Z`;

    const first = new Decimal(points[0]?.close ?? 0);
    const last = new Decimal(points.at(-1)?.close ?? 0);
    const change = first.isZero() ? 0 : last.minus(first).dividedBy(first).times(100).toNumber();

    return { points, values, x, y, line, area, change, up: change >= 0 };
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

  return (
    <section className="panel chart-panel" aria-label="Price history">
      <header className="chart-head">
        <p className="chart-readout">
          {data && chart ? (
            hovered ? (
              <>
                <span className="mono strong">{price(hovered.close, data.currency, isIndex)}</span>
                <span className="muted">
                  {label} on {hovered.date}
                </span>
              </>
            ) : (
              <>
                <span className={`mono strong ${tone(chart.change)}`}>{pct(chart.change)}</span>
                <span className="muted">over {RANGE_LABELS[range]}</span>
              </>
            )
          ) : (
            <span className="skeleton" style={{ width: '9rem' }} />
          )}
        </p>
        <Segmented
          label="Chart range"
          value={range}
          options={HISTORY_RANGES}
          onChange={setRange}
          format={(r) => RANGE_LABELS[r]}
        />
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
            aria-label={`${label} history over ${RANGE_LABELS[range]}`}
          >
            <defs>
              <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="chart-area" d={chart.area} fill="url(#chart-fill)" />
            <path className="chart-line" d={chart.line} vectorEffect="non-scaling-stroke" />
            {hover !== null && chart.values[hover] !== undefined && (
              <g className="chart-cursor">
                <line x1={chart.x(hover)} x2={chart.x(hover)} y1={0} y2={H} vectorEffect="non-scaling-stroke" />
                <circle cx={chart.x(hover)} cy={chart.y(chart.values[hover])} r={3.5} />
              </g>
            )}
          </svg>
        )}
      </div>
    </section>
  );
}
