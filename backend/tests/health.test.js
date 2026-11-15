const request = require('supertest');
const app = require('../src/app');

test('existing API health endpoint remains available', async () => {
  const response = await request(app).get('/api/health');

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    success: true,
    message: 'RaceProof API is running',
  });
});
