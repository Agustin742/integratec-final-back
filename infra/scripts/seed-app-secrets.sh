#!/usr/bin/env bash
# Loads the generated application secrets into the Secrets Manager containers that
# Terraform creates (module app_config). Terraform never holds the values: AWS
# generates each one (get-random-password) and it is stored with put-secret-value.
#
# Usage (run once after `terraform apply`, with AWS credentials for the prod account):
#
#   terraform -chdir=infra/envs/prod output -json app_secret_arns \
#     | infra/scripts/seed-app-secrets.sh --region us-east-2
#
#   infra/scripts/seed-app-secrets.sh --region us-east-2 --arns-file arns.json
#
# The JSON is the flat map env var name -> secret ARN (output app_secret_arns), read
# from stdin or from --arns-file. It contains ARNs only, never values.
#
# Behavior:
#   - A secret that already has an AWSCURRENT version is skipped ("already set"), so
#     the script is safe to re-run and never overwrites a value.
#   - INTERNAL_SERVICE_SECRET and JWT_SECRET: 64 characters, no punctuation, no spaces.
#   - INVITATION_TOKEN_KEY: 64 characters of 0-9a-f (the API's decodeKey32 accepts
#     exactly 64 hex characters).
#   - The generated value is validated before it is stored, held only in a shell
#     variable, never printed or written to a file, and unset right after use.
#     put-secret-value receives it as a CLI argument (briefly visible to processes of
#     the same user on this machine), so run it from a trusted workstation.
#
# Rotation: put a new value for the secret (aws secretsmanager put-secret-value, or
# delete its AWSCURRENT version's stage and re-run this script), then redeploy so the
# host start script reads it again.

set -euo pipefail

region=""
arns_file=""

while [ $# -gt 0 ]; do
  case "$1" in
    --region)
      region="${2:-}"
      shift 2
      ;;
    --arns-file)
      arns_file="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$region" ]; then
  echo "Missing --region (for example --region us-east-2)." >&2
  exit 2
fi

if [ -n "$arns_file" ]; then
  arns_json="$(<"$arns_file")"
else
  arns_json="$(cat)"
fi

# Returns the ARN of the given env var name from the flat JSON map (no jq needed).
secret_arn() {
  local name="$1"
  local pattern="\"${name}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\""
  if [[ "$arns_json" =~ $pattern ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  else
    echo "No ARN for ${name} in the input JSON." >&2
    return 1
  fi
}

# True when the secret already has an AWSCURRENT version.
has_current_version() {
  local arn="$1" current
  current="$(aws secretsmanager list-secret-version-ids --region "$region" --secret-id "$arn" \
    --query "Versions[?contains(VersionStages, 'AWSCURRENT')].VersionId" --output text)"
  [ -n "$current" ] && [ "$current" != "None" ]
}

generate_secret() {
  aws secretsmanager get-random-password --region "$region" \
    --password-length 64 --exclude-punctuation --no-include-space \
    --require-each-included-type --query RandomPassword --output text
}

generate_hex_key() {
  aws secretsmanager get-random-password --region "$region" \
    --password-length 64 --exclude-uppercase --exclude-punctuation \
    --exclude-characters ghijklmnopqrstuvwxyz --no-include-space \
    --no-require-each-included-type --query RandomPassword --output text
}

seed() {
  local name="$1" generator="$2" pattern="$3" arn value
  arn="$(secret_arn "$name")"

  if has_current_version "$arn"; then
    echo "${name}: already set"
    return 0
  fi

  value="$("$generator")"
  if [[ ! "$value" =~ $pattern ]]; then
    unset value
    echo "${name}: generated value failed validation; nothing stored." >&2
    return 1
  fi

  aws secretsmanager put-secret-value --region "$region" --secret-id "$arn" \
    --secret-string "$value" >/dev/null
  unset value
  echo "${name}: set"
}

seed INTERNAL_SERVICE_SECRET generate_secret '^[A-Za-z0-9]{64}$'
seed JWT_SECRET generate_secret '^[A-Za-z0-9]{64}$'
seed INVITATION_TOKEN_KEY generate_hex_key '^[0-9a-f]{64}$'
