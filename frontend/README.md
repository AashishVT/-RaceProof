# RaceProof frontend

React + Vite client for the RaceProof API. From this directory:

```sh
npm install
cp .env.example .env.local
npm run dev
```

Configure `VITE_API_URL` (the API base, including `/api`) and `VITE_SOCKET_URL` (the Socket.IO server origin). These are public client settings; do not put database URLs or server secrets in Vite variables.

The client uses the existing API routes: `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, team create/detail/join-request/member routes, invite create/revoke/redeem routes, and `/api/teams/:teamId/suggestions`. Authenticated requests use `Authorization: Bearer <token>`. Socket connections authenticate with the same token and call `team:subscribe`; the server remains the authority for room membership.

The existing API does not provide hackathon/team directory, “my team”, personal pending-request, or invite-list routes. The dashboard and team setup identify those limitations instead of showing fabricated records. Team size comes from the selected hackathon’s server-side rules. Newly created invite codes are only shown during the current page session because the API returns the plaintext code only at creation.

Run frontend checks with:

```sh
npm test
npm run build
```

`npm run test:live` runs a real HTTP and Socket.IO smoke flow against a local backend. `npm run test:live:ui` mounts the React flows in jsdom against the same local server. Both require a local loopback API, Socket.IO server, and PostgreSQL database named `raceproof_test`; remote targets are refused. They create unique synthetic test fixtures and remove them afterward. Keep the isolated fixture database separate from all real environments.
