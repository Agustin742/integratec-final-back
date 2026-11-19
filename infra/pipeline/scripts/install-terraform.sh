#!/usr/bin/env bash
# Installs the pinned Terraform release in a CodeBuild container (decision D19).
# The archive is accepted only if its SHA256 matches the official SHA256SUMS file
# published next to it on releases.hashicorp.com; any mismatch fails the build.
# Nothing is cached between builds and no credential is involved.
set -euo pipefail

: "${TERRAFORM_VERSION:?TERRAFORM_VERSION must be set by the buildspec}"

base_url="https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}"
archive="terraform_${TERRAFORM_VERSION}_linux_amd64.zip"
sums="terraform_${TERRAFORM_VERSION}_SHA256SUMS"

workdir="$(mktemp -d)"
trap 'rm -rf "${workdir}"' EXIT
cd "${workdir}"

curl --fail --silent --show-error --location --retry 3 --output "${archive}" "${base_url}/${archive}"
curl --fail --silent --show-error --location --retry 3 --output "${sums}" "${base_url}/${sums}"

# Keep only the line of the archive just downloaded, so a missing entry fails the check.
grep " ${archive}\$" "${sums}" > expected.sha256
sha256sum -c expected.sha256

unzip -q -o "${archive}" terraform -d /usr/local/bin
terraform version
