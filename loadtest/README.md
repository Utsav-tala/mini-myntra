# loadtest

k6 load test shaped like a flash sale opening. Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/

## Run locally

Start the stack from the repo root (`docker compose up --build`), then:

```bash
k6 run -e PEAK_VUS=50 -e HOLD=1m -e COOL=30s loadtest/sale-opening.js
```

## Settings

All settings are passed as `-e NAME=value`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000` | Target, e.g. the load balancer URL |
| `SHAPE` | `sale` | `sale`, `step` or `steady` (see below) |
| `MIX` | `products:50,recommendations:35,checkout:15` | Share of each request type, in percent |
| `THINK_MS` | `500` | Average pause between requests per virtual user |
| `WARM_VUS`, `PEAK_VUS` | `20`, `200` | `sale`: users before and at the peak |
| `WARM`, `RAMP`, `HOLD`, `DOWN`, `COOL` | `2m`, `1m`, `10m`, `2m`, `15m` | `sale`: length of each phase |
| `STEP_VUS`, `STEP_TIME`, `STEPS` | `25`, `2m`, `8` | `step`: users added per step, step length, number of steps |
| `VUS`, `DURATION` | `50`, `5m` | `steady`: constant users and run length |

## Load shapes

- **sale:** warm-up at low load, the sale opens with a sharp ramp, the peak holds, then traffic falls back and stays quiet so the group can scale in.
- **step:** load rises in equal steps, to find where one server breaks (experiment E1).
- **steady:** constant load, for like-for-like comparisons (experiment E4).

## What it reports

Besides k6's usual latency percentiles, `requests_by_instance` counts responses per server (from the `X-Instance-Id` header), showing the load balancer spreading traffic as instances are added. A checkout answered `409 sold out` counts as a valid response.
