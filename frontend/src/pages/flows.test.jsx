import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const teams = vi.hoisted(() => ({ create: vi.fn(), redeemInvite: vi.fn(), mine: vi.fn(), myRequests: vi.fn() }));
const hackathons = vi.hoisted(() => ({ list: vi.fn(), teams: vi.fn() }));
vi.mock('../services/api', () => ({ teamsApi: teams, hackathonsApi: hackathons, apiErrorMessage: (error) => error.message }));
vi.mock('../state/auth', () => ({ useAuth: () => ({ user: { id: 'user-1', name: 'Jordan' } }) }));

import { Dashboard } from './Dashboard.jsx';
import { CreateTeam } from './CreateTeam.jsx';

teams.mine.mockResolvedValue([]);
teams.myRequests.mockResolvedValue({ joinRequests: [], pagination: { page: 1, pageSize: 8, total: 0, totalPages: 0 } });
hackathons.list.mockResolvedValue({ hackathons: [], pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 } });

describe('team creation and invite redemption', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('creates a team using the hackathon ID and opens the returned team', async () => {
    teams.create.mockResolvedValue({ id: 'team-created' });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/teams/new']}><Routes>
      <Route path="/teams/new" element={<CreateTeam />} />
      <Route path="/teams/:teamId" element={<h1>New team opened</h1>} />
    </Routes></MemoryRouter>);
    await user.type(screen.getByLabelText('Hackathon ID'), 'hackathon-uuid');
    await user.type(screen.getByLabelText('Team name'), 'Build Together');
    await user.click(screen.getByRole('button', { name: /create team/i }));
    expect(await screen.findByRole('heading', { name: 'New team opened' })).toBeInTheDocument();
    expect(teams.create).toHaveBeenCalledWith({ hackathonId: 'hackathon-uuid', teamName: 'Build Together' });
  });

  it('redeems an invite code and opens the returned team', async () => {
    teams.redeemInvite.mockResolvedValue({ teamId: 'joined-team' });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/']}><Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/teams/:teamId" element={<h1>Joined team opened</h1>} />
    </Routes></MemoryRouter>);
    await user.type(screen.getByLabelText('Invite code'), 'secure-invite-code');
    await user.click(screen.getByRole('button', { name: /redeem invite/i }));
    expect(await screen.findByRole('heading', { name: 'Joined team opened' })).toBeInTheDocument();
    expect(teams.redeemInvite).toHaveBeenCalledWith('secure-invite-code');
  });
});
