import { FxRateSchema, HealthStatusSchema } from '@folio/shared';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '../api.js';

export function StatusBar() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => getJson('/api/health', HealthStatusSchema),
    refetchInterval: 30_000,
  });
  const fx = useQuery({
    queryKey: ['fx', 'USD', 'INR'],
    queryFn: () => getJson('/api/market/fx?base=USD&quote=INR', FxRateSchema),
    staleTime: 30 * 60_000,
  });

  const services = [
    { label: 'API', up: health.isSuccess },
    { label: 'Database', up: health.data?.database === 'up' },
    { label: 'Market data', up: health.data?.marketGateway === 'up' },
  ];
  const allUp = services.every((s) => s.up);

  return (
    <div className="status-bar">
      {fx.data && (
        <span className="fx" title={`European Central Bank reference rate for ${fx.data.date}`}>
          <span className="muted">USD/INR</span>
          <span className="mono strong">{Number(fx.data.rate).toFixed(2)}</span>
        </span>
      )}
      {/* The dot carries real state: green only when every backing service answers. */}
      <span
        className="health"
        role="status"
        title={services.map((s) => `${s.label}: ${s.up ? 'up' : 'down'}`).join('\n')}
        aria-label={allUp ? 'All systems up' : 'Some services are down'}
      >
        <span className={`dot ${health.isPending ? 'pending' : allUp ? 'up' : 'down'}`} aria-hidden />
        <span className="muted">
          {health.isPending ? 'Checking' : allUp ? 'Live' : `${services.filter((s) => !s.up).length} down`}
        </span>
      </span>
    </div>
  );
}
