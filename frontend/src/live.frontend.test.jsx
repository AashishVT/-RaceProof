import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { createRequire } from 'node:module';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './state/auth.jsx';
import { AuthPage } from './pages/AuthPage.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { CreateTeam } from './pages/CreateTeam.jsx';
import { TeamDetail } from './pages/TeamDetail.jsx';
import { authApi } from './services/api.js';
import { connectRealtime, subscribeToTeam } from './services/realtime.js';

const require = createRequire(import.meta.url);
const testEnv = require('../../backend/src/config/env');
const { pool } = require('../../backend/src/config/database');
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3198/api';
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://127.0.0.1:3198';
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

const fixtureUsers = [];
const fixtureEmails = [];
let hackathonId;
let teamId;
let databaseReady = false;
let observerSocket;

function LiveApplication({ start = '/register' }) {
  return <MemoryRouter initialEntries={[start]}><AuthProvider><Routes>
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/" element={<Dashboard />} />
    <Route path="/teams/new" element={<CreateTeam />} />
    <Route path="/teams/:teamId" element={<TeamDetail />} />
  </Routes></AuthProvider></MemoryRouter>;
}

async function registerOutsideUi(role) {
  const email = `live-ui.${role}.${crypto.randomUUID()}@example.com`;
  const user = await authApi.register({ name: `Live UI ${role}`, email, password: 'LiveUiPassword!2026' });
  fixtureUsers.push(user.id);
  const session = await authApi.login({ email, password: 'LiveUiPassword!2026' });
  return { ...user, ...session, email };
}

function listenOnce(socket, eventName) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}.`)), 10000);
    socket.once(eventName, (payload) => { window.clearTimeout(timer); resolve(payload); });
  });
}

describe('live React to RaceProof API and Socket.IO integration', () => {
  beforeAll(async () => {
    if (testEnv.nodeEnv !== 'test' || testEnv.databaseName !== 'raceproof_test' || !/_test$/i.test(testEnv.databaseName)) {
      throw new Error('Live React integration requires TEST_DATABASE_URL to target raceproof_test.');
    }
    const apiUrl = new URL(API_URL);
    const socketUrl = new URL(SOCKET_URL);
    const databaseTarget = testEnv.database.connectionString
      ? new URL(testEnv.database.connectionString).hostname
      : testEnv.database.host;
    if (!localHosts.has(apiUrl.hostname) || !['http:', 'https:'].includes(apiUrl.protocol)) {
      throw new Error('Live React integration requires a local API URL.');
    }
    if (!localHosts.has(socketUrl.hostname) || !['http:', 'https:'].includes(socketUrl.protocol)) {
      throw new Error('Live React integration requires a local Socket.IO URL.');
    }
    if (!localHosts.has(databaseTarget)) {
      throw new Error('Live React integration requires a local raceproof_test database.');
    }
    const identity = await pool.query('SELECT current_database() AS name');
    if (identity.rows[0].name !== 'raceproof_test') {
      throw new Error('Connected database is not raceproof_test; no live React fixtures were written.');
    }
    databaseReady = true;
    const result = await pool.query(
      `INSERT INTO hackathons (name, status, min_team_size, max_team_size)
       VALUES ($1, 'active', 1, 5) RETURNING id`,
      [`Live React ${crypto.randomUUID()}`],
    );
    hackathonId = result.rows[0].id;
  }, 30000);

  afterAll(async () => {
    cleanup();
    if (observerSocket) observerSocket.disconnect();
    try {
      if (databaseReady) {
        if (fixtureUsers.length) {
          await pool.query(
            `DELETE FROM audit_logs
             WHERE actor_id = ANY($1::UUID[]) OR ($2::UUID IS NOT NULL AND team_id = $2)`,
            [fixtureUsers, teamId || null],
          );
        }
        if (hackathonId) await pool.query('DELETE FROM hackathons WHERE id = $1', [hackathonId]);
        if (fixtureUsers.length || fixtureEmails.length) {
          await pool.query('DELETE FROM users WHERE id = ANY($1::UUID[]) OR email = ANY($2::TEXT[])', [fixtureUsers, fixtureEmails]);
        }
      }
    } finally { await pool.end(); }
  }, 30000);

  it('registers and logs in through React, creates a team, processes a real request, suggests candidates, and redeems an invite', async () => {
    window.localStorage.clear();
    const user = userEvent.setup();
    const leaderView = render(<LiveApplication />);

    await user.type(screen.getByLabelText('Full name'), 'Live UI Leader');
    const leaderEmail = `live-ui.leader.${crypto.randomUUID()}@example.com`;
    fixtureEmails.push(leaderEmail);
    await user.type(screen.getByLabelText('Email address'), leaderEmail);
    const leaderPassword = 'LiveUiPassword!2026';
    await user.type(screen.getByLabelText('Password'), leaderPassword);
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByRole('heading', { name: 'Hackathons' })).toBeInTheDocument();
    const leader = JSON.parse(window.localStorage.getItem('raceproof_user'));
    fixtureUsers.push(leader.id);
    const leaderToken = window.localStorage.getItem('raceproof_token');

    await user.click(screen.getAllByRole('link', { name: /create a team/i })[0]);
    await user.type(screen.getByLabelText('Hackathon ID'), hackathonId);
    await user.type(screen.getByLabelText('Team name'), 'Live UI Team');
    await user.click(screen.getByRole('button', { name: /create team/i }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Live UI Team' })).toBeInTheDocument(), {
      timeout: 20000,
      onTimeout: () => new Error('Live team detail did not finish loading.'),
    });
    teamId = screen.getByText(/Team ID/).querySelector('code').textContent;

    const applicant = await registerOutsideUi('applicant');
    const delay = new Promise((resolve) => window.setTimeout(resolve, 300));
    await delay;
    const requestResponse = await axios.post(
      `${API_URL}/teams/${teamId}/join-requests`,
      {},
      { headers: { Authorization: `Bearer ${applicant.token}` } },
    );
    expect(requestResponse.status).toBe(201);
    expect(await screen.findByText('Live UI applicant')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /accept/i }));
    await waitFor(() => expect(screen.getByText('Live UI applicant')).toBeInTheDocument());
    expect(await screen.findByText('People who complement your team')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /generate code/i }));
    const inviteElement = await screen.findByText(/^[A-Za-z0-9_-]{40,}$/);
    const inviteCode = inviteElement.textContent;
    observerSocket = await connectRealtime(leaderToken);
    expect(await subscribeToTeam(observerSocket, teamId)).toBe(true);
    const memberJoined = listenOnce(observerSocket, 'team:member_joined');

    leaderView.unmount();
    window.localStorage.clear();
    const loginView = render(<LiveApplication start="/login" />);
    await user.type(screen.getByLabelText('Email address'), leaderEmail);
    await user.type(screen.getByLabelText('Password'), leaderPassword);
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('heading', { name: 'Hackathons' })).toBeInTheDocument();
    expect(window.localStorage.getItem('raceproof_token')).toBe(leaderToken);

    const invitee = await registerOutsideUi('invitee');
    window.localStorage.setItem('raceproof_token', invitee.token);
    window.localStorage.setItem('raceproof_user', JSON.stringify(invitee.user));
    loginView.unmount();
    render(<LiveApplication start="/" />);
    await user.type(await screen.findByLabelText('Invite code'), inviteCode);
    await user.click(screen.getByRole('button', { name: /redeem invite/i }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Live UI Team' })).toBeInTheDocument();
    expect((await memberJoined).userId).toBe(invitee.id);
    expect(await screen.findByText('People who complement your team')).toBeInTheDocument();
  }, 90000);
});
