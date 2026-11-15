# RaceProof Backend

Express API for RaceProof with PostgreSQL connectivity, transactional SQL migrations, JWT authentication, team formation, invite and suggestion APIs, and Socket.IO updates.

## Requirements

- Node.js 20 or later
- npm

## Setup

From this directory, install the dependencies:

```sh
npm install
```

Copy `.env.example` to `.env` and adjust values if needed:

```sh
cp .env.example .env
```

Set a local development password in `backend/.env`. The file is ignored by Git. From the project root, start PostgreSQL with Docker Compose, passing that file for variable substitution:

```sh
docker compose --env-file backend/.env up -d
```

Run the SQL migrations from the backend directory:

```sh
npm run db:migrate
```

The migration runner applies sorted `.sql` files once, records each filename in `schema_migrations`, and wraps each migration and its tracking record in one transaction.

Authentication reads `JWT_SECRET`, `JWT_EXPIRES_IN`, and `BCRYPT_SALT_ROUNDS` from the environment. Replace the example JWT secret with a random value of at least 32 bytes before using authentication; the example placeholder is rejected. Passwords are hashed with bcrypt (12 rounds by default); plaintext passwords and password hashes are never included in API responses.

The app also loads the root `.env.local` created by Neon CLI. Its pooled `DATABASE_URL` takes precedence over the local Docker connection fields; `TEST_DATABASE_URL` is used only for a test database. Both files are git-ignored. Keep their values private.

## Run the API

Development mode (automatic restart on file changes):

```sh
npm run dev
```

Production mode:

```sh
npm start
```

The server listens on `PORT` (default `3000`). `CORS_ORIGIN` accepts `*` or one allowed origin. Set `NODE_ENV=production` for production logging and behavior.

## Verify

Request the health endpoint:

```sh
curl http://localhost:3000/api/health
```

Expected response:

```json
{"success":true,"message":"RaceProof API is running"}
```

An unknown route returns HTTP 404 with a JSON error response. Unexpected server errors return HTTP 500 without exposing internal details to the client.

Check database connectivity after PostgreSQL is healthy and migrations have run:

```sh
curl http://localhost:3000/api/health/db
```

Expected response:

```json
{"success":true,"message":"Database connected successfully"}
```

The database health route returns HTTP 503 when PostgreSQL cannot be reached. Stop the database with `docker compose --env-file backend/.env down`; persistent data remains in the named Docker volume. To remove that data as well, explicitly run `docker compose --env-file backend/.env down -v`.

## Deterministic demo seed

The seed command requires `SEED_DATABASE_URL` and `SEED_PASSWORD`. It fails before connecting if either is missing. Configure `SEED_PASSWORD` through an untracked local environment or secret manager; never commit or log its value. It refuses database names that do not end in `_test` or `_seed`, checks the connected database identity and required schema constraints, and inserts a deterministic fixture set in one transaction. Repeated runs preserve the same users, hackathons, teams, and memberships without duplicates. It does not seed development or production databases.

Configure `SEED_DATABASE_URL` and `SEED_PASSWORD` through an untracked local environment or secret manager. Point `DATABASE_URL` at the same isolated target while applying its migrations. Then explicitly set `SEED_ENVIRONMENT=non-production` and run:

```sh
npm run db:seed
```

It creates 10,000 participant accounts, four active hackathons, 2,000 teams, and 7,000 team memberships. Team sizes alternate between three and four (hackathon limits are two through five). The seeded accounts use a shared password supplied through `SEED_PASSWORD`; configure it in an untracked local environment or secret manager. Never use these fixtures on a public or production system. The script reports only the verified database name and generated row counts.

Apply pending migrations to the dedicated seed database with its identity-guarded command before seeding:

```sh
SEED_ENVIRONMENT=non-production npm run db:migrate:seed
```

This command verifies the root `.env.local` database names and checks `current_database()` is exactly `raceproof_seed` before running the existing migration runner.

