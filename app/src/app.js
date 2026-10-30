const express = require('express');
const { productsRouter } = require('./routes/products');

function createApp({ instanceId, redis = null, store, cacheEnabled = true }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  // Every response says which server answered, so load tests can see
  // the load balancer spreading requests across instances.
  app.use((req, res, next) => {
    res.set('X-Instance-Id', instanceId);
    next();
  });

  // ALB health check. Kept independent of Redis so a cache outage does
  // not make the load balancer pull every instance at once.
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', instanceId, uptimeSeconds: Math.round(process.uptime()) });
  });

  app.use('/api/products', productsRouter({ redis, store, cacheEnabled }));

  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

module.exports = { createApp };
