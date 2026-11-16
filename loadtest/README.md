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

## Experiments (`run.sh` and `profiles/`)

`run.sh` runs one experiment's profile and saves `summary.json`, `k6.csv.gz` and `meta.txt` under `loadtest/out/` (and to the S3 results bucket when run on the AWS load generator):

```bash
bash loadtest/run.sh E2 http://<load-balancer-url>
```

| Profile | Experiment | Shape | Deploy with |
| --- | --- | --- | --- |
| `E1.env` | One server's breaking point | step: +50 users every 2 min to 500 | `MIN_SIZE=1 MAX_SIZE=1` |
| `E2.env` | Autoscaling during a sale (main) | sale, peak 500, 12 min hold | defaults (1–4) |
| `E3.env` | Four fixed servers | sale, peak 500 | `MIN_SIZE=4 MAX_SIZE=4` |
| `E4.env` | Cache on vs off | steady 50 users, product reads only | `MIN_SIZE=1 MAX_SIZE=2`, `CACHE_ENABLED=true` / `false` |
| `E5.env` | Scheduled scale-out (not run) | sale | — |
| `E6.env` | Server killed at the peak | sale, peak 500, 8 min hold | defaults; terminate one instance mid-peak |

Running the experiments on AWS step by step: [RUN-ON-AWS.md](RUN-ON-AWS.md). Results: [`../docs/results/`](../docs/README.md).
