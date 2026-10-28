# Infrastructure as Code

AWS infrastructure is defined, reviewed, and changed through Terraform. This rule governs how infrastructure code is written, stored, and applied. Service roles, network isolation, and identity requirements belong to [AWS infrastructure](./aws-infrastructure.md) and are not repeated here. Nothing here claims the infrastructure code already exists.

## Decision

- **Tool:** Terraform with the official AWS provider.
- **Why:** Industry-standard tool, explicit `plan` before every change, and state the team controls.
- **Alternatives considered:** AWS CDK in TypeScript (same language as the application, but CloudFormation rollbacks can block deployments) and manual console configuration (not reproducible or reviewable).
- **Approval:** Adopted by the repository owner on 2026-10-28. Team confirmation is recorded in the pull request that introduces this rule, per [Documentation and decisions](./documentation-and-decisions.md).

## Scope and location

- Infrastructure code **MUST** live in the backend repository under `infra/`, next to the pipeline that publishes images to ECR and updates ECS.
- Terraform **MUST** manage the resources listed in [AWS infrastructure](./aws-infrastructure.md): network, security groups, load balancer, certificates, ECS cluster and services, ECR, RDS, S3, secret containers, IAM roles, log groups, alarms, and budgets.
- Resources **MUST NOT** be created or changed manually in the console when Terraform manages them. An emergency manual change **MUST** be recorded and then either imported into code or reverted.
- Resources that cannot be managed by Terraform, or are deliberately left out, **MUST** be listed with their owner and reason in `infra/README.md`.

## Versions

- The Terraform version **MUST** be pinned with `required_version`, and the AWS provider **MUST** be pinned with a version constraint.
- The dependency lock file `.terraform.lock.hcl` **MUST** be committed.
- Version upgrades **MUST** be separate changes with their own reviewed plan.

## State

- State **MUST** be stored remotely in an S3 backend with locking, encryption, versioning, and public access blocked.
- State files and `.terraform/` directories **MUST NOT** be committed. State can contain sensitive values, so access **MUST** be limited to the people and pipeline that apply changes.
- Each environment **MUST** have its own isolated state. Separate root configurations per environment, such as `infra/envs/<environment>/`, **SHOULD** be preferred over shared workspaces.
- The state bucket itself is created once, before the rest of the infrastructure. Its creation **MUST** be documented in `infra/README.md` as the single bootstrap exception.

## Structure and conventions

- Repeated infrastructure, such as the NestJS and Colyseus services, **SHOULD** use a shared local module instead of duplicated code. Modules **MUST NOT** be created for single-use resources only to add structure.
- Names **MUST** be lowercase and hyphen-separated and include the environment.
- All taggable resources **MUST** carry at least `Project`, `Environment`, and `ManagedBy = "terraform"` tags, preferably through provider `default_tags`, so cost and ownership can be traced.
- Inputs **MUST** be declared as typed variables with descriptions; outputs **MUST NOT** expose secret values.

## Secrets

- Secret values **MUST NOT** appear in `.tf` files, committed variable files, plan output shared in pull requests, or logs.
- Variable files with real values (`*.tfvars`) **MUST** be ignored by Git. An `example.tfvars` with safe placeholders **MUST** document the required inputs.
- Terraform **SHOULD** create secret containers and let AWS generate and store values, for example RDS master credentials managed in Secrets Manager, instead of passing values through variables.

## Change workflow

- Every change **MUST** go through a pull request. CI **MUST** run `terraform fmt -check`, `terraform validate`, and `terraform plan`, and the plan **MUST** be reviewed before approval.
- `terraform apply` **MUST** apply a reviewed plan for the target environment and **MUST** be performed only by the pipeline or an authorized team member.
- Changes that destroy or replace stateful resources (RDS, the state bucket, S3 buckets with data) **MUST** be called out explicitly in the pull request.
- RDS and the state bucket **MUST** use `prevent_destroy` and, where available, deletion protection.

## Verification

After an apply, `terraform plan` for the same environment **MUST** report no changes. Evidence follows [Deployment and operations](./deployment-and-operations.md) and **MUST** identify the environment and the commit applied. Unapplied or partially applied code **MUST** be reported as such.

## Open decisions

- How ownership of the ECS task definition is shared between Terraform and the image deployment pipeline, so each image release does not cause drift.
- Whether Amplify Hosting is managed by Terraform or connected through the console.
- How the pipeline authenticates to AWS (shared with [AWS infrastructure](./aws-infrastructure.md)).
- Which environments exist beyond production.
