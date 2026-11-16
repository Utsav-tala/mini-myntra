# app

Node.js (Express) flash-sale API. Each endpoint stands in for one Myntra service from the case study. The code is deliberately small; the project's focus is the cloud setup around it.

## Endpoints

| Endpoint | Stands in for | Notes |
| --- | --- | --- |
| `GET /` | Live URL landing page | HTML: status, which server answered, links to the endpoints |
| `GET /health` | Load balancer health check | Returns the EC2 instance ID; never touches Redis, so a cache problem cannot take all servers out |
| `GET /api/products/:id` | Pricing service | Redis cache-aside over a slow store (`SLOW_STORE_DELAY_MS`) |
| `GET /api/recommendations/:userId` | Personalisation | CPU-heavy scoring (`REC_ROUNDS`); this is what drives CPU up and triggers autoscaling |
| `GET /api/flash-deal` | Flash-sale stock | Remaining units of the flash deal |
| `POST /api/checkout` | Flash-sale orders | Body `{"quantity": 1}`; atomic Redis `DECRBY`, `409` when sold out, never oversells across servers |

Every response carries an `X-Instance-Id` header naming the server that answered.

## How it scales

- **Stateless:** prices cache and flash-sale stock live in Redis, so any server can answer any request and servers can be added or removed at any time.
- **One worker per vCPU:** Node.js runs JavaScript on one thread, so `src/server.js` starts one worker per vCPU with Node's `cluster` module. Without it a 2-vCPU t3.micro could only reach about 50% CPU, right at the scaling target.
- **Graceful shutdown:** on `SIGTERM` (scale-in) workers finish in-flight requests before exiting.

## Code layout

| File | What it does |
| --- | --- |
| `src/server.js` | Starts the workers, reads settings, connects Redis |
| `src/app.js` | Express app: routes, `X-Instance-Id` header, error handling |
| `src/routes/home.js` | HTML home page |
| `src/routes/products.js` | Cache-aside product reads |
| `src/routes/recommendations.js` | CPU-heavy personalised ranking |
| `src/routes/checkout.js` | Flash-deal stock and checkout |
| `src/catalog.js`, `src/store.js` | Generated catalogue (500 products) and the slow "database" |
| `src/redis.js`, `src/instance.js` | Redis client; EC2 instance ID lookup (IMDSv2) |
| `test/` | 32 Jest + Supertest tests (in-memory Redis, no Docker needed) |
| `Dockerfile` | Production image (Node 20 Alpine, runs as a non-root user, health check) |

## Run locally

With Docker (API + Redis), from the repo root:

```bash
docker compose up --build
```

Without Docker (no cache, checkout returns 503):

```bash
cd app && npm install && npm start
```

Tests:

```bash
cd app && npm ci && npm test
```

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Listen port |
| `REDIS_URL` | unset | Redis connection; unset runs without cache and checkout |
| `CACHE_ENABLED` | `true` | `false` sends every product read to the slow store (experiment E4) |
| `SLOW_STORE_DELAY_MS` | `50` | Simulated database latency |
| `REC_ROUNDS` | `200` | Scoring passes per recommendation request |
| `FLASH_STOCK` | `1000000` | Flash-deal stock set on first boot |
| `WORKERS` | number of vCPUs | Node processes per server; `1` disables clustering |
