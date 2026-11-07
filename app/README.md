# app

Node.js flash-sale API. Each endpoint stands in for one Myntra service from the Week 2 report.

| Endpoint | Stands in for | Notes |
| --- | --- | --- |
| `GET /` | Live URL landing page | HTML: status, which instance answered, links to the endpoints |
| `GET /health` | ALB health check | Returns the EC2 instance ID; never touches Redis |
| `GET /api/products/:id` | Pricing system | Redis cache-aside over a slow store (`SLOW_STORE_DELAY_MS`) |
| `GET /api/recommendations/:userId` | Personalization | CPU-heavy scoring (`REC_ROUNDS`) that drives autoscaling |
| `GET /api/flash-deal` | Flash-sale stock | Remaining units of the flash deal |
| `POST /api/checkout` | Flash-sale orders | Body `{"quantity": 1}`; atomic Redis `DECRBY`, `409` when sold out |

Every response carries an `X-Instance-Id` header naming the server that answered.

## Run locally

With Docker (API + Redis), from the repo root:

```bash
docker compose up --build
```

Without Docker (no cache, checkout returns 503):

```bash
cd app && npm install && npm start
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
| `WORKERS` | number of vCPUs | Node processes per server; `1` disables clustering. One per vCPU lets a 2-vCPU t3.micro use its whole CPU |
