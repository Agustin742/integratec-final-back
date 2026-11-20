#!/usr/bin/env bash
# Runs on the EC2 host, sent by the deploy CodeBuild project through SSM Run Command (decision D19,
# buildspec infra/pipeline/buildspecs/deploy.yml). It installs the host files of the release and
# starts the stack with the images of the release, the same way the manual deploy in
# infra/README.md does.
#
# Inputs (environment variables set by the buildspec, all non-secret):
#   HOST_FILES_URI     s3://<artifact bucket>/host-files/<release tag>/host-files.tar.gz
#   HOST_FILES_SHA256  expected sha256 of that tarball, computed by the build that uploaded it
#   API_IMAGE, REALTIME_IMAGE, MIGRATE_IMAGE
#                      ECR image URIs of the release
#   AULA_ROOT          optional, default /opt/aula (tests point it elsewhere)
#   SYSTEMD_DIR        optional, default /etc/systemd/system (tests point it elsewhere)
#   DEPLOY_ENV_FILE    optional, default /etc/aula-app/deploy.env (NAME_PREFIX, AWS_REGION and
#                      SITE_ADDRESS, the non-secret inputs start-app.sh reads)
#
# The tarball holds deploy/ and caddy/, which become $AULA_ROOT/infra/deploy and
# $AULA_ROOT/infra/caddy. Steps:
#   1. Validate the inputs and read deploy.env.
#   2. Download the tarball with the instance role and verify its sha256. A mismatch aborts here,
#      before anything on the host changed.
#   3. Extract it into a staging directory next to $AULA_ROOT/infra (same file system, so the
#      swap is a rename), and check that it has the files the stack needs.
#   4. Keep the current tree as $AULA_ROOT/infra.prev (the one backup there is) and rename the
#      new tree into place. Two renames, so there is a gap of milliseconds with no infra directory;
#      a refresh timer that fires in it fails once and runs again 10 minutes later.
#      The Caddyfile of the new tree is compared with the current one first (sha256); when it
#      changed, or there is none, start-app.sh gets --recreate-caddy, because the running caddy
#      container bind-mounts the old file by inode and would keep serving it.
#   5. Run start-app.sh from the new tree. It runs the migrations first and leaves the running
#      containers alone when they fail. If it fails for any reason, the previous tree is restored
#      and this script exits with the exit code of start-app.sh. Containers that start-app.sh
#      already recreated are NOT rolled back: redeploy the previous release to go back (see
#      "Roll back" in infra/README.md).
#   6. After a successful start, install the units of the container health publisher
#      (deploy/systemd/app-container-health.{service,timer}) and enable the timer. A failure only warns.
#
# Nothing here reads or prints a secret: start-app.sh reads them with the instance role and never
# prints them, and the output of this script (shown in the build log) names files and steps only.
set -euo pipefail

fail() {
  echo "host-deploy: $1" >&2
  exit 1
}

for name in HOST_FILES_URI HOST_FILES_SHA256 API_IMAGE REALTIME_IMAGE MIGRATE_IMAGE; do
  [ -n "${!name:-}" ] || fail "${name} is required."
done

