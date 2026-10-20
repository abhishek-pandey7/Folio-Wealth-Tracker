import { type AllocationSlice, formatMoney } from '@folio/shared';
import { useState } from 'react';

/**
 * Categorical slots, validated with the dataviz palette checker against this
 * app's surfaces (light #fdfdfd, dark #151518): every adjacent pair clears the
 * colour-blind and normal-vision floors. Green and red are left out on purpose,
 * because in this app they only ever mean price direction. Past six slices,
 * the rest fold into a neutral "Other".
 */
const SLOTS = 6;

function fold(slices: AllocationSlice[]): AllocationSlice[] {
  if (slices.length <= SLOTS) return slices;
  const head = slices.slice(0, SLOTS - 1);
  const tail = slices.slice(SLOTS - 1);
  const value = tail.reduce((sum, s) => sum + Number(s.valueInr), 0);
  const weight = tail.reduce((sum, s) => sum + s.weight, 0);
  return [...head, { key: 'other', label: `Other (${tail.length})`, valueInr: value.toFixed(2), weight }];
}

export function AllocationBar({ slices, label }: { slices: AllocationSlice[]; label: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = fold(slices);

  if (shown.length === 0) {
    return <p className="muted small">Nothing to show yet.</p>;
  }

  return (
    <div className="allocation">
      <div
        className="allocation-bar"
        role="img"
        aria-label={`${label}: ${shown.map((s) => `${s.label} ${s.weight.toFixed(1)}%`).join(', ')}`}
      >
        {shown.map((s, i) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: hover only highlights; the legend below carries the same data
          <span
            key={s.key}
            className={`allocation-segment series-${s.key === 'other' ? 'other' : i + 1}${hover && hover !== s.key ? ' dim' : ''}`}
            style={{ flexGrow: Math.max(s.weight, 0.5) }}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
          >
            {hover === s.key && (
              <span className="allocation-tip" role="tooltip">
                <span className="strong">{s.label}</span>
                <span className="mono">
                  {formatMoney(s.valueInr, 'INR')} · {s.weight.toFixed(1)}%
                </span>
              </span>
            )}
          </span>
        ))}
      </div>
      {/* The legend is also the table view: every value is readable without colour. */}
      <ul className="allocation-legend">
        {shown.map((s, i) => (
          <li
            key={s.key}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            className={hover && hover !== s.key ? 'dim' : undefined}
          >
            <span className={`swatch series-${s.key === 'other' ? 'other' : i + 1}`} aria-hidden />
            <span className="truncate">{s.label}</span>
            <span className="mono muted">{formatMoney(s.valueInr, 'INR')}</span>
            <span className="mono strong">{s.weight.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
