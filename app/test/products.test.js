const request = require('supertest');
const { buildApp } = require('./helpers');
const { createSlowStore } = require('../src/store');

// Lets a test wait for the fire-and-forget cache write.
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('GET /api/products/:id', () => {
  test('first read comes from the store, the next from the cache', async () => {
    const { app } = buildApp();

    const first = await request(app).get('/api/products/7');
    expect(first.status).toBe(200);
    expect(first.body.source).toBe('store');
    expect(first.body.product).toMatchObject({ id: 7 });
    expect(first.body.product.features).toBeUndefined();

    await tick();
    const second = await request(app).get('/api/products/7');
    expect(second.body.source).toBe('cache');
    expect(second.body.product).toEqual(first.body.product);
  });

  test('price is MRP minus the discount', async () => {
    const { app } = buildApp();
    const { product } = (await request(app).get('/api/products/42')).body;
    expect(product.price).toBe(Math.round(product.mrp * (1 - product.discountPercent / 100)));
  });

  test('with the cache disabled every read goes to the store', async () => {
    const { app } = buildApp({ cacheEnabled: false });

    await request(app).get('/api/products/7');
    await tick();
    const res = await request(app).get('/api/products/7');
    expect(res.body.source).toBe('store');
  });

  test('a Redis failure falls back to the store', async () => {
    const brokenRedis = {
      get: () => Promise.reject(new Error('down')),
      set: () => Promise.reject(new Error('down')),
    };
    const { app } = buildApp({ redis: brokenRedis });

    const res = await request(app).get('/api/products/7');
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('store');
  });

  test('the store is slow and the cache is not', async () => {
    const { app } = buildApp({ store: createSlowStore({ delayMs: 40 }) });

    let start = Date.now();
    await request(app).get('/api/products/9');
    const storeMs = Date.now() - start;

    await tick();
    start = Date.now();
    await request(app).get('/api/products/9');
    const cacheMs = Date.now() - start;

    expect(storeMs).toBeGreaterThanOrEqual(40);
    expect(cacheMs).toBeLessThan(storeMs);
  });

  test('unknown product returns 404', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/products/99999');
    expect(res.status).toBe(404);
  });

  test.each(['abc', '0', '-3', '1.5'])('invalid id %s returns 400', async (id) => {
    const { app } = buildApp();
    const res = await request(app).get(`/api/products/${id}`);
    expect(res.status).toBe(400);
  });
});
