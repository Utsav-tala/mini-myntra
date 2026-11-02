#!/usr/bin/env bash
# Deploys (or updates) the whole Mini-Myntra stack in ap-south-1 and waits
# until the load balancer URL answers.
#
#   bash infra/deploy.sh
#   BUDGET_EMAIL=you@example.com bash infra/deploy.sh   (first run: also creates the budget alarm)
#   MIN_SIZE=1 MAX_SIZE=1 bash infra/deploy.sh          (experiment E1: one fixed server)
#   CACHE_ENABLED=false bash infra/deploy.sh            (experiment E4: cache off)
#
# Run infra/teardown.sh when you finish a session: the load balancer,
# Redis and instances are billed per hour even with no traffic.
set -euo pipefail

REGION="${REGION:-ap-south-1}"
IMAGE="${IMAGE:-docker.io/utsavtala/mini-myntra-api:latest}"
MIN_SIZE="${MIN_SIZE:-1}"
MAX_SIZE="${MAX_SIZE:-4}"
DESIRED="${DESIRED:-$MIN_SIZE}"
CPU_TARGET="${CPU_TARGET:-50}"
CACHE_ENABLED="${CACHE_ENABLED:-true}"
REC_ROUNDS="${REC_ROUNDS:-200}"
SLOW_STORE_DELAY_MS="${SLOW_STORE_DELAY_MS:-50}"
BUDGET_EMAIL="${BUDGET_EMAIL:-}"
BUDGET_USD="${BUDGET_USD:-20}"

export AWS_DEFAULT_REGION="$REGION"
cd "$(dirname "$0")"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v aws >/dev/null || die "AWS CLI not found (brew install awscli, then aws configure)"
command -v curl >/dev/null || die "curl not found"
aws sts get-caller-identity --query Arn --output text >/dev/null || die "AWS CLI is not logged in (run aws configure)"

deploy() {
  local stack="$1" template="$2"
  shift 2
  aws cloudformation deploy \
    --stack-name "$stack" \
    --template-file "templates/$template" \
    --no-fail-on-empty-changeset \
    "$@"
}

output() {
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

log "Finding the default VPC and two subnets in $REGION"
VPC_ID="$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
  --query 'Vpcs[0].VpcId' --output text)"
[ "$VPC_ID" != "None" ] || die "no default VPC in $REGION"
SUBNETS="$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" Name=default-for-az,Values=true \
            "Name=availability-zone,Values=${REGION}a,${REGION}b" \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
[ "$(tr ',' '\n' <<<"$SUBNETS" | grep -c .)" -eq 2 ] || die "expected 2 default subnets, got: $SUBNETS"
echo "VPC $VPC_ID, subnets $SUBNETS"

if [ -n "$BUDGET_EMAIL" ]; then
  log "Budget alarm (\$$BUDGET_USD/month, alerts to $BUDGET_EMAIL)"
  deploy mini-myntra-budget 00-budget.yml \
    --parameter-overrides "Email=$BUDGET_EMAIL" "LimitUsd=$BUDGET_USD"
fi

log "Security groups"
deploy mini-myntra-security 01-security.yml --parameter-overrides "VpcId=$VPC_ID"

log "Redis (first creation takes about 10 minutes)"
deploy mini-myntra-redis 02-redis.yml --parameter-overrides "SubnetIds=$SUBNETS"
REDIS_HOST="$(output mini-myntra-redis RedisHost)"
echo "Redis at $REDIS_HOST"

# Fill the boot script's placeholders and encode it for the launch template.
USER_DATA="$(sed \
  -e "s|@@IMAGE@@|$IMAGE|" \
  -e "s|@@REDIS_URL@@|redis://$REDIS_HOST:6379|" \
  -e "s|@@CACHE_ENABLED@@|$CACHE_ENABLED|" \
  -e "s|@@REC_ROUNDS@@|$REC_ROUNDS|" \
  -e "s|@@SLOW_STORE_DELAY_MS@@|$SLOW_STORE_DELAY_MS|" \
  user-data.sh | base64 | tr -d '\n')"

OLD_LT_VERSION="$(aws ec2 describe-launch-templates --launch-template-names mini-myntra-app \
  --query 'LaunchTemplates[0].LatestVersionNumber' --output text 2>/dev/null || echo none)"

log "Load balancer and Auto Scaling Group (min $MIN_SIZE, max $MAX_SIZE, CPU target $CPU_TARGET%)"
deploy mini-myntra-app 03-app.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "VpcId=$VPC_ID" "SubnetIds=$SUBNETS" "UserDataBase64=$USER_DATA" \
    "MinSize=$MIN_SIZE" "MaxSize=$MAX_SIZE" "DesiredCapacity=$DESIRED" "CpuTarget=$CPU_TARGET"

# New settings (image, cache flag...) only reach new instances. If the
# launch template changed, replace running instances, launching the new
# ones before stopping the old so the URL stays up.
NEW_LT_VERSION="$(aws ec2 describe-launch-templates --launch-template-names mini-myntra-app \
  --query 'LaunchTemplates[0].LatestVersionNumber' --output text)"
if [ "$OLD_LT_VERSION" != "none" ] && [ "$OLD_LT_VERSION" != "$NEW_LT_VERSION" ]; then
  log "Settings changed: replacing running instances"
  aws autoscaling start-instance-refresh --auto-scaling-group-name mini-myntra-asg \
    --preferences '{"MinHealthyPercentage":100,"MaxHealthyPercentage":200,"InstanceWarmup":90}' \
    --query InstanceRefreshId --output text
fi

log "Dashboard"
deploy mini-myntra-monitoring 04-monitoring.yml

URL="$(output mini-myntra-app LoadBalancerUrl)"
log "Waiting for $URL/health (new instances need 2 to 4 minutes)"
for _ in $(seq 1 40); do
  if curl -sf --max-time 5 "$URL/health"; then
    echo
    log "Live: $URL"
    echo "Dashboard: $(output mini-myntra-monitoring DashboardUrl)"
    echo "When you are done: bash infra/teardown.sh"
    exit 0
  fi
  sleep 10
done
die "$URL did not answer within ~7 minutes. Check EC2 > Target groups > mini-myntra-app, and /var/log/mini-myntra-boot.log on an instance (Session Manager)."
