# Folio

A personal portfolio manager for investors who hold Indian and US assets across several brokers.

Folio records every buy, sell and dividend in a ledger and derives holdings, cost basis and returns from it. It also compares your portfolio against a target allocation and tells you when to rebalance.

> Work in progress. Architecture and decisions are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (coming soon).

## Stack

| Layer | Tech |
| --- | --- |
| Web | React, Vite, TanStack Query |
| API | NestJS (TypeScript, ESM), Drizzle ORM |
| Database | PostgreSQL 17 |
| Shared | Zod contracts, `decimal.js` money math |
| Tooling | npm workspaces, Biome, Vitest, GitHub Actions |

## Getting started

Requires Node 22+ and Docker.

```bash
npm install            # also builds packages/shared
cp .env.example .env
npm run db:up          # Postgres in Docker
npm run db:migrate     # apply migrations
npm run dev -w @folio/api
```

`GET http://localhost:3000/api/health` reports API and database status.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Run everything in watch mode |
| `npm test` | Unit tests across all workspaces |
| `npm run typecheck` | Type-check all workspaces |
| `npm run lint` | Biome lint and format check |
| `npm run db:generate` | Create a migration from schema changes |

## Layout

```
apps/api          NestJS REST API, owns Postgres
packages/shared   API contracts and domain math used by every app
```
