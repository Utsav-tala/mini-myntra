const Redis = require('ioredis');

// Returns null when REDIS_URL is unset, so the API still runs (without
// cache or checkout) on a laptop with no Redis.
function createRedis(url = process.env.REDIS_URL) {
  if (!url) return null;
  const client = new Redis(url, {
    // Fail fast instead of queueing: during a spike a slow cache should
    // fall back to the store, not pile up waiting requests.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 500,
  });
  client.on('error', (err) => console.error(`redis: ${err.message}`));
  return client;
}

module.exports = { createRedis };
