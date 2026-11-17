# Infrastructure (Terraform)

AWS infrastructure for the backend, defined with Terraform in `us-east-2` (US East, Ohio). This directory holds a remote state bucket, the `prod` root with the network and the EC2 host and the database (see [Network and EC2 host](#network-and-ec2-host) and [Database (RDS PostgreSQL)](#database-rds-postgresql)), and the GitHub Actions OIDC role (disabled by default, see below). **Nothing in `infra/` has been applied to AWS yet.** ECR and the container deployment are added by a later issue.

Rules: [Infrastructure as code](../rules/infrastructure-as-code.md), [AWS infrastructure](../rules/aws-infrastructure.md). Decisions: [D5 region](../docs/technical-justification.md#d5-aws-region), [D6 pipeline authentication](../docs/technical-justification.md#d6-pipeline-authentication-to-aws).

## Layout

| Root | Purpose | State |
|------|---------|-------|
| `bootstrap/` | Creates the S3 bucket that stores every other root's state. Run once. | Local (`terraform.tfstate`, git-ignored). |
| `envs/prod/` | Production environment: network, EC2 host and RDS database, plus the GitHub Actions OIDC provider and CI role (opt-in via `enable_github_oidc`). | Remote, `s3://<state bucket>/prod/terraform.tfstate`. |

Conventions:

- **Every root module has a `versions.tf`.** CI detects roots by that file and fails if a root is missing from the `terraform` job matrix in `.github/workflows/ci.yml`.
- Reusable child modules go under `infra/modules/` (`network`, `host`, `database`) and have no `versions.tf` of their own.
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

## Network and EC2 host

Issue #59 adds the production network and the single host that will run the application. Everything is declared in `envs/prod` through the modules `modules/network` and `modules/host`, and covered by `terraform test` with a mocked AWS provider. **None of it has been applied to AWS**; the steps below describe what `terraform apply` would create.

### Resources

| Area | Resource | Notes |
|------|----------|-------|
| Network | VPC `10.0.0.0/16` | Variable `vpc_cidr`; it must be an IPv4 `/16`. |
| Network | One public subnet | Holds the EC2 host; routes `0.0.0.0/0` to the internet gateway. |
| Network | Private subnets in 2 AZs (`us-east-2a`, `us-east-2b`) | For the RDS subnet group (#60). Their route table has no routes, so they have no internet path. Variable `availability_zones`. |
| Network | Internet gateway | Only for the public subnet. There is **no NAT gateway** and no load balancer. |
| Security | Host security group | Inbound only TCP 443 and 80 from the internet. **No SSH (port 22) and no key pair.** Outbound is open so the host can reach package repositories, Let's Encrypt and, later, ECR. |
| Compute | EC2 `t3.small`, Amazon Linux 2023 (x86_64) | The AMI comes from the public SSM parameter for AL2023; newer AMI releases do not replace the instance (`ignore_changes`). Variable `host_instance_type`. |
| Compute | Root volume: encrypted gp3, 20 GiB | Variable `host_root_volume_size_gb`. |
| Compute | IMDSv2 required | The instance metadata service only answers token-based requests. |
| Compute | Elastic IP | A fixed public address; it is the only public address of the host. |
| Access | IAM role and instance profile with `AmazonSSMManagedInstanceCore` | Lets Session Manager and Run Command reach the host. The application permissions (ECR, secrets) are added by #61. |
| Provisioning | User data script (cloud-init, runs once at first boot) | Installs Docker and the pinned Docker Compose plugin (checksum verified) and starts the SSM agent. It writes `/var/lib/host-bootstrap/done` on success or `/var/lib/host-bootstrap/failed` (with the failing line) on error. Its log is `/var/log/host-bootstrap.log`. |

Changing the user data or the AMI later does not touch the running instance. To apply such a change, replace the host on purpose: `terraform apply -replace=module.host.aws_instance.host`.

### Domain and Caddy routing

Let's Encrypt needs a DNS name that points to the Elastic IP. Until a real domain is chosen, the interim name is the Elastic IP under [sslip.io](https://sslip.io), a free wildcard DNS service: the IP `203.0.113.10` becomes `203-0-113-10.sslip.io`. Terraform exposes it as the output `host_sslip_domain`. Caddy reads the name from the `SITE_ADDRESS` variable, so switching to a real domain later does not change the Caddyfile.

`infra/caddy/Caddyfile` is the reverse proxy configuration. Caddy is the only public entry:

| Request | Result |
|---------|--------|
| `http://<site>/...` | Redirected to HTTPS. |
| `https://<site>/api/...` | Proxied to the API container (`api:3000`), with the `/api` prefix removed. |
| `https://<site>/realtime/...` | Proxied to the Colyseus container (`realtime:2567`). WebSocket upgrades (WSS) are supported and kept open for long sessions. |
| `/api/internal*` and `/realtime/internal*` | `404`. The internal API and realtime channel stays on the private Docker network and is never routed. |
| Anything else | `404`. |

`scripts/ci/test_caddy.py` checks the file (and, when Docker is available, validates it and tests the routing against stub upstreams). **Caddy and the containers are not started by this issue**: running them belongs to the Docker Compose deployment in #61. Until then, nothing listens on ports 443 and 80 of the host.

### Plan and apply, step by step

Nothing here has been run for this issue; the first apply needs the maintainer's approval.

1. Make sure the state bucket exists (see [Bootstrap](#bootstrap-once-per-aws-account)) and sign in with `aws login --region us-east-2`. `aws sts get-caller-identity` must succeed.
2. Go to the prod root and initialize it against the remote state:

   ```sh
   cd infra/envs/prod
   cp prod.s3.tfbackend.example prod.s3.tfbackend   # set bucket to the bootstrap output
   terraform init -backend-config=prod.s3.tfbackend
   ```

3. Preview the changes and save the plan. `plan` changes nothing in AWS. Read it and check that it only creates resources (no destroy) and that no security group allows anything beyond 443 and 80:

   ```sh
   terraform plan -out=prod.tfplan
   ```

4. Apply exactly that plan. This creates the resources and starts billing for the instance, the volume and the Elastic IP:

   ```sh
   terraform apply prod.tfplan
   ```

5. Run `terraform plan` again. It must report no changes.
6. Read the outputs you need later:

   ```sh
   terraform output host_public_ip
   terraform output host_sslip_domain
   terraform output host_instance_id
   terraform output host_security_group_id
   terraform output private_subnet_ids
   ```

To remove everything, `terraform destroy` shows what it will delete and asks for confirmation. The Elastic IP is released with it, so the sslip.io name changes if the host is created again.

### Reach the host with Session Manager

There is no SSH. Administration goes through AWS Systems Manager, which uses the instance profile and an outbound connection from the host; no inbound port is needed.

On your computer you need AWS CLI v2 signed in to the account and the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html). The host appears as a managed node a few minutes after first boot.

Open a shell on the host (run it from `infra/envs/prod`; `-raw` prints the value without quotes):

```sh
aws ssm start-session --region us-east-2 --target "$(terraform output -raw host_instance_id)"
```

Type `exit` to close it. You land as `ssm-user`; use `sudo` when you need root.

### Check that the first boot worked

The first boot installs Docker and Compose. To check it without opening a shell, run the output `host_bootstrap_check_command`, which sends a command through SSM Run Command that prints the `done` marker:

```sh
eval "$(terraform output -raw host_bootstrap_check_command)"
```

The result includes a `CommandId`. Commands run asynchronously, so fetch the outcome with it a few seconds later:

```sh
aws ssm get-command-invocation --region us-east-2 \
  --command-id "<CommandId from the previous output>" \
  --instance-id "$(terraform output -raw host_instance_id)"
```

Read `Status` and `StandardOutputContent`:

- `Status` is `Success` and the output shows a timestamp and the Compose version: the host is ready.
- `Status` is `Failed` because the `done` marker does not exist: the bootstrap failed or is still running. Read the `failed` marker the same way, with `commands=["cat /var/lib/host-bootstrap/failed"]`, or the full log (`/var/log/host-bootstrap.log`) from a Session Manager shell.
- The command is rejected because the instance is not found: the SSM agent has not registered yet; wait a few minutes.

### Estimated monthly cost (unverified)

**These figures are not verified.** They are approximate on-demand Linux list prices for `us-east-2` written from memory, without a live pricing lookup, and they have not been compared with the AWS Free plan credits of this account. Check the [AWS Pricing Calculator](https://calculator.aws/) and the account's Billing page before applying.

| Item | Assumption | Approximate monthly cost |
|------|-----------|--------------------------|
| EC2 `t3.small` | about USD 0.0208 per hour, 730 hours | about USD 15.2 |
| EBS gp3, 20 GiB | about USD 0.08 per GiB-month | about USD 1.6 |
| Public IPv4 (Elastic IP) | about USD 0.005 per hour, charged even when attached | about USD 3.7 |
| RDS `db.t4g.micro`, PostgreSQL, single-AZ (#60) | about USD 0.016 per hour, 730 hours | about USD 12 |
| RDS gp3 storage, 20 GiB (#60) | about USD 0.115 per GiB-month | about USD 2.3 |
| RDS backup storage (#60) | free up to the size of the database; 7 days of retention are expected to stay within it | about USD 0 |
| Secrets Manager secret for the master password (#60) | about USD 0.40 per secret per month | about USD 0.4 |
| Total | | about USD 35 |

Not included: data transfer out, ECR and any other later resource. Whether the Free plan credits cover this for the intended duration is not known.

## Database (RDS PostgreSQL)

Issue #60 adds the production database. It is declared in `envs/prod` through `modules/database` and covered by `terraform test` with a mocked AWS provider. **None of it has been applied to AWS**; the steps below describe what `terraform apply` would create. The first apply is planned together with #61.

### Resources

| Area | Resource | Notes |
|------|----------|-------|
| Database | RDS instance `aula-virtual-prod-db` | PostgreSQL 16 (major version only; AWS applies minor upgrades automatically), `db.t4g.micro`, single Availability Zone, **not publicly accessible**. |
| Database | Storage: gp3, 20 GiB, encrypted | No storage autoscaling. Variables `instance_class` and `allocated_storage` in the module. |
| Database | Initial database `aula_virtual`, master user `aula_admin` | Defaults of the module variables `db_name` and `master_username`. |
| Security | Database security group | Inbound only TCP 5432 and only from the host security group (no CIDR ranges). No outbound rules. |
| Network | DB subnet group | The two private subnets, which must be in two distinct Availability Zones (RDS requirement). |

### Credentials

RDS generates the master password and stores it in AWS Secrets Manager (`manage_master_user_password`). Terraform never sees the password, so it is not in the state file, in the plan output or in any variable. The only credential-related output is the secret's ARN:

```sh
terraform output database_master_user_secret_arn
```

For the MVP the API connects with the master user. A separate user with limited permissions (for the API, and another for migrations) is a follow-up; Terraform cannot create it because it cannot reach the private database.

### How the deployment will use it (#61)

This is the pattern #61 will implement; it is not done here. When the application is deployed or started, the host:

1. Reads the secret by its ARN. The secret value is JSON with `username` and `password`:

   ```sh
   aws secretsmanager get-secret-value --region us-east-2 \
     --secret-id "$(terraform output -raw database_master_user_secret_arn)"
   ```

2. Builds `DATABASE_URL` from that secret and the outputs `database_endpoint` (host and port together), `database_port` and `database_name`. The password must be URL-encoded.
3. Passes `DATABASE_URL` only to the environment of the `api` container.

The URL and the password are never written to images, Git, logs or the `realtime` container, which has no database access. The host's IAM permission to read that one secret is added by #61; today the host role only has the SSM permission.

### Backups and restore

| Setting | Value |
|---------|-------|
| Automated backups | 7 days of retention, which also enables point-in-time restore. |
| Backup window | 06:00-07:00 UTC (03:00-04:00 in Argentina). |
| Maintenance window | Sunday 08:00-09:00 UTC. |
| Snapshots | Tags are copied to snapshots. |

A point-in-time restore never changes the running instance: it creates a **new** instance with the data as it was at the chosen moment. Replace the placeholders:

```sh
aws rds restore-db-instance-to-point-in-time --region us-east-2 \
  --source-db-instance-identifier aula-virtual-prod-db \
  --target-db-instance-identifier <new-id> \
  --restore-time <UTC time, for example 2026-01-31T14:30:00Z>
```

Use `--use-latest-restorable-time` instead of `--restore-time` to restore to the latest possible moment. Then check that the new instance is `available`, and point the API to its endpoint. Bringing the restored instance under Terraform (import) or switching the application permanently to it is a deliberate follow-up that has to be planned when it is needed. **This restore path has not been tested.**

### Deletion protection

The instance has `deletion_protection` enabled and `prevent_destroy` in Terraform, so `terraform destroy` and any change that would replace the instance fail. A plan that would destroy or replace the database must be called out in the pull request.

To delete it on purpose:

1. Open a reviewed change that removes `prevent_destroy` from `modules/database/instance.tf`.
2. Disable deletion protection and apply.
3. Run `terraform destroy`.

When it is destroyed, RDS keeps a final snapshot named `aula-virtual-prod-db-final`. If the database is created again and destroyed a second time, the destroy fails because that snapshot name already exists. Delete the old snapshot first, only after confirming it is no longer needed:

```sh
aws rds delete-db-snapshot --region us-east-2 --db-snapshot-identifier aula-virtual-prod-db-final
```

### Connect manually

The database is private, so it cannot be reached from your computer. Port forwarding through the host with Session Manager is a possible future option, tied to the team access work in back #100; it is not set up here.

### Plan and apply

Follow [Plan and apply, step by step](#plan-and-apply-step-by-step). The plan adds the instance, the security group and the subnet group, and it must show no destroy. The apply starts billing for the database. Then read the outputs:

```sh
terraform output database_endpoint
terraform output database_port
terraform output database_name
terraform output database_master_user_secret_arn
terraform output database_security_group_id
terraform output database_subnet_group_name
```

### Cost

The database rows are part of the [estimated monthly cost](#estimated-monthly-cost-unverified) table above. They are unverified, and whether the Free plan covers `db.t4g.micro` is not checked.

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
