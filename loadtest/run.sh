#!/usr/bin/env bash
# Runs one experiment's load profile with k6 and saves the results.
#
#   bash loadtest/run.sh E2 http://<load-balancer-dns>
#   bash loadtest/run.sh E4 http://localhost:3000        (works locally too)
#
# Results go to loadtest/out/<profile>-<time>/: summary.json (percentiles),
# k6.csv.gz (every request, for time-series graphs) and meta.txt. On the
# AWS load generator they are also copied to the S3 results bucket.
set -euo pipefail

PROFILE="${1:?usage: run.sh <E1..E6> <base-url>}"
BASE_URL="${2:?usage: run.sh <E1..E6> <base-url>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PROFILE_FILE="$HERE/profiles/$PROFILE.env"
[ -f "$PROFILE_FILE" ] || { echo "no profile $PROFILE_FILE" >&2; exit 1; }

# The load generator records its results bucket here at boot.
if [ -f /etc/mini-myntra.env ]; then
  # shellcheck disable=SC1091
  . /etc/mini-myntra.env
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$HERE/out/$PROFILE-$STAMP"
mkdir -p "$OUT"

# Every NAME=value line of the profile becomes a k6 -e option.
K6_ENV=(-e "BASE_URL=$BASE_URL")
while IFS= read -r line; do
  line="${line%$'\r'}"   # tolerate Windows line endings
  case "$line" in ''|'#'*) continue ;; esac
  K6_ENV+=(-e "$line")
done < "$PROFILE_FILE"

{
  echo "profile=$PROFILE"
  echo "base_url=$BASE_URL"
  echo "started_utc=$STAMP"
  grep -v '^#' "$PROFILE_FILE" | grep .
} > "$OUT/meta.txt"

echo "Running $PROFILE against $BASE_URL; results in $OUT"
set +e
k6 run "${K6_ENV[@]}" \
  --summary-export "$OUT/summary.json" \
  --out "csv=$OUT/k6.csv.gz" \
  "$HERE/sale-opening.js"
STATUS=$?
set -e
echo "finished_utc=$(date -u +%Y%m%dT%H%M%SZ)" >> "$OUT/meta.txt"
echo "k6_exit=$STATUS" >> "$OUT/meta.txt"

if [ -n "${RESULTS_BUCKET:-}" ]; then
  aws s3 cp --recursive "$OUT" "s3://$RESULTS_BUCKET/$PROFILE-$STAMP/"
  echo "Copied to s3://$RESULTS_BUCKET/$PROFILE-$STAMP/"
fi

# k6 exits 99 when a threshold fails; the results are still worth keeping.
exit "$STATUS"
