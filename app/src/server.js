const { createApp } = require('./app');
const { getInstanceId } = require('./instance');

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  const instanceId = await getInstanceId();
  const app = createApp({ instanceId });

  const server = app.listen(PORT, () => {
    console.log(`mini-myntra listening on :${PORT} as ${instanceId}`);
  });

  // The Auto Scaling Group sends SIGTERM on scale-in; finish in-flight
  // requests before exiting.
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server');
    server.close(() => process.exit(0));
  });
}

main();
