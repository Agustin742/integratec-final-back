#!/usr/bin/env bash
# Starts (or updates) the production stack on the EC2 host with infra/deploy/compose.prod.yaml.
#
# Run it on the host, with the instance role as the only credential (no keys, no .env file):
#
#   infra/deploy/start-app.sh \
#     --name-prefix aula-virtual-prod --region us-east-2 \
#     --api-image  <account>.dkr.ecr.us-east-2.amazonaws.com/aula-virtual-prod/api:<tag> \
#     --realtime-image <account>.dkr.ecr.us-east-2.amazonaws.com/aula-virtual-prod/realtime:<tag> \
#     --site-address <host_sslip_domain> \
#     --db-endpoint <database_endpoint> --db-name <database_name> \
#     --db-secret-arn <database_master_user_secret_arn>
#
# Every input can also be an environment variable: NAME_PREFIX, AWS_REGION, API_IMAGE,
# REALTIME_IMAGE, SITE_ADDRESS, DB_ENDPOINT (host:port), DB_NAME, DB_SECRET_ARN. An argument wins
# over the variable. The values of --site-address, --db-endpoint, --db-name and --db-secret-arn are
# the Terraform outputs host_sslip_domain, database_endpoint, database_name and
# database_master_user_secret_arn; none of them is a secret. The host cannot read them itself: the
# RDS-managed master secret holds only the user name and password, and the instance role has no
# rds:Describe permission.
#
# What it does:
#   1. Reads the non-secret config of each service from SSM Parameter Store, by path
#      /<name-prefix>/config/<service> (ssm:GetParametersByPath).
#   2. Reads the generated secrets (<name-prefix>/jwt-secret, invitation-token-key,
#      internal-service-secret) and the RDS master secret from Secrets Manager.
#   3. Builds DATABASE_URL (user and password URL-encoded, sslmode=require because RDS for
#      PostgreSQL 16 enforces TLS) and exports it for the api only: compose.prod.yaml lists it in
#      the api service alone.
#   4. Logs in to ECR (password on stdin) and runs `docker compose up -d --wait`.
#
# Handling of values: they live in shell variables and in the environment of the single
# `docker compose` process, nowhere else. They are never written to a file, never printed, never
# passed as command-line arguments, and tracing (set -x) is never enabled. Messages name the
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
db_endpoint="${DB_ENDPOINT:-}"
db_name="${DB_NAME:-}"
db_secret_arn="${DB_SECRET_ARN:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --name-prefix | --region | --api-image | --realtime-image | --site-address | --db-endpoint | --db-name | --db-secret-arn)
      [ $# -ge 2 ] || usage_error "$1 requires a value."
      case "$1" in
        --name-prefix) name_prefix="$2" ;;
        --region) region="$2" ;;
        --api-image) api_image="$2" ;;
        --realtime-image) realtime_image="$2" ;;
        --site-address) site_address="$2" ;;
        --db-endpoint) db_endpoint="$2" ;;
        --db-name) db_name="$2" ;;
        --db-secret-arn) db_secret_arn="$2" ;;
      esac
      shift 2
      ;;
    *) usage_error "Unknown argument: $1" ;;
  esac
done

# Everything the caller may have exported under the names used below is discarded: the values
# must come from AWS, not from the caller's shell.
unset JWT_SECRET INVITATION_TOKEN_KEY INTERNAL_SERVICE_SECRET DATABASE_URL \
  ALLOWED_ORIGINS PASSWORD_RESET_URL_BASE S3_REGION S3_BUCKET REALTIME_INTERNAL_URL API_INTERNAL_URL \
  LOG_GROUP_PREFIX

require() {
  [ -n "$2" ] || usage_error "Missing $1 ($3)."
}
require --name-prefix "$name_prefix" "for example aula-virtual-prod"
require --region "$region" "for example us-east-2"
require --api-image "$api_image" "ECR image URI with tag"
require --realtime-image "$realtime_image" "ECR image URI with tag"
require --site-address "$site_address" "output host_sslip_domain"
require --db-endpoint "$db_endpoint" "output database_endpoint, host:port"
require --db-name "$db_name" "output database_name"
require --db-secret-arn "$db_secret_arn" "output database_master_user_secret_arn"

ecr_image_pattern='^[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$'
[[ "$api_image" =~ $ecr_image_pattern ]] || usage_error "--api-image must be an ECR image URI with a tag."
[[ "$realtime_image" =~ $ecr_image_pattern ]] || usage_error "--realtime-image must be an ECR image URI with a tag."
[[ "$name_prefix" =~ ^[a-z][a-z0-9-]{1,29}$ ]] || usage_error "--name-prefix must be lowercase letters, digits and hyphens."
[[ "$db_endpoint" =~ ^([A-Za-z0-9.-]+):([0-9]{1,5})$ ]] || usage_error "--db-endpoint must look like host:port."
[[ "$db_name" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || usage_error "--db-name must be lowercase letters, digits and underscores."
[[ "$site_address" =~ ^[A-Za-z0-9.-]+$ ]] || usage_error "--site-address must be a host name."

command -v aws >/dev/null || usage_error "The aws CLI is required."
command -v docker >/dev/null || usage_error "docker is required."

compose_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose.prod.yaml"
[ -f "$compose_file" ] || usage_error "Compose file not found: $compose_file"

fail() {
  echo "$1" >&2
  exit 1
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

declare -A api_config=() realtime_config=()
read_config api "ALLOWED_ORIGINS PASSWORD_RESET_URL_BASE S3_REGION S3_BUCKET REALTIME_INTERNAL_URL" api_config
read_config realtime "API_INTERNAL_URL" realtime_config

internal_service_secret="$(read_secret INTERNAL_SERVICE_SECRET "${name_prefix}/internal-service-secret")"
jwt_secret="$(read_secret JWT_SECRET "${name_prefix}/jwt-secret")"
invitation_token_key="$(read_secret INVITATION_TOKEN_KEY "${name_prefix}/invitation-token-key")"

master_json="$(read_secret "RDS master secret" "$db_secret_arn")"
db_user="$(json_member "$master_json" username)" || fail "RDS master secret: no readable username; nothing was started."
db_password="$(json_member "$master_json" password)" || fail "RDS master secret: no readable password (missing, empty or with escape sequences); nothing was started."
unset master_json
database_url="postgresql://$(urlencode "$db_user"):$(urlencode "$db_password")@${db_endpoint}/${db_name}?sslmode=require"
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
echo "Stack started: caddy, api and realtime are healthy."
