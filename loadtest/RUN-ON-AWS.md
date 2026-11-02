# Running the experiments on AWS

The load test runs from a small EC2 machine (the load generator) in the same region as the app, so home internet speed does not limit it. Only the AWS account owner (Utsav) runs these steps; Rom and Chaitri can watch the dashboard on a shared screen.

## 1. Start the app with the experiment's settings

Each profile in `profiles/` says how to deploy for it. For example, E2 uses the defaults:

```bash
bash infra/deploy.sh
```

Note the `Live:` URL it prints.

## 2. Start the load generator (once per session)

The results bucket stays up between sessions; create it the first time only:

```bash
aws cloudformation deploy --region ap-south-1 --stack-name mini-myntra-results --template-file infra/templates/05-results.yml
```

Then the load generator itself:

```bash
SUBNET=$(aws ec2 describe-subnets --region ap-south-1 --filters Name=default-for-az,Values=true Name=availability-zone,Values=ap-south-1a --query 'Subnets[0].SubnetId' --output text)
```

```bash
aws cloudformation deploy --region ap-south-1 --stack-name mini-myntra-loadgen --template-file infra/templates/06-loadgen.yml --capabilities CAPABILITY_IAM --parameter-overrides SubnetId=$SUBNET
```

Wait about 2 minutes for it to install k6.

## 3. Open a terminal on the load generator

AWS console > EC2 > Instances > `mini-myntra-loadgen` > Connect > Session Manager > Connect. Then:

```bash
cd /opt/mini-myntra && git pull
```

```bash
k6 version
```

If `k6` is not found yet, wait a minute (setup log: `sudo cat /var/log/mini-myntra-loadgen.log`).

## 4. Run the experiment

```bash
bash loadtest/run.sh E2 http://<load-balancer-dns>
```

Keep the CloudWatch dashboard (`mini-myntra`) open while it runs, and take screenshots of the Auto Scaling activity (EC2 > Auto Scaling groups > `mini-myntra-asg` > Activity) and the dashboard. When k6 finishes, the results are copied to S3 automatically.

## 5. Download the results to your laptop

From the repo root on your laptop:

```bash
aws s3 cp --recursive s3://mini-myntra-results-$(aws sts get-caller-identity --query Account --output text)/ docs/results/raw/
```

## 6. End of session

```bash
bash infra/teardown.sh
```

This deletes the load generator too. The results bucket and its files stay.

## Experiments

| ID | Profile | Deploy with | During the run |
| --- | --- | --- | --- |
| E1 | `E1.env` (steps) | `MIN_SIZE=1 MAX_SIZE=1` | Note the step where latency and errors climb; set `PEAK_VUS` for E2/E3/E5/E6 to about 1.5x that |
| E2 | `E2.env` (sale) | defaults | Watch instances go 1 to 4 and back |
| E3 | `E3.env` (sale) | `MIN_SIZE=4 MAX_SIZE=4` | Compare latency and cost with E2 |
| E4 | `E4.env` (steady, products only) | `MIN_SIZE=1 MAX_SIZE=1`, run with `CACHE_ENABLED=true` then `false` | Compare p95 latency |
| E5 | `E5.env` (sale) | defaults + scheduled action (commit #19) | Compare the latency bump at the sale opening with E2 |
| E6 | `E6.env` (sale) | defaults | ~6 min in, terminate one app instance in the EC2 console |
