# docs

| File / folder | What it is |
| --- | --- |
| [FINAL-REPORT.pdf](FINAL-REPORT.pdf) | Final project report: case study, cloud concepts, architecture, implementation, experiments, results, cost, lessons |
| [RUNBOOK.md](RUNBOOK.md) | How to deploy, check, update, debug and tear down |
| [results/](#results) | Processed results of every experiment |
| [screenshots/](#screenshots) | AWS console screenshots taken during the runs |

## Results

Each experiment folder holds `minutes.csv` (per-minute data), `results.json` (headline numbers), `timeline.png` (servers, CPU and p95 over time), `k6-summary.json` and `meta.txt`. Made with [`../analysis/experiment.py`](../analysis/README.md).

| Folder | Experiment | Headline |
| --- | --- | --- |
| [results/comparison/](results/comparison/README.md) | **All experiments compared, findings** | Start here |
| [results/P2-baseline-1worker/](results/P2-baseline-1worker/README.md) | One Node.js process (before the cluster fix) | CPU stuck near 27% at 255 req/s |
| [results/P2-scaling-check/](results/P2-scaling-check/README.md) | First autoscaling check (laptop k6) | 1 → 4 servers, p95 157 → 37 ms |
| [results/E1/](results/E1/) | One server, load in steps | Saturates at ~670 req/s (`steps.csv`) |
| [results/E3/](results/E3/) | Four fixed servers | p95 8 ms, 0 failures |
| [results/E2/](results/E2/) | Autoscaling 1–4 during a sale | p95 326 → 9 ms, 27 failed |
| [results/E6/](results/E6/) | Server killed at the peak | 0.51% failed, replacement in 61 s (`termination.txt`) |
| [results/E4-cache-on/](results/E4-cache-on/), [results/E4-cache-off/](results/E4-cache-off/) | Redis cache on vs off | 2 ms vs 52 ms |

`results/comparison/p95-vs-healthy-servers.csv` holds the 43 high-load minutes behind the report's "response time vs number of servers" chart.

## Screenshots

| Folder | Shows |
| --- | --- |
| [screenshots/phase2-scaling-check/](screenshots/phase2-scaling-check/) | First scale-out, dashboard, home page switching servers, scale-in |
| [screenshots/E2/](screenshots/E2/) | Scale-out activity, new servers, dashboard at the peak, home page on a new server, scale-in |
| [screenshots/E3/](screenshots/E3/) | Four app servers and the load generator, dashboard, k6 summary |
| [screenshots/E6/](screenshots/E6/) | Target health after the kill, replacement launch, dashboard dip and recovery |
| [screenshots/E4/](screenshots/E4/) | Dashboard and k6 summary with cache on and off |

File names are numbered in the order they were taken.