uri_pattern='^s3://[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]/host-files/[A-Za-z0-9._-]+/host-files\.tar\.gz$'
image_pattern='^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'
[[ "$HOST_FILES_URI" =~ $uri_pattern ]] || fail "HOST_FILES_URI must be the s3 URI of a host-files tarball."
[[ "$HOST_FILES_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "HOST_FILES_SHA256 must be a lowercase sha256 hex digest."
for name in API_IMAGE REALTIME_IMAGE MIGRATE_IMAGE; do
  [[ "${!name}" =~ $image_pattern ]] || fail "${name} must be an ECR image URI with a tag."
done

aula_root="${AULA_ROOT:-/opt/aula}"
env_file="${DEPLOY_ENV_FILE:-/etc/aula-app/deploy.env}"
[ -d "$aula_root" ] || fail "${aula_root} does not exist; prepare the host first (infra/README.md)."
[ -f "$env_file" ] || fail "${env_file} is missing; create it first (infra/README.md)."

# SSM may run the commands with no HOME; the AWS CLI and docker login keep their files there.
export HOME="${HOME:-/root}"

# Same file start-app.sh gets from the refresh timer: non-secret NAME_PREFIX, AWS_REGION and
# SITE_ADDRESS, exported so start-app.sh reads them.
set -a
# shellcheck disable=SC1090
. "$env_file"
set +a
[ -n "${AWS_REGION:-}" ] || fail "AWS_REGION is missing in ${env_file}."

infra="${aula_root}/infra"
previous="${aula_root}/infra.prev"
stage="$(mktemp -d "${aula_root}/.deploy.XXXXXX")"
trap 'rm -rf "$stage"' EXIT

echo "Downloading ${HOST_FILES_URI}"
aws s3 cp "$HOST_FILES_URI" "${stage}/host-files.tar.gz" --region "$AWS_REGION" --only-show-errors
(cd "$stage" && echo "${HOST_FILES_SHA256}  host-files.tar.gz" | sha256sum --check --status) ||
  fail "sha256 of the downloaded tarball does not match; nothing was changed."
echo "sha256 verified."

# Member names are validated before extraction so a bad tarball cannot write outside the tree.
# The listing goes to a file first, so a tar failure aborts here instead of being hidden in a pipeline.
cd "$stage"
tar -tzf host-files.tar.gz > members.txt || fail "could not list the tarball; nothing was changed."
[ -s members.txt ] || fail "the tarball is empty; nothing was changed."
if grep -Eq '(^/|(^|/)\.\.(/|$))' members.txt; then
  fail "the tarball has absolute or parent-relative paths; nothing was changed."
fi
mkdir -m 755 tree
tar -xzf host-files.tar.gz -C tree --no-same-owner
for required in deploy/start-app.sh deploy/compose.prod.yaml caddy/Caddyfile; do
  [ -f "${stage}/tree/${required}" ] || fail "the tarball has no ${required}; nothing was changed."
done
chmod +x "${stage}/tree/deploy/start-app.sh"
# The container health publisher is optional in the tarball (hosts of older releases have none).
[ ! -f "${stage}/tree/deploy/publish-container-health.sh" ] || chmod +x "${stage}/tree/deploy/publish-container-health.sh"
# Leave the staging directory: it is removed on exit, and start-app.sh should not run inside it.
cd /

# Caddy mounts the Caddyfile by inode, so a changed (or first) Caddyfile needs a recreated container.
start_args=()
if [ ! -f "${infra}/caddy/Caddyfile" ] ||
  [ "$(sha256sum < "${infra}/caddy/Caddyfile")" != "$(sha256sum < "${stage}/tree/caddy/Caddyfile")" ]; then
  start_args+=(--recreate-caddy)
  echo "The Caddyfile changed (or is new): caddy will be recreated."
fi

rm -rf "$previous"
had_previous=""
if [ -d "$infra" ]; then
  mv "$infra" "$previous"
  had_previous=1
fi
mv "${stage}/tree" "$infra"
echo "Installed the new host files in ${infra}."

status=0
"${infra}/deploy/start-app.sh" \
  --api-image "$API_IMAGE" --realtime-image "$REALTIME_IMAGE" --migrate-image "$MIGRATE_IMAGE" "${start_args[@]}" || status=$?
if [ "$status" -ne 0 ]; then
  echo "host-deploy: start-app.sh failed with exit code ${status}." >&2
  if [ -n "$had_previous" ]; then
    rm -rf "$infra"
    mv "$previous" "$infra"
    echo "host-deploy: restored the previous host files in ${infra}." >&2
  fi
  exit "$status"
fi

# Container health publisher (issue #62): install its systemd units from the new tree and make sure
# the timer runs. Idempotent, so every deploy refreshes the units. It runs only after a successful
# start, and a failure here is a warning: the stack is already running, and without the timer the
# container alarms treat the missing metric as unhealthy, so the problem is reported anyway.
systemd_dir="${SYSTEMD_DIR:-/etc/systemd/system}"
health_unit_dir="${infra}/deploy/systemd"
if [ -f "${health_unit_dir}/app-container-health.service" ] && [ -f "${health_unit_dir}/app-container-health.timer" ]; then
  if cp "${health_unit_dir}/app-container-health.service" "${health_unit_dir}/app-container-health.timer" "$systemd_dir/" &&
    systemctl daemon-reload && systemctl enable --now app-container-health.timer; then
    echo "Container health timer installed and enabled."
  else
    echo "host-deploy: could not enable the container health timer; the container alarms will report the missing metric." >&2
  fi
fi

echo "Release deployed; the previous host files are kept in ${previous}."
