# analysis

Python scripts that turn raw k6 output and CloudWatch metrics into the tables and graphs in `docs/results/`. Needs Python 3 with matplotlib (and the AWS CLI for `process`).

## `experiment.py`

```bash
python3 analysis/experiment.py process <raw-dir> <out-dir> "<label>"
```

Reads one run from `loadtest/run.sh` (`meta.txt`, `summary.json`, `k6.csv.gz`), downloads CloudWatch metrics for that time window (run it **before teardown**, while the load balancer exists) and writes:

| File | Contents |
| --- | --- |
| `minutes.csv` | Per minute: users, client and server p50/p95/p99, failures, CPU, instances, healthy hosts, requests, 5xx |
| `results.json` | Headline numbers: totals, peak throughput, p95 at the start and end of the peak, servers, estimated cost |
| `steps.csv` | Step-shaped runs (E1) only: per user level, healthy or saturated, and the suggested peak |
| `timeline.png` | Servers, CPU vs the 50% target, and client/server p95 over time (E6 also marks the kill time) |

```bash
python3 analysis/experiment.py compare docs/results/E1 docs/results/E3 docs/results/E2 --out docs/results/comparison
```

Writes `comparison.md`, `comparison.csv` and `p95-by-experiment.png`, including estimated cost per hour and per million requests (on-demand ap-south-1 prices).

```bash
python3 analysis/experiment.py plot docs/results/E2
```

Redraws `timeline.png` from the saved files (no AWS needed).

## `plot_scaling_check.py`

Draws the two graphs of the Phase 2 scaling check (`docs/results/P2-scaling-check/`).

```bash
python3 analysis/plot_scaling_check.py docs/results/P2-scaling-check
```
