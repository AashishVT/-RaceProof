# RaceProof

RaceProof helps participants in a hackathons find teammates, form teams, and coordinate joining through requests or invitation codes. The project includes a React web client and a Node.js API backed by PostgreSQL.

## Problem

Hackathon participants often need to find teammates with complementary skills and compatible schedules. Informal coordination makes team discovery, membership limits, and join decisions difficult to manage consistently. RaceProof provides searchable team discovery and auditable, concurrency-safe membership workflows.

## Features

- Registration, login, bcrypt password hashing, and JWT authenticated API requests.
- Hackathon and team directories with search, pagination, availability, and team-size rules.
- Team creation, join requests, leader decisions, member removal, and team departure.
- Invitation codes stored as hashes, with expiry, revocation, redemption, and rate limiting.
- Teammate suggestions based on skill gaps and time-zone compatibility.
- Authenticated Socket.IO team rooms and post-commit membership events.
- PostgreSQL constraints, transactional migrations, audit events, and idempotent team creation.
- Seed tooling for isolated performance-test data.

## Architecture

```text
React + Vite browser client
          │ HTTP / Socket.IO
          ▼
Express API ── authentication, validation, authorization
          │
          ├── services: transactions and business rules
          ├── repositories: parameterized PostgreSQL queries
          └── PostgreSQL: constraints, indexes, migrations, audit log
```

Membership-changing operations use PostgreSQL transactions and row locks, with unique constraints as a second line of protection. Realtime events are published after successful commits. The frontend uses the API as the source of truth.

## Technology

- Backend: Node.js 20+, Express 5, PostgreSQL, `pg`, bcrypt, JWT, Socket.IO.
- Frontend: React 19, Vite, React Router, Axios, Socket.IO client.
- Verification: Jest, Supertest, Vitest, Testing Library, and k6.
- CI: GitHub Actions with an ephemeral PostgreSQL service.

## Local setup

Requirements: Node.js 20 or later, npm, and Docker Compose or a local PostgreSQL installation.

1. Install dependencies:

   ```sh
   cd backend && npm ci
   cd ../frontend && npm ci
   ```

2. Configure local files from the examples. These files are ignored by Git:

   ```sh
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env.local
   ```

   Set local PostgreSQL connection settings and a strong `JWT_SECRET` in `backend/.env`. Set the browser API and Socket.IO origins in `frontend/.env.local`. Never put server secrets or database credentials in Vite variables. A root `.env.local` loaded by the backend takes precedence over `backend/.env`; keep any existing local configuration private.

3. Start PostgreSQL. With Docker Compose, configure `DB_PASSWORD` in `backend/.env`, then run from the repository root:

   ```sh
   docker compose --env-file backend/.env up -d
   ```

4. Apply migrations and start the API:

   ```sh
   cd backend
   npm run db:migrate
   npm start
   ```

5. In another terminal, start the web client:

   ```sh
   cd frontend
   npm run dev
   ```

The API health endpoints are `/api/health` and `/api/health/db`.

## Environment configuration

