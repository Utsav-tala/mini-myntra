# Runbook: deploy, check, update, tear down

Everything runs in ap-south-1 (Mumbai) from the AWS account owner's laptop, with the AWS CLI logged in as the IAM user `utsav-admin` (never root).

## 1. Deploy

From the repo root:

```bash
bash infra/deploy.sh
```

Add `BUDGET_EMAIL=you@example.com` in front on the very first deploy only, to create the budget alarm.

What happens, in order (first run about 15 minutes, mostly Redis):

1. Budget alarm (first run only) and security groups.
2. ElastiCache Redis, one cache.t4g.micro node (about 10 minutes on first creation; the script looks idle meanwhile).
3. Load balancer, launch template, Auto Scaling Group with 1 t3.micro, CPU target 50%.
4. CloudWatch dashboard `mini-myntra`.
5. Waits until `/health` answers, then prints `==> Live: http://...`.

## 2. Check it works

Replace `$URL` with the printed address (always `http://`).

| Check | Command | Expect |
| --- | --- | --- |
| Home page | open `$URL/` in a browser | "Mini-Myntra", status OK, instance ID |
| Health | `curl $URL/health` | `{"status":"ok","instanceId":"i-..."}` |
| Product | `curl $URL/api/products/7` | `"source":"store"`, then `"cache"` on a repeat |
| Recommendations | `curl $URL/api/recommendations/42` | 10 ranked items |
| Checkout | `curl -X POST -H "Content-Type: application/json" -d '{"quantity":1}' $URL/api/checkout` | HTTP 201 with an `orderId` (proves Redis works) |

Dashboard: CloudWatch > Dashboards > `mini-myntra`. Instance history: EC2 > Auto Scaling groups > `mini-myntra-asg` > Activity.

## 3. Update the running app

After a push to `main`, CI publishes a new `latest` image. Running instances keep the image they booted with, so replace them (new ones start before old ones stop, so the URL stays up):

```bash
aws autoscaling start-instance-refresh --auto-scaling-group-name mini-myntra-asg --preferences '{"MinHealthyPercentage":100,"MaxHealthyPercentage":200,"InstanceWarmup":90}'
```

```bash
aws autoscaling describe-instance-refreshes --auto-scaling-group-name mini-myntra-asg --query 'InstanceRefreshes[0].[Status,PercentageComplete]' --output text
```

Changing a deploy setting (for example `CACHE_ENABLED=false bash infra/deploy.sh`) does this automatically.

## 4. Tear down (end of every session)

```bash
bash infra/teardown.sh
```

Deletes everything billed per hour (load balancer, instances, Redis, dashboard, load generator). Keeps the free parts: security groups, budget alarm, results bucket. Idle cost while deployed is about $0.08 per hour; a forgotten stack costs about $60 a month.

## 5. Debugging

| Symptom | Cause and fix |
| --- | --- |
| Browser shows nothing or spins | It switched to `https://`. Type `http://` explicitly; only HTTP (port 80) is served. |
| `deploy.sh` waits at Redis for ~10 minutes | Normal on first creation. |
| `/health` never answers after deploy | EC2 > Target groups > `mini-myntra-app` > Targets shows why. Open the instance with Session Manager (EC2 > instance > Connect > Session Manager) and run `sudo cat /var/log/mini-myntra-boot.log` and `sudo docker logs api`. |
| Checkout returns 503 or 500 | Redis unreachable. Check the `mini-myntra-redis` stack is `CREATE_COMPLETE` and the Redis security group allows the app group on 6379. |
| Scale-out stops below 4 instances | Account vCPU quota (8 by default): Service Quotas > Amazon EC2 > Running On-Demand Standard instances. |

## Stacks

| Stack | Template | Deleted by teardown? |
| --- | --- | --- |
| `mini-myntra-budget` | `infra/templates/00-budget.yml` | No |
| `mini-myntra-security` | `infra/templates/01-security.yml` | Only with `--all` |
| `mini-myntra-redis` | `infra/templates/02-redis.yml` | Yes |
| `mini-myntra-app` | `infra/templates/03-app.yml` | Yes |
| `mini-myntra-monitoring` | `infra/templates/04-monitoring.yml` | Yes |
| `mini-myntra-results` | `infra/templates/05-results.yml` | No |
| `mini-myntra-loadgen` | `infra/templates/06-loadgen.yml` | Yes |
