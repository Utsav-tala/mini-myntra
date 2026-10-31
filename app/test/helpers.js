const RedisMock = require('ioredis-mock');
const { createApp } = require('../src/app');
const { createSlowStore } = require('../src/store');

// Builds an app wired to an in-memory Redis and a zero-delay store, so
// tests need neither Docker nor a real Redis server.
function buildApp(overrides = {}) {
  const redis = 'redis' in overrides ? overrides.redis : new RedisMock();
  const store = overrides.store || createSlowStore({ delayMs: 0 });
  const app = createApp({
    instanceId: 'i-test',
    redis,
    store,
    cacheEnabled: overrides.cacheEnabled ?? true,
    recRounds: overrides.recRounds ?? 5,
  });
  return { app, redis, store };
}

module.exports = { buildApp };
