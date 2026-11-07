# Phase 2 baseline: one Node.js worker (8 Nov 2026)

Run before the cluster change, on one t3.micro (2 vCPU) running the API as a single Node.js process.

| Item | Value |
| --- | --- |
| Load | k6 `steady`, 150 users, 6 minutes, default request mix, from a laptop |
| Throughput | 255 requests/second, 0 failed |
| Client-side latency | avg 64 ms, p95 143 ms |
| Instance CPU | steady at about 27.5% (`cpu-per-minute.txt`, IST) |

With a single process, all the JavaScript work runs on one of the two vCPUs, so the instance's average CPU cannot rise much past 50% however overloaded that process gets. That is right at the scaling target. The app now runs one worker per vCPU. In a local test limited to 2 CPUs, recommendation throughput went from 384 to 631 requests/second (+64%).
