#!/usr/bin/env bash
# Starts (or updates) the production stack on the EC2 host with infra/deploy/compose.prod.yaml.
#
# Run it on the host, with the instance role as the only credential (no keys, no .env file):
#
#   infra/deploy/start-app.sh \
#     --name-prefix aula-virtual-prod --region us-east-2 \
#     --api-image  <account>.dkr.ecr.us-east-2.amazonaws.com/aula-virtual-prod/api:<tag> \
#     --realtime-image <account>.dkr.ecr.us-east-2.amazonaws.com/aula-virtual-prod/realtime:<tag> \
#     --site-address <host_sslip_domain>
#
# Every input can also be an environment variable: NAME_PREFIX, AWS_REGION, API_IMAGE,
# REALTIME_IMAGE, SITE_ADDRESS. An argument wins over the variable. --site-address is the Terraform
# output host_sslip_domain (not a secret). The database connection info is not an input: Terraform
# publishes DB_HOST, DB_PORT, DB_NAME and DB_SECRET_ARN as SSM parameters under
# /<name-prefix>/config/api, and this script reads them there (single source of truth; none of them is
# a secret, the credentials stay in the RDS-managed master secret).
#
# Rotation: RDS rotates the managed master password about every 7 days, and DATABASE_URL is built
# once per start. After a successful start the script saves a small state file (DEPLOY_STATE_FILE,
# default /var/lib/aula-app/deployed-state) with three non-secret lines: db_secret_version (the
# version id of the master secret, never its value), api_image and realtime_image. With
# --refresh-if-rotated it exits quietly while that version is still current; otherwise it redeploys
# the images recorded in the state (the state wins over API_IMAGE/REALTIME_IMAGE, so a refresh never
# rolls back to older images; they are needed from the caller only if no state exists yet), which
# recreates the api with the new URL. systemd/app-db-refresh.{service,timer} run it every 10 minutes
# (installation: T6 docs).
#
# Concurrency: the whole run holds an exclusive flock on DEPLOY_LOCK_FILE (default: deploy.lock next
# to the state file) and waits up to DEPLOY_LOCK_WAIT seconds (default 300) for another deployment or
# refresh to finish, then fails with a message.
#
# What it does:
#   1. Reads the non-secret config of each service from SSM Parameter Store, by path
#      /<name-prefix>/config/<service> (ssm:GetParametersByPath), including DB_HOST, DB_PORT,
#      DB_NAME and DB_SECRET_ARN of the api.
#   2. Reads the generated secrets (<name-prefix>/jwt-secret, invitation-token-key,
#      internal-service-secret) and the RDS master secret from Secrets Manager.
#   3. Builds DATABASE_URL as postgresql://user:password@DB_HOST:DB_PORT/DB_NAME (user and
#      password URL-encoded, sslmode=require because RDS for
#      PostgreSQL 16 enforces TLS) and exports it for the api only: compose.prod.yaml lists it in
#      the api service alone.
#   4. Logs in to ECR (password on stdin) and runs `docker compose up -d --wait`.
#
# Handling of values: secret values live in shell variables and in the environment of the single
# `docker compose` process, nowhere else. This script never writes them to a file, never prints
# them, never passes them as command-line arguments, and never enables tracing (set -x). One
# credential does reach disk: `docker login` stores the short-lived ECR token (valid about 12 hours)
# in root's Docker config (~/.docker/config.json). Messages name the
# missing item, never a value. Any missing or empty value stops the script before the stack is
# touched. Running it again with the same inputs re-applies the same state (idempotent).

set -euo pipefail

usage_error() {
  echo "$1" >&2
  exit 2
}

# Inputs: environment first, arguments override.
name_prefix="${NAME_PREFIX:-}"
region="${AWS_REGION:-}"
api_image="${API_IMAGE:-}"
realtime_image="${REALTIME_IMAGE:-}"
site_address="${SITE_ADDRESS:-}"
state_file="${DEPLOY_STATE_FILE:-/var/lib/aula-app/deployed-state}"
lock_file="${DEPLOY_LOCK_FILE:-$(dirname "$state_file")/deploy.lock}"
lock_wait="${DEPLOY_LOCK_WAIT:-300}"
refresh_only=""

while [ $# -gt 0 ]; do
  case "$1" in
    --name-prefix | --region | --api-image | --realtime-image | --site-address)
      [ $# -ge 2 ] || usage_error "$1 requires a value."
      case "$1" in
        --name-prefix) name_prefix="$2" ;;
        --region) region="$2" ;;
        --api-image) api_image="$2" ;;
        --realtime-image) realtime_image="$2" ;;
        --site-address) site_address="$2" ;;
      esac
      shift 2
      ;;
    --refresh-if-rotated)
      refresh_only=1
      shift
      ;;
    *) usage_error "Unknown argument: $1" ;;
  esac
done

