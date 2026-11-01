// k6 load test shaped like a Myntra flash sale opening.
//
//   k6 run loadtest/sale-opening.js                     (local, defaults)
//   k6 run -e BASE_URL=http://<alb-dns> -e PEAK_VUS=300 loadtest/sale-opening.js
//
// Every setting is an environment variable (-e NAME=value), so the same
// script serves all experiments; loadtest/profiles/ holds the values.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const env = (name, fallback) => (__ENV[name] !== undefined ? __ENV[name] : fallback);
const num = (name, fallback) => Number(env(name, fallback));

const BASE_URL = env('BASE_URL', 'http://localhost:3000').replace(/\/$/, '');
const SHAPE = env('SHAPE', 'sale');
const THINK_MS = num('THINK_MS', 500);

// Request mix in percent, e.g. "products:50,recommendations:35,checkout:15".
const MIX = env('MIX', 'products:50,recommendations:35,checkout:15')
  .split(',')
  .map((part) => part.split(':'))
  .map(([name, pct]) => ({ name: name.trim(), pct: Number(pct) }));
const MIX_TOTAL = MIX.reduce((sum, m) => sum + m.pct, 0);

// Load shapes:
//   sale   warm-up, sharp ramp to the peak, hold, ramp down, quiet cool-off
//   step   add STEP_VUS every STEP_TIME, STEPS times (finds the breaking point)
//   steady constant VUS for DURATION
function stages() {
  if (SHAPE === 'step') {
    const step = num('STEP_VUS', 25);
    const time = env('STEP_TIME', '2m');
    return Array.from({ length: num('STEPS', 8) }, (_, i) => [
      { duration: '10s', target: step * (i + 1) },
      { duration: time, target: step * (i + 1) },
    ]).flat();
  }
  if (SHAPE === 'steady') {
    return [
      { duration: '30s', target: num('VUS', 50) },
      { duration: env('DURATION', '5m'), target: num('VUS', 50) },
    ];
  }
  const warmVus = num('WARM_VUS', 20);
  const peakVus = num('PEAK_VUS', 200);
  return [
    { duration: '30s', target: warmVus },
    { duration: env('WARM', '2m'), target: warmVus },
    { duration: env('RAMP', '1m'), target: peakVus },
    { duration: env('HOLD', '10m'), target: peakVus },
    { duration: env('DOWN', '2m'), target: warmVus },
    { duration: env('COOL', '15m'), target: warmVus },
  ];
}

export const options = {
  scenarios: {
    sale: { executor: 'ramping-vus', startVUs: 0, stages: stages(), gracefulRampDown: '10s' },
  },
  thresholds: {
    // Not pass/fail gates for the experiments; they flag a broken run.
    http_req_failed: ['rate<0.05'],
    'http_req_duration{endpoint:products}': ['p(95)<1000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// Which server answered: shows the load balancer spreading requests
// across instances as the Auto Scaling Group adds them.
const byInstance = new Counter('requests_by_instance');

function pickEndpoint() {
  let roll = Math.random() * MIX_TOTAL;
  for (const m of MIX) {
    roll -= m.pct;
    if (roll < 0) return m.name;
  }
  return MIX[MIX.length - 1].name;
}

const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function request(endpoint) {
  const tags = { endpoint };
  if (endpoint === 'products') {
    return http.get(`${BASE_URL}/api/products/${randInt(1, 500)}`, { tags });
  }
  if (endpoint === 'recommendations') {
    return http.get(`${BASE_URL}/api/recommendations/${randInt(1, 100000)}`, { tags });
  }
  if (endpoint === 'checkout') {
    return http.post(`${BASE_URL}/api/checkout`, JSON.stringify({ quantity: 1 }), {
      tags,
      headers: { 'Content-Type': 'application/json' },
      // 409 (sold out) is a valid flash-sale answer, not an error.
      responseCallback: http.expectedStatuses(201, 409),
    });
  }
  throw new Error(`unknown endpoint in MIX: ${endpoint}`);
}

export default function () {
  const endpoint = pickEndpoint();
  const res = request(endpoint);

  check(res, { 'status ok': (r) => (r.status >= 200 && r.status < 300) || r.status === 409 });
  byInstance.add(1, { instance: res.headers['X-Instance-Id'] || 'none' });

  // Think time between clicks, jittered so VUs do not move in lockstep.
  sleep((THINK_MS * (0.5 + Math.random())) / 1000);
}
