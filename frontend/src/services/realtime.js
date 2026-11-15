import { io } from 'socket.io-client';

const socketOrigin = import.meta.env.VITE_SOCKET_URL
  || (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/api\/?$/, '');

export function connectRealtime(token) {
  return io(socketOrigin, {
    auth: { token },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
  });
}

export function subscribeToTeam(socket, teamId) {
  if (!socket?.connected || !teamId) return Promise.resolve(false);
  return new Promise((resolve) => {
    socket.timeout(5000).emit('team:subscribe', { teamId }, (error, result) => {
      resolve(!error && result?.success === true);
    });
  });
}
