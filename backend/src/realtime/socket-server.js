const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const env = require('../config/env');
const { requireJwtSecret } = require('../services/auth.service');
const teamsRepository = require('../repositories/teams.repository');
const { attachSocketServer, teamRoom, userRoom } = require('./team-events');

const uuidSchema = z.uuid();

function extractToken(socket) {
  const candidate = socket.handshake.auth && socket.handshake.auth.token
    || socket.handshake.headers.authorization;
  if (typeof candidate !== 'string') return null;
  return candidate.replace(/^Bearer\s+/i, '').trim() || null;
}

function acknowledge(callback, result) {
  if (typeof callback === 'function') callback(result);
}

function createSocketServer(httpServer, options = {}) {
  const socketServer = new Server(httpServer, {
    cors: { origin: env.corsOrigin },
    ...(options.connectionStateRecovery ? { connectionStateRecovery: options.connectionStateRecovery } : {}),
  });
  attachSocketServer(socketServer);

  socketServer.use(async (socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) return next(new Error('Unauthorized'));
      const payload = jwt.verify(token, requireJwtSecret());
      if (!payload || typeof payload !== 'object' || typeof payload.userId !== 'string') {
        return next(new Error('Unauthorized'));
      }
      socket.data.userId = payload.userId;
      await socket.join(userRoom(payload.userId));
      return next();
    } catch (_error) {
      return next(new Error('Unauthorized'));
    }
  });

  socketServer.on('connection', (socket) => {
    socket.on('team:subscribe', async (request, callback) => {
      const teamId = typeof request === 'string' ? request : request && request.teamId;
      if (typeof teamId !== 'string' || !uuidSchema.safeParse(teamId).success) {
        acknowledge(callback, { success: false, message: 'Invalid team room.' });
        return;
      }

      try {
        if (!await teamsRepository.isTeamMember(teamId, socket.data.userId)) {
          acknowledge(callback, { success: false, message: 'Team membership is required.' });
          return;
        }

        const room = teamRoom(teamId);
        await socket.join(room);

        // Recheck after joining so a concurrent removal cannot race the initial
        // authorization query and leave a stale socket in the private room.
        if (!await teamsRepository.isTeamMember(teamId, socket.data.userId)) {
          await socket.leave(room);
          acknowledge(callback, { success: false, message: 'Team membership is required.' });
          return;
        }

        acknowledge(callback, { success: true, teamId });
      } catch (_error) {
        acknowledge(callback, { success: false, message: 'Unable to authorize team room.' });
      }
    });

    socket.on('team:unsubscribe', async (request, callback) => {
      const teamId = typeof request === 'string' ? request : request && request.teamId;
      if (typeof teamId !== 'string' || !uuidSchema.safeParse(teamId).success) {
        acknowledge(callback, { success: false, message: 'Invalid team room.' });
        return;
      }
      await socket.leave(teamRoom(teamId));
      acknowledge(callback, { success: true, teamId });
    });
  });

  return socketServer;
}

module.exports = { createSocketServer, extractToken };
