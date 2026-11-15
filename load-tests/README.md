# RaceProof k6 load test

`directories.js` exercises the authenticated hackathon directory, team board, dashboard team/request endpoints, and login. It runs four simultaneous constant-VU scenarios whose combined load is 100 VUs (30 + 30 + 30 + 10) for one minute. The team-board trend has a hard `p(95)<200 ms` threshold. k6's summary includes request throughput, failed-request rate, and p50/p95/p99 latency.

## Prepare test data

Follow `backend/README.md` to seed a dedicated `_test` or `_seed` database. Start the backend against that same database. Look up a seeded hackathon ID with a read-only SQL query:

```sql
SELECT id, name FROM hackathons
WHERE name LIKE 'RaceProof Seed Hackathon%'
ORDER BY name;
```

## Run reproducibly

Install k6 using the official package for your operating system. Set the API origin explicitly; `BASE_URL` is the origin only, for example a local `http://127.0.0.1:3000`. `TARGET_ENV` must be `local`, `test`, or `staging`. Production is refused unless the operator also explicitly sets `TARGET_ENV=production` and `ALLOW_PRODUCTION=YES`.

```sh
mkdir -p load-tests/artifacts
: "${SEED_PASSWORD:?Configure SEED_PASSWORD securely before running k6}"
BASE_URL=http://127.0.0.1:3000 \
TARGET_ENV=local \
HACKATHON_ID='<seeded-hackathon-uuid>' \
k6 run --summary-export=load-tests/artifacts/k6-summary.json load-tests/k6/directories.js
```

The command exits nonzero when the error-rate or p95 target fails. Keep the exported summary alongside the commit/revision and target environment for a reproducible report. Do not commit credentials, private test reports, or public-target identifiers. The load test reads `SEED_PASSWORD` from the environment. Configure it through a private local environment or secret manager; do not put its value in this file or commit it.
