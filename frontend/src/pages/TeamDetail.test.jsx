import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const teams = vi.hoisted(() => ({
  get: vi.fn(), join: vi.fn(), requests: vi.fn(), accept: vi.fn(), decline: vi.fn(),
  remove: vi.fn(), leave: vi.fn(), createInvite: vi.fn(), invites: vi.fn(), revokeInvite: vi.fn(),
  redeemInvite: vi.fn(), suggestions: vi.fn(),
}));
const authState = vi.hoisted(() => ({ user: null }));
const realtime = vi.hoisted(() => ({
  socket: { connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), disconnect: vi.fn() },
  subscribe: vi.fn(),
}));
vi.mock('../services/api', () => ({ teamsApi: teams, apiErrorMessage: (error) => error.message }));
vi.mock('../state/auth', () => ({ useAuth: () => ({ token: 'jwt', user: authState.user }) }));
vi.mock('../services/realtime', () => ({
  connectRealtime: () => realtime.socket,
  subscribeToTeam: realtime.subscribe,
}));

import { TeamDetail } from './TeamDetail.jsx';

const member = { userId: 'leader-1', name: 'Jordan Lee', timeZone: 'UTC', role: 'leader' };
const teammate = { userId: 'member-2', name: 'Casey Park', timeZone: 'Europe/London', role: 'member' };
const team = {
  id: 'team-1', hackathonId: 'hackathon-1', teamName: 'Signal Garden', leaderId: 'leader-1',
  hackathonStatus: 'active', minTeamSize: 2, maxTeamSize: 4, memberCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z', members: [member, teammate],
};

function mount(user = { id: 'leader-1', name: 'Jordan Lee' }) {
  authState.user = user;
  teams.get.mockResolvedValue({ ...team, members: [...team.members] });
  teams.requests.mockResolvedValue([{ id: 'request-1', userId: 'candidate-3', userName: 'Avery Chen', userEmail: 'avery@example.com', skills: ['Design'] }]);
  teams.invites.mockResolvedValue([]);
  teams.suggestions.mockResolvedValue({ teamSkillGaps: [], suggestions: [], scoring: { formula: 'skills + timezone', skillGapDefinition: 'Skills held by candidates', timeZoneBands: [] } });
  return render(<MemoryRouter initialEntries={['/teams/team-1']}><Routes><Route path="/teams/:teamId" element={<TeamDetail />} /><Route path="/" element={<h1>Dashboard</h1>} /></Routes></MemoryRouter>);
}

describe('team detail flows', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('lets a participant submit a join request', async () => {
    authState.user = { id: 'candidate-3', name: 'Avery Chen' };
    teams.get.mockResolvedValue({ ...team, members: [...team.members] });
    teams.join.mockResolvedValue({ id: 'request-1' });
    const user = userEvent.setup();
    mount(authState.user);
    await user.click(await screen.findByRole('button', { name: /request to join/i }));
    await waitFor(() => expect(teams.join).toHaveBeenCalledWith('team-1'));
    expect(await screen.findByText('Join request sent. The team leader will review it.')).toBeInTheDocument();
  });

  it('lets the leader decide requests and create then revoke an invite', async () => {
    teams.accept.mockResolvedValue({});
    teams.createInvite.mockResolvedValue({ id: 'invite-1', code: 'one-time-code', expiresAt: '2026-12-01T00:00:00.000Z' });
    teams.revokeInvite.mockResolvedValue({});
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: /accept/i }));
    await waitFor(() => expect(teams.accept).toHaveBeenCalledWith('team-1', 'request-1'));
    await user.click(screen.getByRole('button', { name: /generate code/i }));
    expect(await screen.findByText('one-time-code')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /revoke invite/i }));
    await waitFor(() => expect(teams.revokeInvite).toHaveBeenCalledWith('team-1', 'invite-1'));
  });

  it('subscribes after reconnect and coalesces repeated team events into one refresh', async () => {
    mount();
    await screen.findByRole('heading', { level: 1, name: 'Signal Garden' });
    const onConnect = realtime.socket.on.mock.calls.find(([name]) => name === 'connect')?.[1];
    expect(onConnect).toBeTypeOf('function');
    onConnect();
    expect(realtime.subscribe).toHaveBeenCalledWith(realtime.socket, 'team-1');

    const onMemberJoined = realtime.socket.on.mock.calls.find(([name]) => name === 'team:member_joined')?.[1];
    expect(onMemberJoined).toBeTypeOf('function');
    const updated = { ...team, memberCount: 3, members: [...team.members, { userId: 'new-3', name: 'Riley Moss', role: 'member', timeZone: 'UTC' }] };
    teams.get.mockResolvedValue(updated);
    await act(async () => {
      onMemberJoined({ teamId: 'team-1', userId: 'new-3' });
      onMemberJoined({ teamId: 'team-1', userId: 'new-3' });
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(await screen.findByText('Riley Moss')).toBeInTheDocument();
    await waitFor(() => expect(teams.get).toHaveBeenCalledTimes(2));
    expect(screen.getByText('3 / 4 members')).toBeInTheDocument();

    const onLeadershipTransfer = realtime.socket.on.mock.calls.find(([name]) => name === 'team:leadership_transferred')?.[1];
    const onMemberLeft = realtime.socket.on.mock.calls.find(([name]) => name === 'team:member_left')?.[1];
    const transferred = {
      ...updated,
      leaderId: 'new-3',
      members: [{ ...updated.members[2], role: 'leader' }, { ...member, role: 'member' }, teammate],
    };
    teams.get.mockResolvedValue(transferred);
    await act(async () => {
      onLeadershipTransfer({ teamId: 'team-1', toUserId: 'new-3' });
      onMemberLeft({ teamId: 'team-1', userId: 'leader-1' });
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(await screen.findByText('Leadership transferred to Riley Moss.')).toBeInTheDocument();
    expect(teams.get).toHaveBeenCalledTimes(3);
  });
});
