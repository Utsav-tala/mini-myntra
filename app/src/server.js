const { createApp } = require('./app');
const { getInstanceId } = require('./instance');
const { createRedis } = require('./redis');
const { createSlowStore } = require('./store');
const { initFlashStock } = require('./routes/checkout');

const PORT = Number(process.env.PORT) || 3000;
const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';
const SLOW_STORE_DELAY_MS = Number(process.env.SLOW_STORE_DELAY_MS) || 50;
// Scoring passes per recommendation request; raise it to make each
// request heavier on CPU.
const REC_ROUNDS = Number(process.env.REC_ROUNDS) || 200;
// Large by default so a long load test does not sell out mid-run.
const FLASH_STOCK = Number(process.env.FLASH_STOCK) || 1000000;

async function main() {
  const instanceId = await getInstanceId();
  const redis = createRedis();
  const store = createSlowStore({ delayMs: SLOW_STORE_DELAY_MS });
  if (redis) initFlashStock(redis, FLASH_STOCK);
  const app = createApp({
    instanceId,
    redis,
    store,
    cacheEnabled: CACHE_ENABLED,
    recRounds: REC_ROUNDS,
  });

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
