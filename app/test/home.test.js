const request = require('supertest');
const { buildApp } = require('./helpers');

describe('GET /', () => {
  test('serves an HTML page naming the instance', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('Mini-Myntra');
    expect(res.text).toContain('i-test');
  });

  test('links to every endpoint', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/');

    for (const path of ['/health', '/api/products/7', '/api/recommendations/42', '/api/flash-deal']) {
      expect(res.text).toContain(`href="${path}"`);
    }
    expect(res.text).toContain('POST /api/checkout');
  });

  test('works without Redis', async () => {
    const { app } = buildApp({ redis: null });
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Redis<\/td><td>off/);
  });
});
