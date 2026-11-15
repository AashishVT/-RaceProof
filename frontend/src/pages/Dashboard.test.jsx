import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const teams = vi.hoisted(() => ({ mine: vi.fn(), myRequests: vi.fn(), redeemInvite: vi.fn() }));
const hackathons = vi.hoisted(() => ({ list: vi.fn(), teams: vi.fn() }));
vi.mock('../services/api', () => ({ teamsApi: teams, hackathonsApi: hackathons, apiErrorMessage: (error) => error.message }));

import { Dashboard } from './Dashboard.jsx';

const hackathon = { id: 'hackathon-1', name: 'Circuit Jam', status: 'active', minTeamSize: 2, maxTeamSize: 5 };
const myTeam = { id: 'team-mine', hackathonId: 'hackathon-1', teamName: 'Inkwell', hackathonName: 'Circuit Jam', hackathonStatus: 'active', userRole: 'leader', memberCount: 1, maxTeamSize: 5, members: [] };

describe('dashboard directory integration', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('renders account teams, pending requests, searchable hackathons and teams', async () => {
    teams.mine.mockResolvedValue([myTeam]);
    teams.myRequests.mockResolvedValue({ joinRequests: [{ id: 'request-1', teamId: 'team-open', teamName: 'Waiting Team', hackathonName: 'Circuit Jam', createdAt: '2026-11-14T00:00:00Z' }] });
    hackathons.list.mockResolvedValue({ hackathons: [hackathon], pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 } });
    hackathons.teams.mockResolvedValue({ hackathonId: hackathon.id, teams: [{ id: 'team-open', teamName: 'Open Circuit', hackathonName: 'Circuit Jam', memberCount: 2, maxTeamSize: 5, seatsAvailable: 3 }], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 } });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Inkwell' })).toBeInTheDocument();
    expect(await screen.findByText('Waiting Team')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Circuit Jam/ })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Open Circuit' })).toBeInTheDocument();
    expect(hackathons.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'upcoming,active' }));
    expect(hackathons.teams).toHaveBeenCalledWith('hackathon-1', expect.objectContaining({ availableOnly: true }));

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search hackathons'), 'Circuit');
    await waitFor(() => expect(hackathons.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Circuit' })));
    await user.type(screen.getByLabelText('Search teams'), 'Open');
    await waitFor(() => expect(hackathons.teams).toHaveBeenLastCalledWith('hackathon-1', expect.objectContaining({ q: 'Open' })));
    window.dispatchEvent(new CustomEvent('raceproof:team-change', { detail: { teamId: 'team-mine' } }));
    await waitFor(() => expect(teams.mine).toHaveBeenCalledTimes(2));
    expect(teams.myRequests).toHaveBeenCalledTimes(2);
  });
});
