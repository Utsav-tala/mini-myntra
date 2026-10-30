# Mini-Myntra: flash-sale scaling on AWS

IT457 Cloud Computing, Group 9. Case study: Myntra, cloud-based personalization and flash-sale scaling.

A small Node.js flash-sale API runs on EC2 behind an Application Load Balancer. An Auto Scaling Group keeps average CPU at 50%, adding instances when a sale-like spike arrives and removing them afterwards. k6 load tests measure response time against instance count.

## Team

| Member | Owns |
| --- | --- |
| Utsav Tala (202303018) | AWS infrastructure: network, load balancer, Auto Scaling Group, CI |
| Rom Tala (202303051) | Application, Redis, boot script |
| Chaitri Vadaviya (202301243) | Tests, load tests, monitoring, analysis |

## Layout

| Folder | Contents |
| --- | --- |
| `app/` | Node.js API, Dockerfile, tests |
| `infra/` | CloudFormation templates, user-data boot script, deploy and teardown scripts |
| `loadtest/` | k6 scripts for experiments E1 to E6 |
| `analysis/` | Scripts that turn k6 and CloudWatch exports into graphs |
| `docs/` | Report, diagrams, screenshots, raw results |

## Live URL

Added after the first deployment.
