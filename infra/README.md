# infra

AWS setup for Mini-Myntra in ap-south-1 (Mumbai), as CloudFormation stacks. Each template has one owner, so nobody edits another person's file.

| Stack | Template | Creates | Billed per hour? |
| --- | --- | --- | --- |
| `mini-myntra-budget` | `templates/00-budget.yml` | Monthly cost alarm by email | No |
| `mini-myntra-security` | `templates/01-security.yml` | Security groups: internet to ALB, ALB to app, app to Redis | No |
| `mini-myntra-redis` | `templates/02-redis.yml` | ElastiCache Redis, one cache.t4g.micro node | Yes |
| `mini-myntra-app` | `templates/03-app.yml` | Load balancer, launch template, Auto Scaling Group (1 to 4 t3.micro, CPU target 50%) | Yes |
| `mini-myntra-monitoring` | `templates/04-monitoring.yml` | CloudWatch dashboard | No (within free allowance) |

`user-data.sh` is the boot script each new instance runs: it installs Docker and starts the API image from Docker Hub.

## Before the first deploy

1. AWS CLI installed and logged in as an IAM user (not root): `aws configure`, region `ap-south-1`.
2. The CI workflow has pushed `utsavtala/mini-myntra-api:latest` to Docker Hub.

## Deploy

```bash
BUDGET_EMAIL=utsavtala@gmail.com bash infra/deploy.sh
```

`BUDGET_EMAIL` is only needed the first time. The script prints the live URL when `/health` answers. The first run takes about 15 minutes, mostly Redis.

Settings for experiments (environment variables, all optional):

| Variable | Default | Used for |
| --- | --- | --- |
| `MIN_SIZE`, `MAX_SIZE`, `DESIRED` | `1`, `4`, `MIN_SIZE` | E1 (`1`,`1`), E3 (`4`,`4`) |
| `CPU_TARGET` | `50` | Scaling target |
| `CACHE_ENABLED` | `true` | E4 (`false`) |
| `REC_ROUNDS` | `200` | CPU cost of a recommendation |
| `IMAGE` | `docker.io/utsavtala/mini-myntra-api:latest` | Which image instances run |

Changing a setting on a running stack replaces the instances automatically, keeping the URL up.

## Tear down

```bash
bash infra/teardown.sh
```

Run this at the end of every session. The whole stack costs about $0.08 per hour idle (about $2 per day); forgetting it for a month costs about $60.

## Debugging an instance

EC2 console > Instances > select one > Connect > Session Manager. Then:

```bash
sudo cat /var/log/mini-myntra-boot.log
```

```bash
sudo docker logs api
```
