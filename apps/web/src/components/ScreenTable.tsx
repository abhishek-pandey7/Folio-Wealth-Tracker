import type { Period, ScreenRow, SortKey } from '@folio/shared';
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { isIndexSymbol, pct, plainPct, price, ratio, returnHeading, tone } from '../lib/format.js';
import { StarButton } from './StarButton.js';

export interface SortState {
  sort: SortKey;
  order: 'best' | 'worst';
  onSort: (sort: SortKey) => void;
}

/** A column header that sorts the table; clicking the active one flips best/worst. */
export function SortHeader({
  label,
  sortKey,
  state,
  hint,
}: {
  label: string;
  sortKey: SortKey;
  state?: SortState;
  hint?: string;
}) {
  if (!state) {
    return (
      <th scope="col" className="num" title={hint}>
        {label}
      </th>
    );
  }
  const active = state.sort === sortKey;
  return (
    <th scope="col" className="num" aria-sort={active ? (state.order === 'best' ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        className={`th-sort${active ? ' active' : ''}`}
        onClick={() => state.onSort(sortKey)}
        title={hint}
      >
        {label}
        {active &&
          (state.order === 'best' ? (
            <CaretDownIcon size={11} weight="bold" />
          ) : (
            <CaretUpIcon size={11} weight="bold" />
          ))}
      </button>
    </th>
  );
}

interface Props {
  rows: ScreenRow[];
  period: Period;
  sortState?: SortState;
  /** Compact tables show name, price and the period return only. */
  compact?: boolean;
  rank?: boolean;
  empty?: ReactNode;
}

export function ScreenTable({ rows, period, sortState, compact = false, rank = false, empty }: Props) {
  const navigate = useNavigate();

  if (rows.length === 0) {
    return <div className="empty">{empty ?? <p className="muted">Nothing to show.</p>}</div>;
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {rank && (
              <th scope="col" className="rank">
                <span className="sr-only">Rank</span>
              </th>
            )}
            <th scope="col">Name</th>
            <th scope="col" className="num">
              Price
            </th>
            {!compact && <SortHeader label="Today" sortKey="return" />}
            <SortHeader label={returnHeading(period)} sortKey="return" state={sortState} />
            {!compact && (
              <>
                <SortHeader
                  label="Volatility"
                  sortKey="volatility"
                  state={sortState}
                  hint="How much the price swings, annualized over the last year. Lower is steadier."
                />
                <SortHeader
                  label="Max drop"
                  sortKey="drawdown"
                  state={sortState}
                  hint="Worst fall from a peak in the last year."
                />
                <SortHeader
                  label="Return / risk"
                  sortKey="risk_adjusted"
                  state={sortState}
                  hint="1-year return divided by volatility. Higher means more reward for each unit of swing."
                />
                <SortHeader
                  label="Up months"
                  sortKey="consistency"
                  state={sortState}
                  hint="Months out of the last 12 that closed higher."
                />
              </>
            )}
            <th scope="col" className="star-col">
              <span className="sr-only">Star</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const m = row.metrics;
            const href = `/stock/${encodeURIComponent(row.symbol)}`;
            return (
              <tr key={row.symbol} className="clickable" onClick={() => navigate(href)}>
                {rank && <td className="rank muted">{i + 1}</td>}
                <td className="name-cell">
                  <Link to={href} className="name-link" onClick={(e) => e.stopPropagation()}>
                    <span className="mono strong">{row.symbol}</span>
                    <span className="row-sub truncate">{row.name}</span>
                  </Link>
                </td>
                <td className="num mono">{price(row.price, row.currency, isIndexSymbol(row.symbol))}</td>
                {!compact && <td className={`num mono ${tone(row.changePercent)}`}>{pct(row.changePercent)}</td>}
                <td className={`num mono strong ${tone(m.returns[period])}`}>{pct(m.returns[period])}</td>
                {!compact && (
                  <>
                    <td className="num mono">{plainPct(m.volatility1y)}</td>
                    <td className="num mono down-soft">{pct(m.maxDrawdown1y, 1)}</td>
                    <td className="num mono">{ratio(m.riskAdjusted1y)}</td>
                    <td className="num mono">{m.months ? `${m.upMonths}/${m.months}` : 'n/a'}</td>
                  </>
                )}
                <td className="star-col">
                  <StarButton target={{ kind: 'symbol', symbol: row.symbol, name: row.name }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
