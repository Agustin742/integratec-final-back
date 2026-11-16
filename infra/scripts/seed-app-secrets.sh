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
#     the script is safe to re-run and never overwrites a value. If the version lookup
#     itself fails (permissions, throttling, network, expired session) the script
#     aborts without writing anything.
#   - INTERNAL_SERVICE_SECRET and JWT_SECRET: 64 characters, no punctuation, no spaces.
#   - INVITATION_TOKEN_KEY: 64 characters of 0-9a-f (the API's decodeKey32 accepts
#     exactly 64 hex characters).
#   - The generated value is validated before it is stored, held only in a shell
#     variable, never printed or written to a file, and unset right after use. It is
#     handed to put-secret-value on stdin (--secret-string file:///dev/stdin), so it
#     never appears in the process arguments (/proc/<pid>/cmdline) of any user.
#   - Requires a Linux or macOS shell (or CloudShell): the Windows build of the AWS CLI
#     cannot read /dev/stdin, so the script refuses to run under Git Bash/MSYS/Cygwin
#     rather than fall back to putting the value in the arguments.
#
# Rotation (supported procedure): generate a new value and store it with
# `aws secretsmanager put-secret-value` for that secret; Secrets Manager moves
# AWSCURRENT to the new version and keeps the old one as AWSPREVIOUS. Then redeploy so
# the host start script reads the new value. Impact: rotating JWT_SECRET invalidates
# every issued access token, and rotating INVITATION_TOKEN_KEY invalidates pending
# invitations. This script never overwrites an existing value.

set -euo pipefail

region=""
arns_file=""

while [ $# -gt 0 ]; do
  case "$1" in
    --region | --arns-file)
      if [ $# -lt 2 ]; then
        echo "$1 requires a value." >&2
        exit 2
      fi
      if [ "$1" = "--region" ]; then region="$2"; else arns_file="$2"; fi
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

case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    echo "The Windows AWS CLI cannot read the value from stdin; run this script from Linux, macOS or CloudShell." >&2
    exit 3
    ;;
esac

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
  local name="$1" generator="$2" pattern="$3" arn current value
  arn="$(secret_arn "$name")"

  # The lookup is not inside a conditional, so a failure aborts the whole script
  # instead of looking like "no value yet" and overwriting a live secret.
  if ! current="$(aws secretsmanager list-secret-version-ids --region "$region" --secret-id "$arn"     --query "Versions[?contains(VersionStages, 'AWSCURRENT')].VersionId" --output text)"; then
    echo "${name}: could not read the secret's versions; aborting without changes." >&2
    return 1
  fi
  if [ -n "$current" ] && [ "$current" != "None" ]; then
    echo "${name}: already set"
    return 0
  fi

  value="$("$generator")"
  if [[ ! "$value" =~ $pattern ]]; then
    unset value
    echo "${name}: generated value failed validation; nothing stored." >&2
    return 1
  fi

  printf '%s' "$value" | aws secretsmanager put-secret-value --region "$region" --secret-id "$arn"     --secret-string file:///dev/stdin >/dev/null
  unset value
  echo "${name}: set"
}

seed INTERNAL_SERVICE_SECRET generate_secret '^[A-Za-z0-9]{64}$'
seed JWT_SECRET generate_secret '^[A-Za-z0-9]{64}$'
seed INVITATION_TOKEN_KEY generate_hex_key '^[0-9a-f]{64}$'
