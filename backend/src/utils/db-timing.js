'use strict';

const { performance } = require('node:perf_hooks');

function percentile(values, percent) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return Number(sorted[Math.ceil((percent / 100) * sorted.length) - 1].toFixed(2));
}

function sqlLabel(query) {
  const text = typeof query === 'string' ? query : query && query.text;
  return String(text || 'unknown query').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function createDbTiming(pool, {
  enabled = false,
  environment = process.env.NODE_ENV,
  intervalMs = 10_000,
  log = (entry) => console.log(`[db-timing] ${JSON.stringify(entry)}`),
} = {}) {
  if (!enabled || environment !== 'development') {
    return { enabled: false, routeMiddleware: (_request, _response, next) => next(), flush() {} };
  }

  const checkouts = [];
  const routeDurations = new Map();
  const queries = new Map();
  const originalConnect = pool.connect.bind(pool);
  let interval;

  function recordCheckout(started, snapshot, error) {
    checkouts.push({
      durationMs: performance.now() - started,
      waitingBefore: snapshot.waiting,
      totalBefore: snapshot.total,
      idleBefore: snapshot.idle,
      failed: Boolean(error),
    });
  }

  function recordQuery(label, started, error) {
    const samples = queries.get(label) || [];
    samples.push({ durationMs: performance.now() - started, failed: Boolean(error) });
    queries.set(label, samples);
  }

  function instrumentClient(client) {
    if (client.__dbTimingWrapped) return;
    Object.defineProperty(client, '__dbTimingWrapped', { value: true });
    const originalQuery = client.query;
    client.query = function timedQuery(...args) {
      const started = performance.now();
      const label = sqlLabel(args[0]);
      const callbackIndex = args.length - 1;
      if (typeof args[callbackIndex] === 'function') {
        const callback = args[callbackIndex];
        args[callbackIndex] = function timedCallback(error, ...results) {
          recordQuery(label, started, error);
          return callback.call(this, error, ...results);
        };
        try {
          return originalQuery.apply(this, args);
        } catch (error) {
          recordQuery(label, started, error);
          throw error;
        }
      }

      let result;
      try {
        result = originalQuery.apply(this, args);
      } catch (error) {
        recordQuery(label, started, error);
        throw error;
      }
      if (!result || typeof result.then !== 'function') return result;
      return result.then(
        (value) => { recordQuery(label, started); return value; },
        (error) => { recordQuery(label, started, error); throw error; },
      );
    };
  }

  pool.connect = function timedConnect(...args) {
    const started = performance.now();
    const snapshot = {
      waiting: pool.waitingCount,
      total: pool.totalCount,
      idle: pool.idleCount,
    };
    const callbackIndex = args.length - 1;
    if (typeof args[callbackIndex] === 'function') {
      const callback = args[callbackIndex];
      args[callbackIndex] = (error, client, release) => {
        recordCheckout(started, snapshot, error);
        if (client) instrumentClient(client);
        return callback(error, client, release);
      };
      try {
        return originalConnect(...args);
      } catch (error) {
        recordCheckout(started, snapshot, error);
        throw error;
      }
    }

    return originalConnect(...args).then((client) => {
      recordCheckout(started, snapshot);
      instrumentClient(client);
      return client;
    }, (error) => {
      recordCheckout(started, snapshot, error);
      throw error;
    });
  };

  function routeMiddleware(request, response, next) {
    const started = performance.now();
    response.once('finish', () => {
      const route = request.route && request.route.path;
      const label = `${request.method} ${request.baseUrl || ''}${route || request.path || '/'}`;
      const samples = routeDurations.get(label) || [];
      samples.push(performance.now() - started);
      routeDurations.set(label, samples);
    });
    next();
  }

  function flush() {
    const slowQueries = [...queries.entries()]
      .map(([query, samples]) => ({
        query,
        count: samples.length,
        failed: samples.filter((sample) => sample.failed).length,
        avgMs: Number((samples.reduce((sum, sample) => sum + sample.durationMs, 0) / samples.length).toFixed(2)),
        p95Ms: percentile(samples.map((sample) => sample.durationMs), 95),
        maxMs: Number(Math.max(...samples.map((sample) => sample.durationMs)).toFixed(2)),
      }))
      .sort((left, right) => right.p95Ms - left.p95Ms)
      .slice(0, 5);
    const routes = [...routeDurations.entries()].map(([route, samples]) => ({
      route,
      count: samples.length,
      p95Ms: percentile(samples, 95),
      maxMs: Number(Math.max(...samples).toFixed(2)),
    })).sort((left, right) => right.p95Ms - left.p95Ms);

    if (checkouts.length || slowQueries.length || routes.length) {
      log({
        event: 'sample',
        pool: {
          max: pool.options.max,
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
          checkoutCount: checkouts.length,
          checkoutP50Ms: percentile(checkouts.map((entry) => entry.durationMs), 50),
          checkoutP95Ms: percentile(checkouts.map((entry) => entry.durationMs), 95),
          checkoutMaxMs: checkouts.length ? Number(Math.max(...checkouts.map((entry) => entry.durationMs)).toFixed(2)) : 0,
          checkoutFailed: checkouts.filter((entry) => entry.failed).length,
          checkoutQueued: checkouts.filter((entry) => entry.waitingBefore > 0).length,
          connectionTimeoutMillis: pool.options.connectionTimeoutMillis,
          idleTimeoutMillis: pool.options.idleTimeoutMillis,
        },
        queries: slowQueries,
        routes,
      });
    }
    checkouts.length = 0;
    routeDurations.clear();
    queries.clear();
  }

  log({
    event: 'enabled',
    pool: {
      max: pool.options.max,
      connectionTimeoutMillis: pool.options.connectionTimeoutMillis,
      idleTimeoutMillis: pool.options.idleTimeoutMillis,
    },
  });
  interval = setInterval(flush, intervalMs);
  interval.unref?.();

  return {
    enabled: true,
    routeMiddleware,
    flush,
    stop() {
      if (interval) clearInterval(interval);
      flush();
      pool.connect = originalConnect;
    },
  };
}

module.exports = { createDbTiming };
