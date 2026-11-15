import { describe, expect, it, vi } from 'vitest';

vi.mock('socket.io-client', () => ({ io: vi.fn(() => ({ connected: true })) }));
import { io } from 'socket.io-client';
import { connectRealtime, subscribeToTeam } from './realtime.js';

describe('authenticated Socket.IO client', () => {
  it('connects with the JWT and retry support', () => {
    connectRealtime('jwt-value');
    expect(io).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      auth: { token: 'jwt-value' },
      reconnection: true,
      reconnectionAttempts: Infinity,
    }));
  });

  it('subscribes only after connection and returns server authorization status', async () => {
    const socket = {
      connected: true,
      timeout: vi.fn(() => socket),
      emit: vi.fn((_event, _payload, callback) => callback(null, { success: true })),
    };
    expect(await subscribeToTeam(socket, 'team-id')).toBe(true);
    expect(socket.emit).toHaveBeenCalledWith('team:subscribe', { teamId: 'team-id' }, expect.any(Function));
    socket.connected = false;
    expect(await subscribeToTeam(socket, 'team-id')).toBe(false);
  });
});
