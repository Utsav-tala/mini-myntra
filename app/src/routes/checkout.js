const crypto = require('crypto');
const express = require('express');
const { byId, toPublic } = require('../catalog');

const STOCK_KEY = 'flash:stock';
const FLASH_PRODUCT_ID = 1;
const MAX_QUANTITY = 5;

// Sets the flash-deal stock once. NX keeps the count when a new instance
// boots mid-sale, so scaling out never resets stock.
function initFlashStock(redis, stock) {
  const run = () =>
    redis
      .set(STOCK_KEY, stock, 'NX')
      .catch((err) => console.error(`flash stock init failed: ${err.message}`));
  if (redis.status === 'ready') return run();
  redis.once('ready', run);
  return Promise.resolve();
}

// Stock lives in Redis, not on any one server, so every instance sells
// from the same count. DECRBY is atomic: two servers can never sell the
// last unit twice. If the count goes negative we put the units back.
function checkoutRouter({ redis }) {
  const router = express.Router();

  router.get('/flash-deal', async (req, res, next) => {
    if (!redis) return res.status(503).json({ error: 'flash sale unavailable: no redis' });
    try {
      const remaining = Number(await redis.get(STOCK_KEY)) || 0;
      return res.json({ product: toPublic(byId.get(FLASH_PRODUCT_ID)), remaining });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/checkout', async (req, res, next) => {
    if (!redis) return res.status(503).json({ error: 'flash sale unavailable: no redis' });

    const quantity = req.body?.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      return res.status(400).json({ error: `quantity must be an integer from 1 to ${MAX_QUANTITY}` });
    }

    try {
      const left = await redis.decrby(STOCK_KEY, quantity);
      if (left < 0) {
        await redis.incrby(STOCK_KEY, quantity);
        return res.status(409).json({ error: 'sold out' });
      }
      return res.status(201).json({
        orderId: crypto.randomUUID(),
        productId: FLASH_PRODUCT_ID,
        quantity,
        remaining: left,
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { checkoutRouter, initFlashStock, STOCK_KEY };
