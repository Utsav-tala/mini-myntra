const express = require('express');

const CACHE_TTL_SECONDS = 300;

// Cache-aside read, as in Myntra's pricing path: Redis first, the slow
// store on a miss, then fill the cache. A Redis error falls back to the
// store rather than failing the request.
function productsRouter({ redis, store, cacheEnabled }) {
  const router = express.Router();

  router.get('/:id', async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'product id must be a positive integer' });
    }

    const useCache = cacheEnabled && redis;
    const key = `product:${id}`;

    try {
      if (useCache) {
        const hit = await redis.get(key).catch(() => null);
        if (hit) return res.json({ source: 'cache', product: JSON.parse(hit) });
      }

      const product = await store.getProduct(id);
      if (!product) return res.status(404).json({ error: 'product not found' });

      if (useCache) {
        redis.set(key, JSON.stringify(product), 'EX', CACHE_TTL_SECONDS).catch(() => {});
      }
      return res.json({ source: 'store', product });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { productsRouter };
