import { PERIODS, type Period, PeriodSchema, type SortKey, SortKeySchema, type Universe } from '@folio/shared';
import { Link, useParams, useSearchParams } from 'react-router';
import { ScreenTable } from '../components/ScreenTable.js';
import { Segmented } from '../components/Segmented.js';
import { PERIOD_LABELS } from '../lib/format.js';
import { useScreen, useUniverses } from '../lib/queries.js';
import { SkeletonRows } from './MarketsPage.js';

const ORDER_LABELS = { best: 'Best first', worst: 'Worst first' } as const;
type Order = keyof typeof ORDER_LABELS;

/** Screen state lives in the URL, so a ranking can be bookmarked or shared. */
export function useScreenParams(defaults: { period: Period; sort: SortKey }) {
  const [params, setParams] = useSearchParams();
  const period = PeriodSchema.safeParse(params.get('period')).data ?? defaults.period;
  const sort = SortKeySchema.safeParse(params.get('sort')).data ?? defaults.sort;
  const order: Order = params.get('order') === 'worst' ? 'worst' : 'best';

  const update = (next: Partial<{ period: Period; sort: SortKey; order: Order }>) => {
    const merged = { period, sort, order, ...next };
    setParams({ period: merged.period, sort: merged.sort, order: merged.order }, { replace: true });
  };
  const onSort = (key: SortKey) =>
    update(key === sort ? { order: order === 'best' ? 'worst' : 'best' } : { sort: key, order: 'best' });

  return { period, sort, order, update, onSort };
}

export function DiscoverPage() {
  const { universeId = 'in-large' } = useParams();
  const universes = useUniverses();
  const { period, sort, order, update, onSort } = useScreenParams({ period: '1y', sort: 'return' });
  const screen = useScreen({ universe: universeId, period, sort, order, limit: 100 });
  const current = universes.data?.find((u) => u.id === universeId);

  const groups = new Map<string, Universe[]>();
  for (const u of universes.data ?? []) {
    groups.set(u.group, [...(groups.get(u.group) ?? []), u]);
  }

  return (
    <div className="page discover">
      <aside className="sidebar" aria-label="Categories">
        {[...groups].map(([group, list]) => (
          <div key={group} className="sidebar-group">
            <h3>{group}</h3>
            {list.map((u) => (
              // Carries the current period and sort, so switching category keeps the ranking.
              <Link
                key={u.id}
                to={`/discover/${u.id}?period=${period}&sort=${sort}&order=${order}`}
                className={u.id === universeId ? 'active' : undefined}
              >
                {u.name}
                <span className="muted">{u.count}</span>
              </Link>
            ))}
          </div>
        ))}
      </aside>

      <section className="panel discover-main" aria-label={current?.name ?? 'Category'}>
        <header className="page-head">
          <h1>{current?.name ?? 'Discover'}</h1>
          {current && <p className="muted">{current.description}</p>}
        </header>
        <div className="toolbar">
          <Segmented
            label="Period"
            value={period}
            options={PERIODS}
            onChange={(p) => update({ period: p })}
            format={(p) => PERIOD_LABELS[p]}
          />
          <Segmented
            label="Order"
            value={order}
            options={['best', 'worst'] as const}
            onChange={(o) => update({ order: o })}
            format={(o) => ORDER_LABELS[o]}
          />
        </div>
        <p className="muted small toolbar-hint">
          Click a column heading to rank by it. Click it again to flip the order.
        </p>
        {screen.isPending ? (
          <SkeletonRows count={10} />
        ) : screen.error ? (
          <p className="inline-error">{screen.error.message}</p>
        ) : (
          <>
            <ScreenTable rows={screen.data.rows} period={period} sortState={{ sort, order, onSort }} rank />
            {Object.keys(screen.data.unavailable).length > 0 && (
              <p className="footnote">Could not load: {Object.keys(screen.data.unavailable).join(', ')}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
