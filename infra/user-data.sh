#!/bin/bash
# EC2 boot script (user data) for Mini-Myntra app servers on Amazon Linux 2023.
# Runs once, as root, the first time each instance starts, including every
# instance the Auto Scaling Group adds during a spike.
#
# infra/deploy.sh replaces the @@NAME@@ placeholders before sending this
# script to AWS; do not run it by hand.
set -euo pipefail

IMAGE="@@IMAGE@@"
REDIS_URL="@@REDIS_URL@@"
CACHE_ENABLED="@@CACHE_ENABLED@@"
REC_ROUNDS="@@REC_ROUNDS@@"
SLOW_STORE_DELAY_MS="@@SLOW_STORE_DELAY_MS@@"

# Keep a copy of everything this script prints, for debugging through
# Session Manager: sudo cat /var/log/mini-myntra-boot.log
exec > >(tee -a /var/log/mini-myntra-boot.log) 2>&1
echo "boot started $(date -Is)"

dnf install -y docker
systemctl enable --now docker

# Docker Hub can be briefly unreachable while the network comes up.
for attempt in 1 2 3 4 5; do
  if docker pull "$IMAGE"; then
    break
  fi
  echo "docker pull failed (attempt $attempt), retrying in 10s"
  sleep 10
done

# --restart always brings the API back if it crashes or the instance reboots.
docker run -d --name api --restart always \
  -p 3000:3000 \
  -e REDIS_URL="$REDIS_URL" \
  -e CACHE_ENABLED="$CACHE_ENABLED" \
  -e REC_ROUNDS="$REC_ROUNDS" \
  -e SLOW_STORE_DELAY_MS="$SLOW_STORE_DELAY_MS" \
  "$IMAGE"

echo "boot finished $(date -Is)"
