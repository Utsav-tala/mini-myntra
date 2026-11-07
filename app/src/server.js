const cluster = require('cluster');
const os = require('os');
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

// Node runs JavaScript on one thread, so on a 2-vCPU t3.micro a single
// process can only push instance CPU to about 50%: right at the scaling
// target. One worker per vCPU lets the whole instance saturate, so the
// CPU metric the Auto Scaling Group watches reflects real load. The
// workers share port 3000.
const WORKERS = Number(process.env.WORKERS) || os.availableParallelism();

if (cluster.isPrimary && WORKERS > 1) {
  let stopping = false;
  console.log(`starting ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i++) cluster.fork();

  cluster.on('exit', (worker, code) => {
    if (stopping) return;
    console.log(`worker ${worker.process.pid} exited (${code}), restarting`);
    cluster.fork();
  });

  process.on('SIGTERM', () => {
    stopping = true;
    for (const worker of Object.values(cluster.workers)) worker.process.kill('SIGTERM');
    // Exit once every worker has finished its in-flight requests.
    cluster.on('exit', () => {
      if (Object.keys(cluster.workers).length === 0) process.exit(0);
    });
  });
} else {
  main();
}
