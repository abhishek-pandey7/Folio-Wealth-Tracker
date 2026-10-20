# Folio by the numbers

Measured, not estimated. Every figure below comes from a run on 2026-10-20 and can be reproduced with the commands shown.

**Setup for all performance numbers:** one Windows 11 laptop running everything at once (load generator, Go gateway, NestJS API, Postgres in Docker, Vite dev server), Node 24, Go 1.27, live market data. A production deployment would separate these, so treat the numbers as a floor, not a ceiling. Runs on this machine vary by roughly ±50% between runs because the processes compete for the same CPU.

## Headline numbers

| KPI | Value |
| --- | --- |
| Ranking 59 large caps (Go gateway, steady state) | **713 req/s**, p50 **15 ms**, p99 **224 ms** |
| Ranking a fund category (Go gateway) | **1,409 req/s**, p50 **4 ms** |
| Cache lookups served from memory | **99.99%** of 1.6 million |
| Fix found by load testing | ranking throughput **7 → 713 req/s (~100×)**, p99 **9.9 s → 224 ms** |
| SIP backfill | **22 monthly instalments in 0.58 s**, each at the real NAV of its date |
| Go test coverage | **89.0%** of statements (67 test functions) |
| TypeScript tests | **95** (54 shared, 41 API), including **26 against a real Postgres** |
| CI per PR | 2 parallel jobs, **45 s** (TypeScript) and **66 s** (Go with race detector) |
| Gateway container image | **17.7 MB** (distroless, non-root) |
| Market coverage | **141** stocks, ETFs and indices in **19** categories; **380** mutual funds in **11** SEBI categories |
| Delivery | **15** reviewed PRs, all CI-gated |

## Performance

### Steady state

`npm run bench` (`scripts/bench.mjs`): 20 concurrent connections, 3 s warm-up, then 10 s per endpoint.

| Endpoint | req/s | p50 | p90 | p99 | Errors |
| --- | --- | --- | --- | --- | --- |
| Gateway: one quote (cache hit) | 1,557 | 7 ms | 14 ms | 25 ms | 0 |
| Gateway: rank 59 India large caps | 713 | 15 ms | 61 ms | 224 ms | 0 |
| Gateway: rank flexi cap funds | 1,409 | 4 ms | 34 ms | 155 ms | 0 |
| API: health (Postgres + gateway check) | 208 | 57 ms | 197 ms | 536 ms | 0 |
| API: ranking through the BFF, zod-validated | 73 | 246 ms | 408 ms | 849 ms | 0 |
| API: live portfolio valuation (DB, ledger replay, pricing, XIRR) | 62 | 240 ms | 605 ms | 708 ms | 0 |

### The bottleneck load testing found

The first benchmark run showed rankings at **7 req/s with a p90 of 9.9 s**, and the API's ranking endpoint failing every request.

**Cause:** a ranking overlays live prices on every symbol. Prices are cached for 15 s, and when they expired together, refreshing 59 of them through the upstream's rate limit (5 req/s, to avoid being blocked) took about 12 s. Every request waited for it.

**Fix:** stale-while-revalidate. An expired price is served at once while one shared background refresh fetches a new one (`Cache.GetFast`). The background warm job now also pre-loads prices, so the first request after a restart is fast too.

| | Before | After |
| --- | --- | --- |
| Rank 59 large caps | 7 req/s, p90 9.9 s | 713 req/s, p90 61 ms |
| Rank flexi cap funds | 285 req/s | 1,409 req/s |
| API ranking | 100% errors (timeouts) | 73 req/s, 0 errors |
| Portfolio valuation p50 | 423 ms | 240 ms |

During the after run, the cache served **136,133 expired prices instantly** while refreshing them in the background. A test proves that 20 simultaneous readers of an expired price start exactly one upstream call.

### Cold start and background work

