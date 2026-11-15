import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn(), me: vi.fn() }));
vi.mock('../services/api', () => ({ authApi: apiMock, apiErrorMessage: (error) => error.message }));

import { AuthProvider } from '../state/auth.jsx';
import { AuthPage } from './AuthPage.jsx';

function renderAuth(mode) {
  return render(<MemoryRouter initialEntries={[`/${mode}`]}><AuthProvider><Routes>
    <Route path={`/${mode}`} element={<AuthPage mode={mode} />} />
    <Route path="/" element={<h1>Dashboard</h1>} />
  </Routes></AuthProvider></MemoryRouter>);
}

describe('authentication screens', () => {
  beforeEach(() => {
    apiMock.me.mockResolvedValue({ id: 'user-1', name: 'Jordan' });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('logs in, persists the session, and navigates to the dashboard', async () => {
    apiMock.login.mockResolvedValue({ token: 'signed-token', user: { id: 'user-1', name: 'Jordan' } });
    renderAuth('login');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email address'), 'jordan@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-12');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(apiMock.login).toHaveBeenCalledWith({ email: 'jordan@example.com', password: 'correct-horse-12' });
    expect(window.localStorage.getItem('raceproof_token')).toBe('signed-token');
    expect(JSON.parse(window.localStorage.getItem('raceproof_user'))).toMatchObject({ id: 'user-1' });
  });

  it('registers, signs in, and reports a useful API error', async () => {
    apiMock.register.mockResolvedValue({ id: 'user-2', name: 'Casey' });
    apiMock.login.mockResolvedValue({ token: 'new-token', user: { id: 'user-2', name: 'Casey' } });
    renderAuth('register');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Full name'), 'Casey');
    await user.type(screen.getByLabelText('Email address'), 'casey@example.com');
    await user.type(screen.getByLabelText('Password'), 'strong-password-2');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(apiMock.register).toHaveBeenCalledWith({ name: 'Casey', email: 'casey@example.com', password: 'strong-password-2' });
    expect(apiMock.login).toHaveBeenCalledOnce();

    cleanup(); window.localStorage.clear(); vi.clearAllMocks();
    apiMock.login.mockRejectedValue(new Error('Invalid email or password.'));
    renderAuth('login');
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'bad@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.'));
  });
});