To remove and recreate only the deterministic seed users/hackathons, pass both explicit reset switches. Reset requires the same `_test` or `_seed` database-name guard and runs in the same transaction as the seed:

```sh
SEED_ENVIRONMENT=non-production SEED_RESET=1 npm run db:seed -- --reset
```

Never point `SEED_DATABASE_URL` at a production database. `--reset` deletes the seeded hackathons (cascading their teams and dependent records) and seed users; it does not truncate tables or remove unrelated rows.

## Authentication API

All request bodies are JSON. Validation errors return HTTP 400 with `success: false`, a message, and field-level `details`. Login failures use the same HTTP 401 response for an unknown email and an incorrect password.

### `POST /api/auth/register`

Public endpoint. Email is trimmed and normalized to lowercase. Passwords must contain 8–72 characters and at most 72 UTF-8 bytes.

Request:

```json
{
  "name": "John",
  "email": "john@example.com",
  "password": "<password>"
}
```

Success: HTTP 201. The response contains a safe user profile and never contains `password_hash`.

```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": "<uuid>",
      "name": "John",
      "email": "john@example.com",
      "skills": [],
      "timeZone": "UTC",
      "createdAt": "<timestamp>"
    }
  }
}
```

An existing email returns HTTP 409. Invalid or missing fields return HTTP 400. A database/configuration failure returns HTTP 500 without exposing internal details.

### `POST /api/auth/login`

Public endpoint.

Request:

```json
{
  "email": "john@example.com",
  "password": "<password>"
}
```

Success: HTTP 200 with a signed JWT and safe user profile.

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "<jwt>",
    "expiresIn": "15m",
    "user": {
      "id": "<uuid>",
      "name": "John",
      "email": "john@example.com",
      "skills": [],
      "timeZone": "UTC",
      "createdAt": "<timestamp>"
    }
  }
}
```

Invalid credentials return HTTP 401 with `{"success":false,"message":"Invalid email or password."}`. Invalid input returns HTTP 400. A missing or invalid JWT secret returns a generic HTTP 500.

### `GET /api/auth/me`

Requires `Authorization: Bearer <jwt>`. Success: HTTP 200 with the authenticated user's current profile. Missing, invalid, or expired tokens return HTTP 401. The endpoint never returns a password hash.

## Authentication tests

The Jest/Supertest integration suite uses a real PostgreSQL database; it does not mock registration or login queries. Create a separate database named `raceproof_test`, then apply migrations to it before running tests. From the project root, one way to create it in the Compose container is:

```sh
docker compose --env-file backend/.env exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" raceproof_test'
cd backend
DB_NAME=raceproof_test npm run db:migrate
DB_NAME=raceproof_test npm test
```

The suite refuses to run against a database whose name does not end in `_test`. It checks the required `users` columns before making requests and removes the uniquely generated test users afterward. The tests cover registration, duplicate and invalid input, login, missing/invalid/expired JWTs, the current-user endpoint, and the existing API health endpoint.

## Hackathon and team directory API

All endpoints below require `Authorization: Bearer <jwt>`.

- `GET /api/hackathons?page=1&pageSize=20&q=design&status=upcoming,active` lists searchable hackathons. `pageSize` is capped at 100. Status accepts `upcoming`, `active`, `completed`, and `cancelled`.
- `GET /api/hackathons/:hackathonId` returns one hackathon.
- `GET /api/hackathons/:hackathonId/teams?page=1&pageSize=20&q=design&availableOnly=true` lists teams with capacity metadata. Team rows do not include user emails or credentials.
- `GET /api/teams/my` returns the authenticated user’s team memberships across hackathons.
- `GET /api/teams/my/requests?page=1&pageSize=20` returns that user’s pending join requests.
- `GET /api/teams/:teamId/invites` is leader-only and returns invite status/expiry metadata. It never returns the stored invite hash or the raw code; raw codes are returned only by invite creation.

List responses include `data.pagination` with `page`, `pageSize`, `total`, and `totalPages` where pagination applies.