| | Time |
| --- | --- |
| First ranking request immediately after a restart | 2.25 s |
| A never-requested category after warm-up | 0.23 s |
| Warm job: statistics and prices for 141 symbols | 54.5 s, every 45 min |
| Warm job: 5-year NAV statistics for 379 funds | 74.7 s, every 6 h |
| SIP backfill, 22 instalments at historical NAVs | 0.58 s |

### Caching

From the gateway's `/healthz` after the benchmarks:

| Cache | Hits | Misses | Served stale while refreshing |
| --- | --- | --- | --- |
| Live quotes | 348,072 | 20 | 136,133 |
| Stock statistics | 468,638 | 0 | 0 |
| Fund statistics | 649,831 | 32 | 0 |
| **All caches** | **1,481,664** | **85** | **136,133** |

That is 99.99% of lookups answered from memory, which is what keeps a free, rate-limited data source usable.

## Quality

| | Value | How to reproduce |
| --- | --- | --- |
| Go statement coverage, all internal packages | 89.0% | `go -C services/market test -coverpkg=./internal/... -coverprofile=c.out ./... && go -C services/market tool cover -func=c.out` |
| Go test functions (plus table-driven subtests) | 67 | |
| Shared package (domain maths, contracts) | 54 tests, 75.8% statements | `npx vitest run --coverage` in `packages/shared` |
| API | 41 tests, 70.3% statements | same, in `apps/api`, with `DATABASE_URL` set |
| Integration tests against real Postgres | 26 | `*.int.spec.ts`; CI runs a Postgres service container |
| Reference checks | XIRR matches Microsoft Excel's documented example (37.336%) | `packages/shared/src/xirr.test.ts` |

Bugs caught by tests before they shipped, each with a regression test:

1. Every sale would have been rejected (ledger entries keyed by symbol vs. ID).
2. Changing a SIP's day recorded two instalments in one month.
3. A missing adjusted close fell back to an unadjusted one, splicing two price scales.
4. Funds younger than a year were ranked "steadiest" on a few months of data.
5. Every 5-year return was null (the provider's range starts a few days late).

## Footprint

| | Value |
| --- | --- |
| Gateway image | 17.7 MB |
| Gateway memory, all caches warm (141 symbols, 380 funds, 100 NAV series) | 110.8 MB working set |
| Code (excluding tests, lockfiles, migrations) | Go 3,305 lines; TypeScript 7,139 lines; CSS 1,609 lines |
| Tests | Go 1,425 lines; TypeScript 1,515 lines |
| Surface | 16 gateway endpoints, 38 API endpoints, 8 pages |

## Resume-ready lines

- Built a full-stack personal portfolio manager (React, NestJS, Go, PostgreSQL) covering 141 Indian and US stocks and ETFs and 380 mutual funds across 19 stock and 11 fund categories, with live data from 4 public sources.
- Load-tested the Go market-data gateway, traced a 9.9 s p90 stall to rate-limited cache refreshes, and fixed it with stale-while-revalidate and cache pre-warming: throughput up ~100× (7 to 713 req/s), p99 down to 224 ms, 99.99% of 1.6M lookups served from memory.
- Designed a ledger-based portfolio engine (FIFO lots, realized gains, XIRR validated against Excel) that rejects impossible histories on write, using per-account row locks to prevent race conditions.
- Automated SIP tracking that backfills years of instalments at historical NAVs in under a second, idempotent through a database unique constraint.
- 89% Go test coverage, 95 TypeScript tests including 26 against real Postgres, all run on every PR in under 70 s.

## Known gaps

- **BFF overhead:** the API's ranking endpoint is about 10× slower than the gateway it wraps (73 vs 713 req/s), mostly from JSON parsing plus full zod validation of a 59-row payload on every request. Next step: cache validated responses for their TTL, or validate a sample in production.
- **TypeScript coverage** (70 to 76%) trails Go (89%). The gaps are mostly controller wiring and formatting helpers.
- **One machine:** the load generator competes with the services it measures. A deployed run would give cleaner numbers.