Use private local environment files or a secret manager. The table lists names and purposes only; it contains no credential values.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Selects development, test, or production behavior. |
| `PORT` | Backend HTTP and Socket.IO port. |
| `CORS_ORIGIN` | Browser origin allowed by the API. |
| `DATABASE_URL` | PostgreSQL connection URL for the application; takes precedence over discrete connection fields. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Discrete PostgreSQL connection settings when `DATABASE_URL` is not used. |
| `DB_POOL_MAX` | Maximum backend PostgreSQL pool size. |
| `DB_IDLE_TIMEOUT_MS`, `DB_CONNECTION_TIMEOUT_MS` | Pool idle and connection timeout settings. |
| `TEST_DATABASE_URL` | Dedicated database URL used when `NODE_ENV=test`; must identify a separate `_test` database. |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Signing key and access-token lifetime. |
| `BCRYPT_SALT_ROUNDS` | Password-hashing work factor. |
| `DB_TIMING` | Enables development-only pool, query, and route timing summaries. |
| `SEED_DATABASE_URL` | Dedicated `_test` or `_seed` database used by the seed script. |
| `SEED_ENVIRONMENT` | Explicit non-production confirmation required by the seed tooling. |
| `SEED_PASSWORD` | Required password used to hash seeded demo accounts and by the k6 login scenario. Supply it privately; the seed command has no default. |
| `SEED_RESET` | Additional explicit confirmation required with the seed reset option. |
| `VITE_API_URL`, `VITE_SOCKET_URL` | Public browser API base and Socket.IO origin; never place secrets here. |
| `RACEPROOF_API_URL`, `RACEPROOF_SOCKET_URL` | Local origins for the live backend verification script. |
| `BASE_URL`, `TARGET_ENV`, `ALLOW_PRODUCTION`, `HACKATHON_ID` | k6 target origin, target classification, explicit production opt-in, and seeded hackathon identifier. |

See [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example) for variable names. Do not commit `.env`, `.env.local`, `.neon`, populated environment files, or generated credentials.

## Database migrations and seed data

Migrations are ordered SQL files under `backend/src/database/migrations`. The migration runner records applied files and runs each migration transactionally:

```sh
cd backend
npm run db:migrate
```

For performance testing, configure `SEED_DATABASE_URL` for an isolated, non-production database whose name ends in `_test` or `_seed`, configure `SEED_PASSWORD` privately, and set `SEED_ENVIRONMENT=non-production`. Apply the schema to that database before seeding. The seed script checks the database identity and schema and refuses production targets. It generates deterministic demo users, hackathons, teams, and memberships. Do not run seed reset options against data you need to preserve.

## API overview

All feature routes are under `/api` and require a bearer token except registration and login.

| Area | Routes |
| --- | --- |
| Authentication | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Hackathons | `GET /hackathons`, `GET /hackathons/:hackathonId`, `GET /hackathons/:hackathonId/teams` |
| Teams | Create, detail, current-user teams and requests, join requests, accept/decline, leave, and member removal under `/teams` |
| Invitations | Create, list, revoke, and redeem under `/teams/:teamId/invites` and `/teams/invites/redeem` |
| Suggestions | `GET /teams/:teamId/suggestions` |
| Health | `GET /health`, `GET /health/db` |
| Realtime | Authenticated Socket.IO connections and authorized team subscriptions |

Request validation and role checks are enforced by the API. See [`backend/README.md`](backend/README.md) for request and response details.

## Tests and CI

Backend Jest integration tests require a dedicated local PostgreSQL database named `raceproof_test`, with `TEST_DATABASE_URL` targeting that local database and migrations applied. Do not point test commands at production or remote databases.

```sh
cd backend
NODE_ENV=test npm test -- --runInBand
```

Frontend unit and component tests do not require a database:

```sh
cd frontend
npm test
npm run build
```

The opt-in live frontend verification scripts require a local backend and local `raceproof_test`; they reject non-loopback API and database targets. GitHub Actions runs backend and frontend tests and builds the frontend using an ephemeral PostgreSQL service. No CI result is claimed here.

## Load testing and known limitations

The k6 scenario in [`load-tests/k6/directories.js`](load-tests/k6/directories.js) runs 100 VUs for one minute across the directories, team board, dashboard requests, and login. It enforces the configured team-board p95 threshold of 200 ms. Follow [`load-tests/README.md`](load-tests/README.md) and provide `SEED_PASSWORD` through a private environment. Use only an isolated test target.

The latest measurements supplied for this project did **not** meet the board target: board latency p95 was 4.8 seconds, and the team-board route p95 was about 3.83–4.17 seconds. The same run reported pool checkout p95 around 3.08 seconds with a pool max of 10 and up to 90 waiting requests. These measurements are workload-specific; no improvement or target achievement is claimed. Query-plan analysis against the remote database has not been performed from this environment.
