# Copy to terraform.tfvars (ignored by git) only to override the defaults.
region  = "us-east-2"
project = "aula-virtual"
# Keep false until the account allows creating an OIDC provider (see infra/README.md).
enable_github_oidc = false