# Everything the caller may have exported under the names used below is discarded: the values
# must come from AWS, not from the caller's shell.
unset JWT_SECRET INVITATION_TOKEN_KEY INTERNAL_SERVICE_SECRET DATABASE_URL \
  ALLOWED_ORIGINS PASSWORD_RESET_URL_BASE S3_REGION S3_BUCKET REALTIME_INTERNAL_URL API_INTERNAL_URL \
  LOG_GROUP_PREFIX DB_HOST DB_PORT DB_NAME DB_SECRET_ARN DB_ENDPOINT

require() {
  [ -n "$2" ] || usage_error "Missing $1 ($3)."
}
require --name-prefix "$name_prefix" "for example aula-virtual-prod"
require --region "$region" "for example us-east-2"
require --site-address "$site_address" "output host_sslip_domain"

[[ "$name_prefix" =~ ^[a-z][a-z0-9-]{1,29}$ ]] || usage_error "--name-prefix must be lowercase letters, digits and hyphens."
[[ "$site_address" =~ ^[A-Za-z0-9.-]+$ ]] || usage_error "--site-address must be a host name."

command -v aws >/dev/null || usage_error "The aws CLI is required."
command -v docker >/dev/null || usage_error "docker is required."

compose_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose.prod.yaml"
[ -f "$compose_file" ] || usage_error "Compose file not found: $compose_file"

fail() {
  echo "$1" >&2
  exit 1
}

# Prints the VersionId of the AWSCURRENT version of a secret (an identifier, not a value).
current_version() {
  local label="$1" id="$2" version
  if ! version="$(aws secretsmanager get-secret-value --region "$region" --secret-id "$id" \
    --query VersionId --output text)" || [ -z "$version" ] || [ "$version" = "None" ]; then
    fail "${label}: could not read its current version; nothing was started."
  fi
  printf '%s' "$version"
}

# Prints the SecretString of a secret; stops when it cannot be read or is empty.
read_secret() {
  local label="$1" id="$2" value
  if ! value="$(aws secretsmanager get-secret-value --region "$region" --secret-id "$id" \
    --query SecretString --output text)"; then
    fail "${label}: could not read the secret from Secrets Manager; nothing was started."
  fi
  if [ -z "$value" ] || [ "$value" = "None" ]; then
    fail "${label}: the secret has no value (run seed-app-secrets.sh); nothing was started."
  fi
  printf '%s' "$value"
}

# Reads the parameters of one service into the named associative array (variable name -> value).
read_config() {
  local service="$1" required="$2" array_name="$3" path listing name value var
  path="/${name_prefix}/config/${service}"
  if ! listing="$(aws ssm get-parameters-by-path --region "$region" --path "$path" \
    --query 'Parameters[].[Name,Value]' --output text)"; then
    fail "${service}: could not read the SSM parameters under ${path}; nothing was started."
  fi
  local -n target="$array_name"
  while IFS=$'\t' read -r name value; do
    [ -n "$name" ] || continue
    var="${name##*/}"
    [[ "$var" =~ ^[A-Z][A-Z0-9_]*$ ]] && target["$var"]="$value"
  done <<<"$listing"
  for var in $required; do
    [ -n "${target[$var]:-}" ] || fail "${service}: SSM parameter ${var} is missing or empty under ${path}; nothing was started."
  done
}

# Percent-encodes every byte except the RFC 3986 unreserved characters.
urlencode() {
  local LC_ALL=C text="$1" i char out=""
  for ((i = 0; i < ${#text}; i++)); do
    char="${text:i:1}"
    case "$char" in
      [A-Za-z0-9._~-]) out+="$char" ;;
      *) out+="$(printf '%%%02X' "'$char")" ;;
    esac
  done
  printf '%s' "$out"
}

# Extracts a string member from the flat JSON of the RDS master secret. Values with escape
# sequences are refused instead of decoded wrongly.
json_member() {
  local json="$1" key="$2" pattern
  pattern="\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]*)\""
  [[ "$json" =~ $pattern ]] && [ -n "${BASH_REMATCH[1]}" ] && printf '%s' "${BASH_REMATCH[1]}"
}

# One deployment at a time: a timer refresh must not overlap a manual deploy.
command -v flock >/dev/null || usage_error "flock is required (util-linux)."
mkdir -p "$(dirname "$lock_file")"
exec 9>"$lock_file"
flock -w "$lock_wait" 9 || fail "Another deployment holds ${lock_file}; gave up after ${lock_wait}s."

# State of the last successful start: key=value lines, read without eval.
state_version="" state_api_image="" state_realtime_image=""
if [ -f "$state_file" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      db_secret_version) state_version="$value" ;;
      api_image) state_api_image="$value" ;;
      realtime_image) state_realtime_image="$value" ;;
    esac
  done <"$state_file"
fi

