let io;

function teamRoom(teamId) {
  return `team:${teamId}`;
}

function userRoom(userId) {
  return `user:${userId}`;
}

function attachSocketServer(socketServer) {
  io = socketServer;
}

function reportDeliveryFailure(error) {
  console.error('Socket event delivery failed.', error && (error.code || error.name) || 'unknown');
}

function publishTeamEvents(teamId, events, options = {}) {
  if (!io) return;

  const room = teamRoom(teamId);
  const excludedUsers = new Set(options.excludeUserIds || []);
  const emit = async () => {
    if (excludedUsers.size) {
      const sockets = await io.in(room).fetchSockets();
      await Promise.all(sockets
        .filter((socket) => excludedUsers.has(socket.data.userId))
        .map((socket) => socket.leave(room)));
    }

    for (const { eventName, payload } of events) {
      let target = io.to(room);
      for (const userId of options.userIds || []) target = target.to(userRoom(userId));
      target.emit(eventName, payload);
    }

    if (options.closeTeamRoom) await io.in(room).socketsLeave(room);
  };

  void emit().catch(reportDeliveryFailure);
}

function publishTeamEvent(teamId, eventName, payload, options = {}) {
  publishTeamEvents(teamId, [{ eventName, payload }], options);
}

function isAttached() {
  return Boolean(io);
}

module.exports = { attachSocketServer, publishTeamEvent, publishTeamEvents, teamRoom, userRoom, isAttached };
