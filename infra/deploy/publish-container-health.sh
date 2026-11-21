#!/usr/bin/env bash
# Publishes the health of the api and realtime containers to CloudWatch, once per run. The systemd
# timer app-container-health.timer runs it every minute (units: systemd/app-container-health.*,
# installed by the deploy, see infra/pipeline/scripts/host-deploy.sh).
#
# For each service it reads the Docker healthcheck status (the one compose.prod.yaml defines) and
# publishes the metric Healthy: 1 when the status is `healthy`, 0 for anything else (starting,
# unhealthy, no healthcheck, container missing or stopped, Docker not answering). The alarms in
# infra/modules/monitoring/alarms_containers.tf read it; they also alarm when no data arrives.
#
# Inputs (environment, usually /etc/aula-app/deploy.env through the systemd unit):
#   AWS_REGION         required, the region of CloudWatch (the same value start-app.sh uses)
#   HEALTH_NAMESPACE   optional, default AulaVirtual/Containers. The default is repeated in
#                      infra/envs/prod/main.tf (local container_health_namespace), which feeds the
#                      IAM condition and the alarms; tests fail if the two differ.
#
# Containers are found by the labels Docker Compose puts on them, with the project name read from
# the `name:` of compose.prod.yaml next to this script (the file start-app.sh deploys), so no
# container name is hardcoded and no image or secret variable is needed to resolve them.
#
# Every Docker and AWS call has a timeout. A failed publish prints one line and exits 1; there is
# no retry here, the timer simply runs again, and the systemd unit has no Restart= so nothing loops.
# The instance role allows cloudwatch:PutMetricData for this namespace only.

set -euo pipefail

usage_error() {
  echo "$1" >&2
  exit 2
}

namespace="${HEALTH_NAMESPACE:-AulaVirtual/Containers}"
region="${AWS_REGION:-}"
[ -n "$region" ] || usage_error "Missing AWS_REGION (for example us-east-2)."

compose_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose.prod.yaml"
[ -f "$compose_file" ] || usage_error "Compose file not found: $compose_file"
project="$(sed -n 's/^name:[[:space:]]*\([A-Za-z0-9_-][A-Za-z0-9_-]*\)[[:space:]]*$/\1/p' "$compose_file" | head -n 1)"
[ -n "$project" ] || usage_error "Could not read the compose project name (name:) from $compose_file"

# Prints 1 when the running container of the service reports `healthy`, 0 otherwise.
health_value() {
  local service="$1" id status
  id="$(timeout 10 docker ps --quiet \
    --filter "label=com.docker.compose.project=${project}" \
    --filter "label=com.docker.compose.service=${service}" 2>/dev/null | head -n 1)" || id=""
  if [ -z "$id" ]; then
    printf '0'
    return
  fi
  status="$(timeout 10 docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null)" || status=""
  if [ "$status" = "healthy" ]; then
    printf '1'
  else
    printf '0'
  fi
}

metric_data=()
for service in api realtime; do
  metric_data+=("MetricName=Healthy,Dimensions=[{Name=Service,Value=${service}}],Value=$(health_value "$service"),Unit=Count")
done

# One call for both services; the metric is an instant value, so no timestamp is sent.
if ! timeout 30 aws cloudwatch put-metric-data --region "$region" --namespace "$namespace" \
  --cli-connect-timeout 5 --cli-read-timeout 15 \
  --metric-data "${metric_data[@]}"; then
  echo "Could not publish the container health to CloudWatch (namespace ${namespace}); the next timer run tries again." >&2
  exit 1
fi
