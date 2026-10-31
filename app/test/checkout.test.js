const request = require('supertest');
const RedisMock = require('ioredis-mock');
const { buildApp } = require('./helpers');
const { initFlashStock, STOCK_KEY } = require('../src/routes/checkout');

async function appWithStock(stock) {
  const redis = new RedisMock();
  await redis.set(STOCK_KEY, stock);
  return buildApp({ redis });
}

const checkout = (app, body = { quantity: 1 }) => request(app).post('/api/checkout').send(body);

describe('flash-sale checkout', () => {
  test('a successful order returns 201 and decrements stock', async () => {
    const { app, redis } = await appWithStock(10);
    const res = await checkout(app, { quantity: 3 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ productId: 1, quantity: 3, remaining: 7 });
    expect(res.body.orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(await redis.get(STOCK_KEY))).toBe(7);
  });

  test('quantity defaults to 1', async () => {
    const { app } = await appWithStock(10);
    const res = await checkout(app, {});
    expect(res.body.quantity).toBe(1);
  });

  test('ordering more than is left returns 409 and leaves stock untouched', async () => {
    const { app, redis } = await appWithStock(2);
    const res = await checkout(app, { quantity: 3 });

    expect(res.status).toBe(409);
    expect(Number(await redis.get(STOCK_KEY))).toBe(2);
  });

  test('a burst of orders never oversells', async () => {
    const { app, redis } = await appWithStock(5);
    const results = await Promise.all(Array.from({ length: 20 }, () => checkout(app)));

    const sold = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 409).length;
    expect(sold).toBe(5);
    expect(rejected).toBe(15);
    expect(Number(await redis.get(STOCK_KEY))).toBe(0);
  });

  test.each([0, 6, 1.5, 'two'])('quantity %p returns 400', async (quantity) => {
    const { app } = await appWithStock(10);
    const res = await checkout(app, { quantity });
    expect(res.status).toBe(400);
  });

  test('without Redis checkout is unavailable', async () => {
    const { app } = buildApp({ redis: null });
    expect((await checkout(app)).status).toBe(503);
    expect((await request(app).get('/api/flash-deal')).status).toBe(503);
  });

  test('GET /api/flash-deal shows the remaining stock', async () => {
    const { app } = await appWithStock(42);
    const res = await request(app).get('/api/flash-deal');

    expect(res.status).toBe(200);
    expect(res.body.remaining).toBe(42);
    expect(res.body.product.id).toBe(1);
  });

  test('a new instance booting mid-sale does not reset stock', async () => {
    const redis = new RedisMock();
    await redis.set(STOCK_KEY, 3);
    redis.status = 'ready';

    await initFlashStock(redis, 1000);
    expect(Number(await redis.get(STOCK_KEY))).toBe(3);
  });
});
