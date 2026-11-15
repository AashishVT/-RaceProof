import http from 'k6/http';
import { check, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const apiErrors = new Rate('api_errors');
const boardLatency = new Trend('board_latency', true);
const requests = new Counter('api_requests');

const targetEnv = __ENV.TARGET_ENV;
const baseUrl = (__ENV.BASE_URL || '').replace(/\/$/, '');
const hackathonId = __ENV.HACKATHON_ID;
const seedPassword = __ENV.SEED_PASSWORD;

if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
  throw new Error('Set BASE_URL to the explicit local or staging API origin.');
}
if (!['local', 'test', 'staging', 'production'].includes(targetEnv)) {
  throw new Error('Set TARGET_ENV to local, test, staging, or production.');
}
if (targetEnv === 'production' && __ENV.ALLOW_PRODUCTION !== 'YES') {
  throw new Error('Production load testing requires ALLOW_PRODUCTION=YES.');
}
if (!hackathonId || !seedPassword) {
  throw new Error('Set HACKATHON_ID and SEED_PASSWORD for the seeded load-test account.');
}

export const options = {
  scenarios: {
    hackathon_directory: { executor: 'constant-vus', exec: 'hackathonDirectory', vus: 30, duration: '60s' },
    team_directory: { executor: 'constant-vus', exec: 'teamDirectory', vus: 30, duration: '60s' },
    dashboard_api: { executor: 'constant-vus', exec: 'dashboardApi', vus: 30, duration: '60s' },
    authentication: { executor: 'constant-vus', exec: 'authentication', vus: 10, duration: '60s' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    api_errors: ['rate<0.01'],
    board_latency: ['p(95)<200'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(90)', 'p(95)', 'p(99)'],
};

const headersFor = (token) => ({ headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
const checkResponse = (response, label, expectedStatus = 200) => {
  requests.add(1, { endpoint: label });
  const passed = check(response, { [`${label} status ${expectedStatus}`]: (r) => r.status === expectedStatus });
  apiErrors.add(!passed);
  return passed;
};

export function setup() {
  const response = http.post(`${baseUrl}/api/auth/login`, JSON.stringify({
    email: 'participant00001@seed.raceproof.invalid',
    password: seedPassword,
  }), { headers: { 'Content-Type': 'application/json' } });
  if (response.status !== 200) throw new Error('Seeded load-test login failed; verify the target and seeded database.');
  const body = response.json();
  const token = body?.data?.token || body?.data?.accessToken;
  if (!token) throw new Error('Login response did not contain an access token.');
  return { token };
}

export function hackathonDirectory(data) {
  group('hackathon directory', () => {
    const response = http.get(`${baseUrl}/api/hackathons?page=1&pageSize=20&status=active`, headersFor(data.token));
    checkResponse(response, 'hackathon_directory');
  });
}

export function teamDirectory(data) {
  group('team board', () => {
    const response = http.get(`${baseUrl}/api/hackathons/${hackathonId}/teams?page=1&pageSize=50&availableOnly=true`, headersFor(data.token));
    boardLatency.add(response.timings.duration);
    checkResponse(response, 'team_board');
  });
}

export function dashboardApi(data) {
  group('dashboard', () => {
    const myTeams = http.get(`${baseUrl}/api/teams/my`, headersFor(data.token));
    checkResponse(myTeams, 'dashboard_my_teams');
    const myRequests = http.get(`${baseUrl}/api/teams/my/requests?page=1&pageSize=20`, headersFor(data.token));
    checkResponse(myRequests, 'dashboard_my_requests');
  });
}

export function authentication() {
  const vu = String(__VU).padStart(5, '0');
  const response = http.post(`${baseUrl}/api/auth/login`, JSON.stringify({
    email: `participant${vu}@seed.raceproof.invalid`,
    password: seedPassword,
  }), { headers: { 'Content-Type': 'application/json' } });
  checkResponse(response, 'authentication');
}
