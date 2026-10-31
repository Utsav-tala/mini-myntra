const request = require('supertest');
const { buildApp } = require('./helpers');

describe('GET /health', () => {
  test('returns ok with the instance ID', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.instanceId).toBe('i-test');
  });

  test('stays healthy when Redis is missing', async () => {
    const { app } = buildApp({ redis: null });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });

  test('every response names the instance in X-Instance-Id', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['x-instance-id']).toBe('i-test');
  });
});
