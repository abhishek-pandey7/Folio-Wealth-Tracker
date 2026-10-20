// Load test for the running stack: node scripts/bench.mjs
// Expects the API on :3000 and the Go gateway on :8081, with caches warm.
// Each target gets a 3 s warm-up first, so results are steady state; cold start is measured separately.
import autocannon from 'autocannon';

const API = process.env.API_URL ?? 'http://localhost:3000';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:8081';
const DURATION = Number(process.env.DURATION ?? 10);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 20);

const targets = [
  { name: 'Gateway: quote (cache hit)', url: `${GATEWAY}/v1/quotes/RELIANCE.NS` },
  { name: 'Gateway: rank 59 large caps', url: `${GATEWAY}/v1/screener?universe=in-large&period=1y&limit=100` },
  { name: 'Gateway: rank flexi cap funds', url: `${GATEWAY}/v1/funds/screener?category=flexi-cap&limit=100` },
  { name: 'API: health (DB + gateway)', url: `${API}/api/health` },
  { name: 'API: screener via BFF + zod', url: `${API}/api/market/screener?universe=in-large&period=1y&limit=100` },
  { name: 'API: portfolio valuation', url: `${API}/api/portfolio` },
];

const run = (url) =>
  new Promise((resolve, reject) => {
    const instance = autocannon(
      { url, connections: CONNECTIONS, duration: DURATION, warmup: { connections: CONNECTIONS, duration: 3 } },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
    instance.on('error', reject);
  });

const rows = [];
for (const t of targets) {
  const r = await run(t.url);
  rows.push({
    endpoint: t.name,
    'req/s': Math.round(r.requests.average),
    'p50 ms': r.latency.p50,
    'p90 ms': r.latency.p90,
    'p99 ms': r.latency.p99,
    errors: r.errors + r.non2xx,
  });
  console.error(`done: ${t.name}`);
}
console.table(rows);
console.log(JSON.stringify({ connections: CONNECTIONS, durationSeconds: DURATION, rows }, null, 2));
