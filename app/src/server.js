const { createApp } = require('./app');
const { getInstanceId } = require('./instance');
const { createRedis } = require('./redis');
const { createSlowStore } = require('./store');

const PORT = Number(process.env.PORT) || 3000;
const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';
const SLOW_STORE_DELAY_MS = Number(process.env.SLOW_STORE_DELAY_MS) || 50;

async function main() {
  const instanceId = await getInstanceId();
  const redis = createRedis();
  const store = createSlowStore({ delayMs: SLOW_STORE_DELAY_MS });
  const app = createApp({ instanceId, redis, store, cacheEnabled: CACHE_ENABLED });

  const server = app.listen(PORT, () => {
    console.log(
      `mini-myntra listening on :${PORT} as ${instanceId} ` +
        `(redis: ${redis ? 'on' : 'off'}, cache: ${CACHE_ENABLED ? 'on' : 'off'})`
    );
  });

  // The Auto Scaling Group sends SIGTERM on scale-in; finish in-flight
  // requests before exiting.
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server');
    server.close(() => {
      if (redis) redis.disconnect();
      process.exit(0);
    });
  });
}

main();
