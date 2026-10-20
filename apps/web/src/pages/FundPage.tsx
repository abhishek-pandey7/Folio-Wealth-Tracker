import { formatMoney } from '@folio/shared';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router';
import { shortHouse, shortName } from '../components/FundTable.js';
import { PriceChart } from '../components/PriceChart.js';
import { StarButton } from '../components/StarButton.js';
import { ReturnsStrip, RiskPanel } from '../components/StatGrid.js';
import { pct, tone } from '../lib/format.js';
import { useFundStats } from '../lib/queries.js';
import { SkeletonRows } from './MarketsPage.js';

export function FundPage() {
  const { code = '' } = useParams();
  const stats = useFundStats(code);
  const fund = stats.data;

  return (
    <div className="page">
      <Link to="/funds" className="back-link">
        <ArrowLeftIcon size={14} /> Funds
      </Link>

      <header className="detail-head">
        <div>
          <h1>{fund ? shortName(fund.name) : <span className="skeleton" style={{ width: '18rem' }} />}</h1>
          {fund && (
            <p className="detail-meta">
              <span>{shortHouse(fund.fundHouse)}</span>
              <span className="tag">{fund.category.replace(/^.*? - /, '')}</span>
              <span className="mono muted">Scheme {fund.schemeCode}</span>
            </p>
          )}
        </div>
        <div className="detail-price">
          {fund ? (
            <>
              <span className="figure">{formatMoney(fund.nav, 'INR')}</span>
              <span className={`mono ${tone(fund.metrics.returns['1d'])}`}>
                {pct(fund.metrics.returns['1d'])} on {fund.navDate}
              </span>
            </>
          ) : (
            <span className="skeleton" style={{ width: '8rem', height: '1.75rem' }} />
          )}
          <StarButton target={{ kind: 'fund', code, name: fund?.name }} label />
        </div>
      </header>

      {stats.error && <p className="inline-error">{stats.error.message}</p>}

      <PriceChart source={{ kind: 'fund', code }} />

      {stats.isPending ? (
        <SkeletonRows count={4} />
      ) : (
        fund && (
          <div className="grid-2">
            <ReturnsStrip metrics={fund.metrics} />
            <RiskPanel metrics={fund.metrics} />
          </div>
        )
      )}
      <p className="disclaimer">
        Computed from AMFI's published NAVs for the Direct Growth plan. Past performance does not predict future
        returns.
      </p>
    </div>
  );
}
