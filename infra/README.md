# Infrastructure (Terraform)

AWS infrastructure for the backend, defined with Terraform in `us-east-2` (US East, Ohio). This directory holds the skeleton: a remote state bucket, the `prod` root, and the GitHub Actions OIDC role (disabled by default, see below). Application resources (network, EC2 host, RDS, ECR, ...) are added by later issues.

Rules: [Infrastructure as code](../rules/infrastructure-as-code.md), [AWS infrastructure](../rules/aws-infrastructure.md). Decisions: [D5 region](../docs/technical-justification.md#d5-aws-region), [D6 pipeline authentication](../docs/technical-justification.md#d6-pipeline-authentication-to-aws).

## Layout

| Root | Purpose | State |
|------|---------|-------|
| `bootstrap/` | Creates the S3 bucket that stores every other root's state. Run once. | Local (`terraform.tfstate`, git-ignored). |
| `envs/prod/` | Production environment: GitHub Actions OIDC provider and CI role (opt-in via `enable_github_oidc`) today, application resources later. | Remote, `s3://<state bucket>/prod/terraform.tfstate`. |

Conventions:

- **Every root module has a `versions.tf`.** CI detects roots by that file and fails if a root is missing from the `terraform` job matrix in `.github/workflows/ci.yml`.
- Reusable child modules go under `infra/modules/` and have no `versions.tf` of their own.
- The `project` prefix (`aula-virtual` by default) **MUST** be the same in every root. The CI role policy in `envs/prod` derives the state bucket name from it and the account ID.
- Tags `Project`, `Environment`, and `ManagedBy = "terraform"` are applied through provider `default_tags`.

## Requirements

- Terraform `~> 1.16` (CI uses 1.16.6) and AWS provider `~> 6.71`, pinned in each `versions.tf` and `.terraform.lock.hcl`.
- AWS CLI v2 signed in to the target account with permission to manage S3 and IAM (`aws sts get-caller-identity` must succeed). The account's Region is `us-east-2`; sign in with `aws login --region us-east-2` (short-lived credentials, no access keys) and select the profile with `AWS_PROFILE`, for example `export AWS_PROFILE=<profile>`.

## Bootstrap (once per AWS account)

This is the single bootstrap exception of the IaC rule: the state bucket cannot store its own state.

```sh
cd infra/bootstrap
terraform init
terraform plan -out=bootstrap.tfplan    # review: one bucket plus its hardening
terraform apply bootstrap.tfplan
terraform output state_bucket_name      # aula-virtual-tfstate-<account-id>
```

The bucket has versioning, AES256 encryption, all public access blocked, owner-enforced object ownership, a TLS-only bucket policy, and `prevent_destroy`. Keep the local `terraform.tfstate` from this root in a safe place outside Git; losing it only means the bucket must be imported again (`terraform import aws_s3_bucket.state <bucket>`).

## Use the prod root

```sh
cd infra/envs/prod
cp prod.s3.tfbackend.example prod.s3.tfbackend   # set bucket to the bootstrap output
terraform init -backend-config=prod.s3.tfbackend
terraform plan -out=prod.tfplan
terraform apply prod.tfplan
terraform plan                                   # must report no changes
```

- State locking uses the S3 native lockfile (`use_lockfile = true`), so no DynamoDB table is needed.
- `prod.s3.tfbackend` and `*.tfvars` are git-ignored. `example.tfvars` documents the optional overrides.

## GitHub Actions OIDC role

`envs/prod` can create the `token.actions.githubusercontent.com` OIDC provider and the role `aula-virtual-prod-github-actions` (output `github_actions_role_arn`).

**Disabled by default.** The variable `enable_github_oidc` defaults to `false`, so none of these resources are planned and `github_actions_role_arn` is `null`. The reason: the current AWS account was created with the "Sign up for AWS (new)" experience, and an AWS-managed service control policy denies `iam:CreateOpenIDConnectProvider` (the policies cannot be edited unless the account's advanced features are activated, which needs a paid plan, removes the spend limit, and is irreversible). Until then, Terraform is applied locally with short-lived `aws login` credentials and there is no pipeline deployment; long-lived access keys are never an alternative (decision D6).

To enable it later, after the restriction is lifted: set `enable_github_oidc = true` (for example in the git-ignored `terraform.tfvars`), review the plan, apply, and copy the `github_actions_role_arn` output into the workflow below.

| Control | Value |
|---------|-------|
| Who can assume it | Only workflows of `Agustin742/integratec-final-back` running on `refs/heads/main` (exact `sub` match, audience `sts.amazonaws.com`). |
| Session length | 1 hour maximum. |
| Permissions | List the state bucket, read/write `prod/terraform.tfstate`, manage its `.tflock`, and read the role and OIDC provider themselves. Later issues add only what their resources need. |

Forks, pull requests, and other branches cannot assume it. A workflow that needs AWS uses it like this:

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: <github_actions_role_arn output>
      aws-region: us-east-2
```

## CI checks

The `terraform` job in `.github/workflows/ci.yml` runs on every pull request, for each root, without AWS credentials:

1. `terraform fmt -check -recursive`
2. `terraform init -backend=false -input=false -lockfile=readonly`
3. `terraform validate`
4. `terraform test` (mocked AWS provider)

## Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| State locking | S3 native lockfile | Supported since Terraform 1.10; avoids a DynamoDB table. |
| State bucket creation | Separate `bootstrap/` root with local state | The bucket cannot hold its own state; isolating it keeps `prod` fully remote. |
| Region | `us-east-2` | Assigned to the account by AWS from the contact country and enforced by managed service control policies; it cannot be changed (D5). |
| CI role creation | Behind `enable_github_oidc`, default `false` | The managed policies deny creating the OIDC provider in this account (D6). |
| CI role trust | `main` branch only | Only reviewed, merged code can touch AWS. Pull request plans need a separate read-only role (see below). |
| Environments | `prod` only | No other environment is agreed yet (open decision in the IaC rule). |

## Not managed here

| Resource | Owner | Reason |
|----------|-------|--------|
| AWS account, sign-in, and the operator role used by `aws login` | Agustin | Account-level identity is created before Terraform and is not project infrastructure. |
| `bootstrap/` local state file | Agustin | Bootstrap exception: it cannot live in the bucket it creates. |
| GitHub repository settings (branch protection, required checks, the role ARN as a variable) | Agustin | Configured in GitHub, not in AWS. |
| Amplify Hosting | To be decided | Open decision in the IaC rule (Terraform or console connection). |

## Known gaps

- **GitHub OIDC is not available in the current account**, so CI cannot deploy and there is no CI role yet; see [GitHub Actions OIDC role](#github-actions-oidc-role).
- **`terraform plan` in CI is not implemented yet.** The IaC rule requires CI to run `plan` and the plan to be reviewed. That needs a read-only role whose trust accepts pull requests, which is deferred to the pipeline issue. Until then, changes are planned locally and the plan output is summarized in the pull request.
- Actions in the workflow are pinned by tag, not by commit SHA. SHA pinning should be applied to the whole workflow in one change.
