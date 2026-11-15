'use strict';

const { EventEmitter } = require('node:events');
const { createDbTiming } = require('../src/utils/db-timing');

describe('development database timing instrumentation', () => {
  test('records pool checkout and SQL execution durations when enabled', async () => {
    const logs = [];
    const client = {
      query: jest.fn(() => Promise.resolve({ rows: [] })),
    };
    const pool = {
      options: { max: 10, connectionTimeoutMillis: 120000, idleTimeoutMillis: 30000 },
      totalCount: 1,
      idleCount: 0,
      waitingCount: 1,
      connect: jest.fn((callback) => callback(null, client, jest.fn())),
    };
    const timing = createDbTiming(pool, {
      enabled: true,
      environment: 'development',
      log: (entry) => logs.push(entry),
    });

    await new Promise((resolve, reject) => {
      pool.connect((error, acquired) => {
        if (error) return reject(error);
        return acquired.query('SELECT id FROM sample WHERE id = $1', [1]).then(resolve, reject);
      });
    });
    const request = {
      method: 'GET',
      baseUrl: '/api/hackathons',
      route: { path: '/:hackathonId/teams' },
      path: '/some-id/teams',
    };
    const response = new EventEmitter();
    timing.routeMiddleware(request, response, () => response.emit('finish'));
    timing.flush();

    const sample = logs.find((entry) => entry.event === 'sample');
    expect(sample.pool.checkoutCount).toBe(1);
    expect(sample.pool.checkoutQueued).toBe(1);
    expect(sample.queries).toEqual(expect.arrayContaining([
      expect.objectContaining({ query: 'SELECT id FROM sample WHERE id = $1', count: 1 }),
    ]));
    expect(sample.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: 'GET /api/hackathons/:hackathonId/teams', count: 1 }),
    ]));
    timing.stop();
  });

  test('does not enable instrumentation outside development', () => {
    const pool = { connect: jest.fn() };
    const timing = createDbTiming(pool, { enabled: true, environment: 'production', log: jest.fn() });
    expect(timing.enabled).toBe(false);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