# A refresh redeploys what is running, not whatever the environment file says.
if [ -n "$refresh_only" ] && [ -n "$state_api_image" ] && [ -n "$state_realtime_image" ]; then
  api_image="$state_api_image"
  realtime_image="$state_realtime_image"
fi
require --api-image "$api_image" "ECR image URI with tag"
require --realtime-image "$realtime_image" "ECR image URI with tag"
ecr_image_pattern='^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'
[[ "$api_image" =~ $ecr_image_pattern ]] || usage_error "--api-image must be an ECR image URI with a tag."
[[ "$realtime_image" =~ $ecr_image_pattern ]] || usage_error "--realtime-image must be an ECR image URI with a tag."

declare -A api_config=() realtime_config=()
read_config api "ALLOWED_ORIGINS PASSWORD_RESET_URL_BASE S3_REGION S3_BUCKET REALTIME_INTERNAL_URL DB_HOST DB_PORT DB_NAME DB_SECRET_ARN" api_config
read_config realtime "API_INTERNAL_URL" realtime_config

db_host="${api_config[DB_HOST]}" db_port="${api_config[DB_PORT]}"
db_name="${api_config[DB_NAME]}" db_secret_arn="${api_config[DB_SECRET_ARN]}"
[[ "$db_host" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail "api: SSM parameter DB_HOST is not a host name; nothing was started."
[[ "$db_port" =~ ^[0-9]{1,5}$ ]] || fail "api: SSM parameter DB_PORT is not a port number; nothing was started."
[[ "$db_name" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || fail "api: SSM parameter DB_NAME must be lowercase letters, digits and underscores; nothing was started."
[[ "$db_secret_arn" =~ ^arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[^*]+$ ]] || fail "api: SSM parameter DB_SECRET_ARN is not a Secrets Manager secret ARN; nothing was started."

# Read before the secret itself: if the secret rotates in between, the recorded version is older
# than what was deployed, and the next refresh redeploys once more, which is harmless.
db_secret_version="$(current_version "RDS master secret" "$db_secret_arn")"
if [ -n "$refresh_only" ] && [ "$state_version" = "$db_secret_version" ]; then
  exit 0
fi

internal_service_secret="$(read_secret INTERNAL_SERVICE_SECRET "${name_prefix}/internal-service-secret")"
jwt_secret="$(read_secret JWT_SECRET "${name_prefix}/jwt-secret")"
invitation_token_key="$(read_secret INVITATION_TOKEN_KEY "${name_prefix}/invitation-token-key")"

master_json="$(read_secret "RDS master secret" "$db_secret_arn")"
db_user="$(json_member "$master_json" username)" || fail "RDS master secret: no readable username; nothing was started."
db_password="$(json_member "$master_json" password)" || fail "RDS master secret: no readable password (missing, empty or with escape sequences); nothing was started."
unset master_json
database_url="postgresql://$(urlencode "$db_user"):$(urlencode "$db_password")@${db_host}:${db_port}/${db_name}?sslmode=require"
unset db_user db_password

# ECR login: the token travels on stdin only. One login per distinct registry host.
registries="${api_image%%/*}"
[ "${realtime_image%%/*}" = "$registries" ] || registries+=$'\n'"${realtime_image%%/*}"
while IFS= read -r registry; do
  aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry" >/dev/null ||
    fail "ECR login to ${registry} failed; nothing was started."
done <<<"$registries"

# The values exist only in the environment of this subshell, which becomes the compose process.
(
  export API_IMAGE="$api_image" REALTIME_IMAGE="$realtime_image" SITE_ADDRESS="$site_address"
  export AWS_REGION="$region" LOG_GROUP_PREFIX="/${name_prefix}"
  export JWT_SECRET="$jwt_secret" INVITATION_TOKEN_KEY="$invitation_token_key"
  export INTERNAL_SERVICE_SECRET="$internal_service_secret" DATABASE_URL="$database_url"
  export ALLOWED_ORIGINS="${api_config[ALLOWED_ORIGINS]}" PASSWORD_RESET_URL_BASE="${api_config[PASSWORD_RESET_URL_BASE]}"
  export S3_REGION="${api_config[S3_REGION]}" S3_BUCKET="${api_config[S3_BUCKET]}"
  export REALTIME_INTERNAL_URL="${api_config[REALTIME_INTERNAL_URL]}" API_INTERNAL_URL="${realtime_config[API_INTERNAL_URL]}"
  exec docker compose -f "$compose_file" up -d --remove-orphans --wait --wait-timeout 180
)
# Recorded only after a successful start; it holds the version id and the images, never a secret.
{
  printf 'db_secret_version=%s\n' "$db_secret_version"
  printf 'api_image=%s\n' "$api_image"
  printf 'realtime_image=%s\n' "$realtime_image"
} > "$state_file"
echo "Stack started: caddy, api and realtime are healthy."
