import { type FundStats, formatMoney, type Period } from '@folio/shared';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { pct, plainPct, ratio, tone } from '../lib/format.js';
import { SortHeader, type SortState } from './ScreenTable.js';
import { StarButton } from './StarButton.js';

const RETURN_COLUMNS: { period: Period; label: string }[] = [
  { period: '1y', label: '1Y' },
  { period: '3y', label: '3Y p.a.' },
  { period: '5y', label: '5Y p.a.' },
];

interface Props {
  rows: FundStats[];
  period: Period;
  sortState?: SortState;
  rank?: boolean;
  empty?: ReactNode;
}

/** Fund house names repeat the word; "PPFAS Mutual Fund" reads fine as "PPFAS". */
function shortHouse(house: string): string {
  return house.replace(/\s+Mutual Fund$/i, '');
}

const PLAN_SUFFIX = /[\s-]+(direct|dir|plan|growth|option|gr)\.?$/i;

/**
 * Scheme names end with plan and option ("- Direct Plan - Growth", or just
 * "Growth Direct"), which every row here shares, so strip them from the end.
 */
function shortName(name: string): string {
  let short = name.trim();
  while (PLAN_SUFFIX.test(short)) {
    short = short.replace(PLAN_SUFFIX, '');
  }
  return short.replace(/[\s-]+$/, '');
}

export function FundTable({ rows, period, sortState, rank = false, empty }: Props) {
  const navigate = useNavigate();

  if (rows.length === 0) {
    return <div className="empty">{empty ?? <p className="muted">No funds to show.</p>}</div>;
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
            <th scope="col">Fund</th>
            <th scope="col" className="num">
              NAV
            </th>
            {RETURN_COLUMNS.map((c) =>
              c.period === period ? (
                <SortHeader key={c.period} label={c.label} sortKey="return" state={sortState} />
              ) : (
                <th key={c.period} scope="col" className="num">
                  {c.label}
                </th>
              ),
            )}
            <SortHeader
              label="Volatility"
              sortKey="volatility"
              state={sortState}
              hint="How much the NAV swings, annualized over the last year. Lower is steadier."
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
              hint="1-year return divided by volatility."
            />
            <th scope="col" className="star-col">
              <span className="sr-only">Star</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const m = row.metrics;
            const href = `/fund/${row.schemeCode}`;
            return (
              <tr key={row.schemeCode} className="clickable" onClick={() => navigate(href)}>
                {rank && <td className="rank muted">{i + 1}</td>}
                <td className="name-cell wide">
                  <Link to={href} className="name-link" onClick={(e) => e.stopPropagation()}>
                    <span className="strong truncate">{shortName(row.name)}</span>
                    <span className="row-sub truncate">{shortHouse(row.fundHouse)}</span>
                  </Link>
                </td>
                <td className="num mono">{formatMoney(row.nav, 'INR')}</td>
                {RETURN_COLUMNS.map((c) => (
                  <td
                    key={c.period}
                    className={`num mono ${c.period === period ? 'strong ' : ''}${tone(m.returns[c.period])}`}
                  >
                    {pct(m.returns[c.period])}
                  </td>
                ))}
                <td className="num mono">{plainPct(m.volatility1y)}</td>
                <td className="num mono down-soft">{pct(m.maxDrawdown1y, 1)}</td>
                <td className="num mono">{ratio(m.riskAdjusted1y)}</td>
                <td className="star-col">
                  <StarButton target={{ kind: 'fund', code: row.schemeCode, name: row.name }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { shortHouse, shortName };
