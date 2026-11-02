#!/usr/bin/env bash
# Deletes everything that is billed per hour: load generator, dashboard,
# load balancer + instances, Redis. Keeps the free parts (security groups,
# budget alarm, results bucket) so the next deploy is quicker.
#
#   bash infra/teardown.sh          (end of every session)
#   bash infra/teardown.sh --all    (end of the project: also security groups)
set -euo pipefail

export AWS_DEFAULT_REGION="${REGION:-ap-south-1}"

STACKS=(mini-myntra-loadgen mini-myntra-monitoring mini-myntra-app mini-myntra-redis)
if [ "${1:-}" = "--all" ]; then
  STACKS+=(mini-myntra-security)
fi

for stack in "${STACKS[@]}"; do
  if aws cloudformation describe-stacks --stack-name "$stack" >/dev/null 2>&1; then
    printf '\n==> Deleting %s\n' "$stack"
    aws cloudformation delete-stack --stack-name "$stack"
    aws cloudformation wait stack-delete-complete --stack-name "$stack"
  else
    printf '\n==> %s: not deployed, skipping\n' "$stack"
  fi
done

printf '\nDone. Nothing billed per hour is left running.\n'
printf 'Check any time: aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE --query "StackSummaries[].StackName"\n'
