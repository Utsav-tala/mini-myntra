const request = require('supertest');
const { buildApp } = require('./helpers');

describe('GET /api/recommendations/:userId', () => {
  test('returns 10 items ranked by score by default', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/recommendations/42');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(10);
    const scores = res.body.items.map((item) => item.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  test('the same user gets the same list on any instance', async () => {
    const a = buildApp().app;
    const b = buildApp().app;

    const fromA = await request(a).get('/api/recommendations/7');
    const fromB = await request(b).get('/api/recommendations/7');
    expect(fromA.body.items).toEqual(fromB.body.items);
  });

  test('different users get different lists', async () => {
    const { app } = buildApp();
    const one = await request(app).get('/api/recommendations/1');
    const two = await request(app).get('/api/recommendations/2');
    expect(one.body.items.map((i) => i.id)).not.toEqual(two.body.items.map((i) => i.id));
  });

  test('limit is honoured and capped at 20', async () => {
    const { app } = buildApp();
    expect((await request(app).get('/api/recommendations/5?limit=3')).body.count).toBe(3);
    expect((await request(app).get('/api/recommendations/5?limit=500')).body.count).toBe(20);
  });

  test('invalid user id returns 400', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/recommendations/abc');
    expect(res.status).toBe(400);
  });
});
