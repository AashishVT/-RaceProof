const http = require('node:http');
const app = require('./app');
const env = require('./config/env');
const { createSocketServer } = require('./realtime/socket-server');

const server = http.createServer(app);
const io = createSocketServer(server);

server.listen(env.port, () => {
  console.log(`RaceProof API listening on port ${env.port} (${env.nodeEnv})`);
});

function shutDown(signal) {
  console.log(`${signal} received. Closing HTTP server...`);
  io.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', () => shutDown('SIGINT'));
process.on('SIGTERM', () => shutDown('SIGTERM'));
