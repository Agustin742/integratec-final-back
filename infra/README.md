# Infrastructure (Terraform)

AWS infrastructure for the backend, defined with Terraform in `us-east-2` (US East, Ohio). This directory holds a remote state bucket, the `prod` root with the network and the EC2 host and the database (see [Network and EC2 host](#network-and-ec2-host) and [Database (RDS PostgreSQL)](#database-rds-postgresql)), the container deployment resources (see [Container deployment](#container-deployment-ecr-secrets-config-compose)), the keyless deploy pipeline (see [Deploy pipeline](#deploy-pipeline-codepipeline-and-codebuild)), and the GitHub Actions OIDC role (disabled by default, see below). **`bootstrap` and `envs/prod` are applied** (first deploy on 2026-11-17: images `release-2026-11-17-1`, site `https://16-59-248-180.sslip.io`, `allowed_origins` and `password_reset_url_base` still on the `example.tfvars` placeholders until the frontend has a real URL). The deploy pipeline of #58 (CodePipeline V2 with CodeBuild, no long-lived keys) is declared in `envs/prod` but **not applied yet**: it needs one local `terraform apply` from the merged `develop` and a one-time console step, see [One-time setup](#one-time-setup-after-the-first-apply). Until then, deploys follow the [manual fallback](#manual-deploy-with-session-manager-fallback).

Rules: [Infrastructure as code](../rules/infrastructure-as-code.md), [AWS infrastructure](../rules/aws-infrastructure.md). Decisions: [D5 region](../docs/technical-justification.md#d5-aws-region), [D6 pipeline authentication](../docs/technical-justification.md#d6-pipeline-authentication-to-aws), [D19 keyless deploy pipeline](../docs/technical-justification.md#d19-keyless-deploy-pipeline-inside-aws).

## Layout

| Root | Purpose | State |
|------|---------|-------|
| `bootstrap/` | Creates the S3 bucket that stores every other root's state. Run once. | Local (`terraform.tfstate`, git-ignored). |
| `envs/prod/` | Production environment: network, EC2 host, RDS database, container deployment resources, the deploy pipeline and the frontend Amplify app, plus the GitHub Actions OIDC provider and CI role (opt-in via `enable_github_oidc`). | Remote, `s3://<state bucket>/prod/terraform.tfstate`. |

Conventions:

- **Every root module has a `versions.tf`.** CI detects roots by that file and fails if a root is missing from the `terraform` job matrix in `.github/workflows/ci.yml`.
- Reusable child modules go under `infra/modules/` (`network`, `host`, `database`, `registry`, `app_config`, `storage`, `runtime_access`, `delivery_pipeline`) and have no `versions.tf` of their own.
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
| Access | IAM role and instance profile with `AmazonSSMManagedInstanceCore` | Lets Session Manager and Run Command reach the host. The application permissions (ECR, secrets, config, files, logs) are added by #61, see [Host role permissions](#host-role-permissions). |
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

`scripts/ci/test_caddy.py` checks the file (and, when Docker is available, validates it and tests the routing against stub upstreams). Caddy and the containers are started by the Docker Compose deployment of #61, see [Container deployment](#container-deployment-ecr-secrets-config-compose). Until that is done on the host, nothing listens on ports 443 and 80.

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
| RDS backup storage (#60) | free up to the size of the database; 1 day of retention (the prod default) is expected to stay within it | about USD 0 |
| Secrets Manager secret for the master password (#60) | about USD 0.40 per secret per month | about USD 0.4 |
| Total | | about USD 35 |

Not included: data transfer out and the resources of [Container deployment](#container-deployment-ecr-secrets-config-compose), which have their own [cost table](#estimated-monthly-cost-of-the-deployment-resources-unverified). Whether the Free plan credits cover this for the intended duration is not known.

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

### How the deployment uses it (#61)

This is what `infra/deploy/start-app.sh` does (see [Container deployment](#container-deployment-ecr-secrets-config-compose)). When the application is deployed or started, the host:

1. Reads the secret by its ARN. The secret value is JSON with `username` and `password`:

   ```sh
   aws secretsmanager get-secret-value --region us-east-2 \
     --secret-id "$(terraform output -raw database_master_user_secret_arn)"
   ```

2. Builds `DATABASE_URL` from that secret and the connection settings `DB_HOST`, `DB_PORT` and `DB_NAME`, which Terraform publishes as SSM parameters of the api. The password is URL-encoded.
3. Passes `DATABASE_URL` only to the environment of the `api` container.

The URL and the password are never written to images, Git, logs or the `realtime` container, which has no database access. The host's IAM permission to read that one secret is part of the [host role permissions](#host-role-permissions).

### Backups and restore

| Setting | Value |
|---------|-------|
| Automated backups | 1 day of retention in prod (`database_backup_retention_period`), which also enables point-in-time restore. The AWS Free plan account rejects longer retention with `FreeTierRestrictionError`; after upgrading the account plan, raise the variable (the module accepts 1 to 35 days). |
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

## Container deployment (ECR, secrets, config, Compose)

Issue #61 adds everything the host needs to run `api` and `realtime` behind Caddy: image repositories, secret containers, non-secret config, a files bucket, the host permissions, log groups, a production Compose file and a start script. Terraform creates only the AWS resources. The Compose file, the Caddyfile and the start script live in the repository and reach the host through the [deploy pipeline](#deploy-pipeline-codepipeline-and-codebuild) or, as a fallback, by hand through Session Manager. **The resources of this section are applied; the pipeline of #58 is not yet.** It is covered by `terraform test` with a mocked AWS provider and by the unit tests in `scripts/ci`.

### Resources

| Area | Resource | Notes |
|------|----------|-------|
| Images | ECR repositories `aula-virtual-prod-api`, `aula-virtual-prod-realtime` and `aula-virtual-prod-migrate` (module `registry`) | Tags are **immutable** (a tag cannot be pushed twice), scan on push, AES256 encryption. Outputs `ecr_repository_urls` and `ecr_repository_arns`. |
| Images | ECR lifecycle policy | Untagged images expire after 7 days. Images tagged `release-*` keep the newest 20. Every other image expires 30 days after push. A release image is protected from the 30-day rule, so the pipeline tags every deployable image `release-<yyyymmdd>-<short sha>`; a manual push must use a `release-*` tag too, or the image will be deleted. |
| Secrets | Three Secrets Manager secrets (module `app_config`): `<prefix>/jwt-secret`, `<prefix>/invitation-token-key`, `<prefix>/internal-service-secret` | Terraform creates **empty containers only**. The values are generated by AWS and loaded once by `infra/scripts/seed-app-secrets.sh`, so they never appear in Terraform code, plan, outputs or state. Recovery window 7 days. Output `app_secret_arns` (ARNs only). |
| Config | SSM Parameter Store `String` parameters under `/<prefix>/config/api/` and `/<prefix>/config/realtime/` | Non-secret values only. For the api: `ALLOWED_ORIGINS`, `PASSWORD_RESET_URL_BASE`, `NODE_ENV`, `S3_BUCKET`, `S3_REGION`, `REALTIME_INTERNAL_URL` and the database connection `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SECRET_ARN`. For realtime: `API_INTERNAL_URL` and `NODE_ENV`. `DB_SECRET_ARN` only points to the RDS master secret, it is not a credential. The origins and the reset URL come from the variables `allowed_origins` and `password_reset_url_base` (https only; each origin must be canonical, with a lowercase host and no default `:443` port, because the API compares it with its parsed `URL.origin`; placeholders in `example.tfvars`). |
| Files | S3 bucket `aula-virtual-prod-files-<random suffix>` (module `storage`) | Private (all public access blocked), versioned, encrypted (AES256), owner-enforced ownership, and a bucket policy that denies any request not using TLS. Old versions expire after 30 days and abandoned multipart uploads after 7 days. `prevent_destroy` is on. The API uploads and signs download URLs itself, so there is no CORS configuration. Outputs `storage_bucket_name` and `storage_bucket_arn`. |
| Access | Inline policy `aula-virtual-prod-host-runtime` on the host role (module `runtime_access`) | See [Host role permissions](#host-role-permissions). |
| Logs | CloudWatch log groups `/aula-virtual-prod/api`, `/aula-virtual-prod/realtime` and `/aula-virtual-prod/caddy` | Retention 14 days. Terraform creates them so the host never needs permission to create groups. Output `log_group_names`. |

### Host role permissions

The host role keeps `AmazonSSMManagedInstanceCore` and gets one inline policy with these statements. Nothing allows `*` except the ECR login token.

| Statement | Allows | Why |
|-----------|--------|-----|
| `EcrAuthToken` | `ecr:GetAuthorizationToken` on `*` | AWS does not support limiting this action to a repository, so `*` is the only accepted value. It only returns a login token and grants no access to images by itself. It is kept in its own statement so every other statement stays scoped. |
| `EcrPull` | Pull actions (`BatchGetImage`, `GetDownloadUrlForLayer`, `BatchCheckLayerAvailability`) on the three repositories | The host pulls images. It cannot push or delete them. |
| `ReadAppSecrets` | `secretsmanager:GetSecretValue` on the three app secrets and the RDS master secret | The start script reads them and injects them as container environment. |
| `ReadAppConfig` and `ReadAppConfigByPath` | `ssm:GetParameters` on each parameter, `ssm:GetParametersByPath` on each config path | The start script reads the non-secret config. Reading by path is authorized against the path itself and the parameters under it, so both forms are listed. |
| `FilesBucketObjects` | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on objects of the files bucket | The API stores and reads submissions. There is no `s3:ListBucket` because the API uses known keys. |
| `ReadHostFiles` | `s3:GetObject` on `host-files/*` of the pipeline artifact bucket | The deploy pipeline publishes the compose file, scripts and Caddyfile there; the host downloads them. Nothing else in that bucket is readable. |
| `WriteServiceLogs` | `logs:CreateLogStream`, `logs:PutLogEvents` on the three log groups | The Docker `awslogs` driver writes the container logs. |

There is no KMS statement: the secrets use the AWS managed key `aws/secretsmanager`, which any caller allowed to use Secrets Manager can use. If a customer managed key is added later, the role needs `kms:Decrypt` on it.

### One-time setup after `terraform apply`

Apply creates the secret containers empty, and the api cannot start until they have a value. Load them once, from the machine where you run Terraform, with the same AWS credentials. From the repository root:

```sh
terraform -chdir=infra/envs/prod output -json app_secret_arns \
  | infra/scripts/seed-app-secrets.sh --region us-east-2
```

Or save the JSON to a file and pass it with `--arns-file arns.json` (the file holds ARNs only, never values). The script generates each value with AWS (`get-random-password`), validates it, stores it with `put-secret-value` and never prints it. It **skips a secret that already has a value**, so it is safe to run again, and it stops without writing anything if it cannot check the current value (permissions, expired session, network).

On Linux and macOS the value goes to the AWS CLI through stdin. Under **Git Bash on Windows** the native AWS CLI cannot read `/dev/stdin`, so the script falls back to passing the value as an argument; on a single-user workstation that adds no meaningful exposure (details in the script header).

To rotate a secret later, generate a new value and store it with `aws secretsmanager put-secret-value` for that secret (the script never overwrites). Secrets Manager keeps the old value as `AWSPREVIOUS`. Then redeploy (rerun `start-app.sh`) so the host reads the new value. Impact: rotating `JWT_SECRET` invalidates every issued access token, and rotating `INVITATION_TOKEN_KEY` invalidates pending invitations.

### Host layout

The host runs the stack from `/opt/aula`. Keep the relative layout, because the Compose file mounts `../caddy/Caddyfile`:

| Path on the host | Content |
|------------------|---------|
| `/opt/aula/infra/deploy/compose.prod.yaml` and `start-app.sh` (executable) | Copied from `infra/deploy/`. |
| `/opt/aula/infra/deploy/systemd/` | The two systemd unit files, copied from `infra/deploy/systemd/`. |
| `/opt/aula/infra/caddy/Caddyfile` | Copied from `infra/caddy/Caddyfile`. |
| `/opt/aula/infra.prev/` | Only after a pipeline deploy: the previous `infra` tree, kept as the one backup. The pipeline replaces `/opt/aula/infra` as a whole, so do not edit files there by hand. |
| `/etc/aula-app/deploy.env` | Non-secret inputs for the refresh timer, see below. |
| `/var/lib/aula-app/deployed-state` | Written by `start-app.sh` after each successful start: four lines `db_secret_version` (the version id of the RDS master secret, not its value), `api_image`, `realtime_image` and `migrate_image`. Never secrets. |
| `/var/lib/aula-app/deploy.lock` | Lock file. Only one deployment or refresh runs at a time; another waits up to 5 minutes. It holds no data. |

### Manual deploy with Session Manager (fallback)

The normal path is the [deploy pipeline](#deploy-pipeline-codepipeline-and-codebuild). Use this procedure only to prepare a new host (the pipeline needs `/opt/aula`, `/etc/aula-app/deploy.env` and the timer: steps 1, 3 and 5), or when the pipeline is unavailable. The images must already be in ECR: the pipeline pushes them, or push them by hand (`docker login` to ECR, then `docker build` and `docker push` for `api`, `realtime` and `migrate`, the last built with `--target migrate`) with a `release-*` tag such as `release-2026-11-16-1`; tags are immutable, so each push needs a new tag. Then, in a [Session Manager shell](#reach-the-host-with-session-manager):

1. Become root and create the folders:

   ```sh
   sudo -i
   mkdir -p /opt/aula/infra/deploy/systemd /opt/aula/infra/caddy /etc/aula-app /var/lib/aula-app
   ```

2. Copy the files. There is no SSH or file transfer, so paste each file from the repository into the shell, for example:

   ```sh
   cat > /opt/aula/infra/deploy/compose.prod.yaml <<'EOF_FILE'
   <paste the file content>
   EOF_FILE
   ```

   Do this for `compose.prod.yaml`, `start-app.sh`, the two files in `systemd/` and the `Caddyfile` (to the paths of the table above), then run `chmod +x /opt/aula/infra/deploy/start-app.sh`.

3. Create `/etc/aula-app/deploy.env` with **non-secret** values only. `SITE_ADDRESS` is the output `host_sslip_domain`:

   ```sh
   cat > /etc/aula-app/deploy.env <<'EOF_FILE'
   NAME_PREFIX=aula-virtual-prod
   AWS_REGION=us-east-2
   SITE_ADDRESS=<output host_sslip_domain>
   EOF_FILE
   ```

   Do not put secrets or image values here; the refresh reuses the images recorded in the state file.

4. Deploy, with the full image URIs (the repository URLs are in `terraform output ecr_repository_urls`, followed by `:<tag>`; the three images share one tag):

   ```sh
   /opt/aula/infra/deploy/start-app.sh \
     --name-prefix aula-virtual-prod --region us-east-2 \
     --api-image <api repository url>:<release tag> \
     --realtime-image <realtime repository url>:<release tag> \
     --migrate-image <migrate repository url>:<release tag> \
     --site-address <output host_sslip_domain>
   ```

   The script reads the config from SSM and the secrets from Secrets Manager with the instance role, logs in to ECR, runs the one-shot `migrate` service (database migrations) and then `docker compose up -d --wait`. If something is missing it stops with a message that names the item, never a value. `docker login` keeps the ECR token (valid about 12 hours) in root's Docker config (`~/.docker/config.json`). To update later, run it again with the new image URIs. `--migrate-image` is required: a host whose state file has no `migrate_image` (deployed before the migrate service existed) must be deployed once with it. If the Caddyfile changed, add `--recreate-caddy`, because the running Caddy container keeps the old file mounted.

5. Install the rotation refresh (next section):

   ```sh
   cp /opt/aula/infra/deploy/systemd/app-db-refresh.service /opt/aula/infra/deploy/systemd/app-db-refresh.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now app-db-refresh.timer
   ```

**Rollout order.** The start script reads the database settings from SSM. Run `terraform apply` (it creates the parameters) **before** shipping a newer `start-app.sh` to the host; otherwise the script stops because `DB_HOST` and the other parameters are missing.

### RDS password rotation

AWS rotates the RDS master password about every 7 days, and `DATABASE_URL` is built once when the stack starts. The timer `app-db-refresh.timer` runs `start-app.sh --refresh-if-rotated` two minutes after boot and every 10 minutes. It does nothing while the secret version equals the one in the state file; after a rotation it redeploys the api with the new password, using the images recorded in the state file (so it never rolls back to older images). **Until the timer fires after a rotation, new api database connections can fail, for up to about 10 minutes.** Check the timer with `systemctl list-timers app-db-refresh.timer` and the last run with `journalctl -u app-db-refresh.service`.

### Roll back (manual)

There is no automatic rollback: if `docker compose up --wait` fails, the script exits with an error and the stack stays in whatever state Compose left it. To go back by hand, run `start-app.sh` again with the three image URIs of the previous `release-*` tag (as in step 4). That also becomes the recorded state, so later refreshes keep it. The old images must still exist in ECR; the lifecycle keeps the newest 20 release images. The full procedure, including the database implications, is in [Roll back a release](#roll-back-a-release).

### Delete the files bucket

The bucket holds user files, so it has `prevent_destroy` in Terraform, versioning and `force_destroy = false`: `terraform destroy` fails on it on purpose. To delete it deliberately:

1. Open a reviewed change that removes `prevent_destroy` from `modules/storage/bucket.tf`, and apply it.
2. Empty the bucket **including all object versions and delete markers** (the console "Empty" action does this; `aws s3 rm` alone leaves old versions behind and the deletion fails).
3. Run `terraform destroy`.

Back up anything that must be kept before step 2: noncurrent versions are the only recovery copy.

### Estimated monthly cost of the deployment resources (unverified)

**These figures are not verified.** They are approximate public `us-east-2` list prices written from memory, without a live pricing lookup, and not compared with the Free plan credits. Check the [AWS Pricing Calculator](https://calculator.aws/) before applying. They add to the [table above](#estimated-monthly-cost-unverified).

| Item | Assumption | Approximate monthly cost |
|------|-----------|--------------------------|
| ECR storage | about USD 0.10 per GB-month; two repositories, a few hundred MB per image, up to 20 release images each | about USD 1 to 3 |
| Secrets Manager | about USD 0.40 per secret per month; 3 app secrets (the RDS master secret is already counted) | about USD 1.2 |
| SSM Parameter Store | standard parameters are free | USD 0 |
| CloudWatch Logs | about USD 0.50 per GB ingested and USD 0.03 per GB-month stored; depends entirely on log volume | unknown, likely under USD 1 at low traffic |
| S3 files bucket | about USD 0.023 per GB-month plus requests; depends on uploads | unknown, likely under USD 1 at low usage |

Not included: data transfer out and the API request charges of each service. The [pipeline](#estimated-monthly-cost-of-the-pipeline) has its own estimate.

### Known follow-ups

Not fixed in #61:

- Use `sslmode=verify-full` with the RDS certificate bundle. Today it is `require`, which encrypts but does not verify the server; this would also close the risk that someone able to write SSM parameters could redirect the database connection.
- Roll back automatically when `docker compose up --wait` fails. The pipeline restores the previous host files when `start-app.sh` fails, and a failed migration leaves the running containers untouched, but containers already recreated are not rolled back.
- Read the realtime config after the refresh early exit, so a no-op timer tick has one less failure mode.
- Add script tests for a malformed `DB_SECRET_ARN` and an out-of-range `DB_PORT`, and keep the validation regexes of the script and of Terraform in sync.
- Remove the now-redundant `compact()` in `envs/prod/main.tf`, and centralize the repeated mock overrides in the test files if Terraform supports it.
- The `scripts/ci` tests that need PyYAML are skipped where it is not installed; decide whether CI installs it.

## Deploy pipeline (CodePipeline and CodeBuild)

Issue #58 (decision [D19](../docs/technical-justification.md#d19-keyless-deploy-pipeline-inside-aws)) adds a pipeline that deploys the backend from AWS itself, with no long-lived keys and no GitHub OIDC provider. It is declared in `envs/prod` through `modules/delivery_pipeline` and covered by `terraform test` with a mocked AWS provider. **It has not been applied to AWS yet**: the first apply happens from the merged `develop` (see [One-time setup](#one-time-setup-after-the-first-apply)).

### What it is

The pipeline `aula-virtual-prod-backend` is a CodePipeline **V2** pipeline in `QUEUED` mode. A push to `develop` of `Agustin742/integratec-final-back` starts it, through a CodeConnections GitHub connection. In `QUEUED` mode a push that arrives while a run waits for approval or deploys waits its turn, so two runs never apply or deploy at the same time. **Every run stops at the manual approval, even when the plan has no changes.**

| Stage | Action | CodeBuild project, buildspec and role | What it does |
|-------|--------|---------------------------------------|--------------|
| Source | `Source` | none (CodeConnections) | Downloads the commit of `develop` as a zip. |
| Plan | `Plan` | `aula-virtual-prod-terraform-plan`, `infra/pipeline/buildspecs/terraform-plan.yml`, role `aula-virtual-prod-terraform-plan-role` | Runs `terraform plan` of `infra/envs/prod`, prints it in the build log and saves it as `tfplan`. |
| Approval | `ApprovePlan` | none (manual) | Waits for a person to approve or reject. |
| Apply | `Apply` | `aula-virtual-prod-terraform-apply`, `terraform-apply.yml`, role `aula-virtual-prod-terraform-apply-role` | Applies exactly the saved `tfplan`; it never plans again. Terraform refuses a plan that is stale (the state changed after the plan), which fails the build on purpose. |
| Images | `Images` | `aula-virtual-prod-images`, `images.yml`, role `aula-virtual-prod-images-role` | Builds the `api`, `realtime` and `migrate` images and pushes them to ECR as `release-<UTC yyyymmdd>-<short sha>`. An image that already exists (a retried run) is skipped, because ECR tags are immutable. |
| Deploy | `Deploy` | `aula-virtual-prod-deploy`, `deploy.yml`, role `aula-virtual-prod-deploy-role` | Packs the host files, sends `infra/pipeline/scripts/host-deploy.sh` to the host with SSM Run Command, waits for it, then checks `https://<site>/api/health` and `/realtime/health`. |

The pipeline itself uses the role `aula-virtual-prod-backend-role`. All four CodeBuild projects use the `general1.small` compute type and the managed image `aws/codebuild/amazonlinux-x86_64-standard:5.0`; only `images` runs in privileged mode, which Docker needs. Their logs go to the CloudWatch log group `/aula-virtual-prod/codebuild` (14 days). The pipeline artifacts (source zip, saved plan and the host files tarball) live in a private artifact bucket with SSE-S3 and a 30-day expiry.

**Inputs that Terraform injects** (no values here; the repository is public and some of them hold the account ID). All are plain, non-secret CodeBuild environment variables:

| Project | Variables |
|---------|-----------|
| plan | `TF_STATE_BUCKET`, `TF_VAR_region`, `TF_VAR_project`, `TF_VAR_enable_github_oidc`, `TF_VAR_allowed_origins`, `TF_VAR_password_reset_url_base` |
| apply | `TF_STATE_BUCKET` (Terraform takes every other value from the saved plan) |
| images | `ECR_REGISTRY`, `ECR_REPOSITORY_API`, `ECR_REPOSITORY_REALTIME`, `ECR_REPOSITORY_MIGRATE` |
| deploy | `INSTANCE_ID`, `ARTIFACT_BUCKET`, `SITE_ADDRESS`, plus `API_IMAGE`, `REALTIME_IMAGE`, `MIGRATE_IMAGE` and `IMAGE_TAG`, which the pipeline takes from the variables exported by the `Images` action |

Because the plan reads `allowed_origins` and `password_reset_url_base` from the module inputs, changing either value needs **one local `terraform apply`** to update the project; after that, the pipeline plan equals the local one.

### Permissions

| Role | Can do | Cannot do |
|------|--------|-----------|
| plan | Read every managed service (`ReadOnlyAccess`), read the state, take the state lock, write its logs and artifacts. | Change infrastructure. Reading secret values and the uploaded files is explicitly denied. |
| apply | Change what the prod root manages (EC2 and network, RDS, IAM roles and policies named `aula-virtual-prod-*`, ECR, S3, SSM, Secrets Manager containers, log groups, Amplify, CodeConnections, CodeBuild, CodePipeline), and read and write the state. | Read secret values or the files bucket objects. |
| images | Write its logs, read the source artifact, push to the three image repositories (`ecr:GetAuthorizationToken` is on `*`, the only value AWS accepts). | Anything else in ECR or any other service. |
| deploy | Write its logs, read the source artifact, publish `host-files/` in the artifact bucket, run `AWS-RunShellScript` on the **one** host instance, read and cancel that command. | Run commands on any other instance. |
| pipeline | Use the one GitHub connection, move artifacts through the artifact bucket, start and watch the four projects. | Anything the builds themselves do; they use their own roles. |

**Known trade-off (D19).** The apply role has to be broad, because the Terraform code can create any kind of resource, including IAM roles, so it can modify **its own role**. Anyone who controls the Terraform code that an approved plan was built from can escalate. It is mitigated, not removed, by approving a **saved plan** (what you read is what runs) and by the branch protection of `develop`. Read every plan before approving, and treat `develop` as the trust boundary.

### One-time setup after the first apply

Do this only after the change is merged to `develop` (apply from the merged `develop`, never from an unmerged branch).

1. **Apply locally.** From `infra/envs/prod` on the updated `develop`, run `terraform plan -out=prod.tfplan`, read it (it must only add resources), then `terraform apply prod.tfplan`. This creates the pipeline, the projects, the roles, the artifact bucket and the GitHub connection. **The connection is created in the `PENDING` state**: AWS cannot log in to GitHub for you, so a person has to authorize it once.
2. **Check the host is ready.** The pipeline updates a host that already runs the stack, so `/opt/aula`, `/etc/aula-app/deploy.env` and the refresh timer must exist (they were set up with the [manual deploy](#manual-deploy-with-session-manager-fallback)). The host role gets read access to the artifact bucket from the same apply.
3. **Complete the GitHub handshake in the AWS console** (region `us-east-2`; this is the one step Terraform cannot do):
   1. Open the console and go to **Developer Tools > Settings > Connections** (search for "Developer Tools").
   2. Select the connection created by Terraform (its ARN is `terraform output pipeline_connection_arn`) and choose **Update pending connection**.
   3. A window opens to GitHub. Sign in with the account that owns the repository, choose **Install a new app** (or select the existing AWS Connector for GitHub app), and grant it access to `Agustin742/integratec-final-back`. Only that repository is needed.
   4. Back in AWS, choose **Connect**. The connection now shows **Available**.
4. **Check the status from the terminal.** Terraform reads it on the next refresh, so run `terraform apply -refresh-only` if the value is stale, or just run:

   ```sh
   terraform output pipeline_connection_status    # must print AVAILABLE
   ```

5. **Start the first run.** A push to `develop` starts a run by itself. To start one now, open **CodePipeline > Pipelines > `aula-virtual-prod-backend`** and choose **Release change** (or run `aws codepipeline start-pipeline-execution --region us-east-2 --name "$(terraform output -raw pipeline_name)"`). The run stops at the approval; follow [How to approve](#how-to-approve).

Until step 3 is done, the `Source` action fails with a message about the connection, and nothing else runs.

### How to approve

When the run reaches the **Approval** stage, the pipeline waits for a person. Nothing is applied before that.

1. Open **CodePipeline > Pipelines > `aula-virtual-prod-backend`**. The `Plan` action shows **Succeeded** and `ApprovePlan` shows **Waiting for approval**.
2. **Read the plan.** It is in the build log of the `Plan` action: choose **Details** on that action (or **View in CodeBuild**, or follow the link on the approval, which opens the history of the plan project), then the build log. Everything after `terraform show` is the full plan.
3. **What to look for:**
   - A summary of `Plan: X to add, Y to change, Z to destroy`. For a code-only change it should say `No changes`.
   - **Any destroy or replace (`must be replaced`, `-/+`) of a stateful resource must be called out and understood before approving:** the RDS instance, the EBS volume and the host instance, the files bucket, the state bucket, the secrets, the ECR repositories. The database and the files bucket have `prevent_destroy` and the plan fails for them, but the host replacement or a secret deletion do not stop on their own.
   - Changes to IAM roles or policies, security groups or anything that opens a port.
   - Anything you did not expect from the commit that started the run.
4. Choose **Review** on the approval, write a short comment, and **Approve** or **Reject**.

**Reject, or let it time out, and nothing changes.** The `Plan` build only wrote a saved plan into the artifact bucket; Apply, Images and Deploy never start, and the run fails at the Approval stage. The default wait is 1440 minutes (24 hours, variable `approval_timeout_minutes`, 5 minutes to 7 days). The next push to `develop` starts a new run with a fresh plan. Because the plan is saved and the apply uses that file, a change to the infrastructure after the plan (a local apply, for example) makes the apply fail with a stale plan error instead of applying something nobody read: reject, and run again.

### Migrations

Database migrations run on the host, not in the pipeline, because the database is private and a build inside the VPC would need a NAT gateway. `start-app.sh` logs in to ECR and runs the one-shot `migrate` service of `compose.prod.yaml` on its own (`docker compose run --rm --no-deps migrate`, which executes `prisma migrate deploy` with the same `DATABASE_URL` as the api), and only then `docker compose up -d --wait`. The api starts after the migrations succeeded, so a new migration is applied automatically before the new code runs.

**A failed migration leaves the running stack untouched.** The script exits with an error before `up`, the current api and realtime containers keep running, the deployed state file is not updated and the Deploy stage fails, with the migration output in the build log. Fix the migration and push again. A migration that fails halfway can leave the database partly changed; check the migration table before retrying. The same step runs on a manual deploy, so a manual redeploy migrates too.

### Roll back a release

There is no automatic rollback. Choose the way that fits:

1. **Revert and push (preferred).** Revert the faulty change in Git and push it to `develop`. The pipeline runs again, shows the plan, and ships a new release built from the corrected code. This is the only way that also rolls back infrastructure changes, with the usual approval.
2. **Run the pipeline for an older commit.** Start an execution with a specific source revision, `aws codepipeline start-pipeline-execution --region us-east-2 --name aula-virtual-prod-backend --source-revisions actionName=Source,revisionType=COMMIT_ID,revisionValue=<full commit sha>`. Read the plan carefully: it plans that commit's Terraform against the current state, so it may propose to undo infrastructure changes made since.
3. **Redeploy a previous `release-*` tag by hand** (fastest, touches no infrastructure). In a [Session Manager shell](#reach-the-host-with-session-manager), as root, run `start-app.sh` with the previous tag for all three images, `--api-image`, `--realtime-image` and `--migrate-image`, as in the [manual deploy](#manual-deploy-with-session-manager-fallback). The tags of earlier releases are in ECR (`aws ecr describe-images --repository-name aula-virtual-prod-api --query 'sort_by(imageDetails,&imagePushedAt)[].imageTags'`); the newest 20 `release-*` images are kept. That also becomes the recorded state, so the refresh timer keeps it. The host files in `/opt/aula/infra` stay those of the latest pipeline deploy; **`/opt/aula/infra.prev`** holds the tree of the deploy before it, and you can run its `deploy/start-app.sh` if the older release needs the older files. Nothing in ECR or on the host is deleted by a roll back.

**Database migrations are forward-only.** The pipeline never runs a down migration, and rolling the code back does not undo a migration that was already applied. A release that went out with a destructive or data-changing migration cannot be undone by redeploying old code: restore from the [backups](#backups-and-restore) (point-in-time restore creates a new instance) or write a new forward migration. Follow [rules/data.md](../rules/data.md) for migrations that change data, so that the previous release still works with the new schema (expand first, contract in a later release). Rolling back to a release older than the applied migrations is only safe when the old code tolerates the newer schema.

### Estimated monthly cost of the pipeline

Prices below were read from the official AWS pages on **2026-11-18**. Region differences are noted where the page did not show `us-east-2`.

| Item | Price and free tier (source) |
|------|------------------------------|
| CodePipeline V2 | USD 0.002 per action execution minute, rounded up; 100 free action execution minutes per month shared by all V2 pipelines, not carried over. Manual approval is not billed; every other action, CodeBuild included, is. Source: [CodePipeline pricing](https://aws.amazon.com/codepipeline/pricing/). |
| CodeBuild `general1.small` (Linux) | About USD 0.005 per build minute (the rate of the page's own on-demand example; the page shows no per-region table); 100 free build minutes per month for `general1.small` and `arm1.small`, which the page says do not expire after the 12-month Free Tier term. Source: [CodeBuild pricing](https://aws.amazon.com/codebuild/pricing/). |
| CloudWatch Logs (Standard) | USD 0.50 per GB ingested in the first tier (page values are for US East, N. Virginia); 5 GB per month free. The storage rate was not read. Source: [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/). |
| S3 | The storage price table was not in the page text that could be read, so the figure below is an unverified recollection of about USD 0.023 per GB-month. Source: [S3 pricing](https://aws.amazon.com/s3/pricing/). |
| CodeConnections | No price was found: the pricing page of the service does not exist at the usual address and the CodePipeline pricing page does not list a connection charge. Treated as unknown, expected to be USD 0. |

**Assumed usage:** 20 pipeline runs per month, each with about 15 CodeBuild minutes (plan 3, apply 2, images 8, deploy 2) plus 1 minute for the Source action. The approval wait is not billed.

| Item | Arithmetic | Monthly cost |
|------|------------|--------------|
| CodeBuild | 20 x 15 = 300 min; 300 - 100 free = 200 min x USD 0.005 | about USD 1.00 |
| CodePipeline | 20 x 16 = 320 action minutes; 320 - 100 free = 220 min x USD 0.002 | about USD 0.44 |
| CloudWatch Logs | 20 runs x about 2 MB = about 40 MB, far under the 5 GB free tier | USD 0 |
| S3 artifacts | 20 runs x about 10 MB = about 200 MB for at most 30 days x USD 0.023 per GB | under USD 0.01 |
| Total with the free tiers | | **about USD 1.5** |
| Total with no free tier | 300 x 0.005 + 320 x 0.002 | about USD 2.2 |

Running more often scales linearly: each extra 15-minute run adds about USD 0.1 once the free minutes are used. The new ECR repository for the `migrate` image adds a little storage (see the [deployment resources estimate](#estimated-monthly-cost-of-the-deployment-resources-unverified)).

**What could be verified and what is unknown.** The unit prices and the free-tier amounts of CodePipeline and CodeBuild come from the pages above. **Not verified for this account:** this account uses the AWS "new sign-up experience" Free plan, which gives USD 100 of credits (up to USD 200 by exploring services) and closes the account after 6 months or when the credits run out, whichever comes first ([AWS Free plan](https://aws.amazon.com/free/), read 2026-11-18). That page says the Free plan covers "select services only" and does not mention CodePipeline, CodeBuild or CodeConnections, so **whether these services can be used at all on the Free plan, whether the free minutes above apply to it and whether their charges draw from the credits is unknown**. Check the account's Billing page after the first runs. The pipeline fails safely if a service is blocked: nothing is applied or deployed.

## Frontend hosting (AWS Amplify)

The frontend (`integratec-final-front`) is served by AWS Amplify Hosting in `us-east-2`, built on every push to its `develop` branch. Front issue `Agustin742/integratec-final-front#22`. The app was created once in the Amplify console (2026-11-17) and brought under Terraform with `import` blocks, through `modules/frontend_hosting` wired in `envs/prod`. It is covered by `terraform test` with a mocked AWS provider.

### What Terraform owns and what it does not

| Owned by Terraform | Not owned by Terraform |
|--------------------|------------------------|
| The app (name, repository, `WEB` platform) | The GitHub connection: the Amplify GitHub App was authorized once in the console and scoped to the frontend repository. |
| The SPA rewrite rule (`/index.html`, status 200), identical to the frontend `docs/routing.md` | The build recipe: it comes from `amplify.yml` in the frontend repository. |
| The build variables `VITE_APP_ENV`, `VITE_API_BASE_URL` and `VITE_REALTIME_URL` | The security headers: they come from `customHttp.yml` in the frontend repository. |
| The `develop` branch (`PRODUCTION` stage, auto build on push) | Custom domains and basic auth (none today). |

**Why there is no token.** `access_token` and `oauth_token` are never set: Terraform would store them in the state file, and AWS does not keep them either. The existing GitHub App connection needs neither, and the AWS provider documents omitting `access_token` when importing an existing app. The tests fail if the module ever sets a token, `custom_headers`, `build_spec` or basic auth credentials.

The variables are public: every `VITE_*` value is compiled into the browser bundle, so only non-secret URLs belong there. `VITE_API_BASE_URL` and `VITE_REALTIME_URL` are derived from the host sslip.io name (`host_sslip_domain`), so they follow the Elastic IP (the same local as that output), plus the paths Caddy serves: `https://<host>.sslip.io/api` and `wss://<host>.sslip.io/realtime` (`infra/caddy/Caddyfile` strips the `/api` and `/realtime` prefixes before the services). Override them with `frontend_api_base_url` and `frontend_realtime_url` (https and wss base URLs with an optional path, no trailing slash, query or fragment) when a real domain exists, keeping the same path if it still sits behind that Caddy. After changing them, start an Amplify build by hand (see [Rebuild after changing the origins](#rebuild-after-changing-the-origins)).

### Import

The `import` blocks in `envs/prod/main.tf` use the app ID (`frontend_amplify_app_id`, default `d61i488hxxotx`) and `<app id>/<branch name>` for the branch, the formats of the AWS provider documentation. A plan shows the two resources as `imported` and no add or destroy. **The only update expected is `tags_all`**: the app and branch were created without tags, so the apply adds `Project`, `Environment` and `ManagedBy`, like every other resource. Anything else in the plan is drift: stop and compare it with the console before applying.

```sh
cd infra/envs/prod
terraform plan          # 2 to import, 0 to add, 0 to destroy
```

The variable `import_existing_frontend` (default `true`) only exists because mock providers cannot import: the tests set it to `false`. After the first apply records the resources in the state, the import blocks have no effect and can be removed in a later change.

### Outputs

```sh
terraform output frontend_amplify_app_id
terraform output frontend_default_domain   # d61i488hxxotx.amplifyapp.com
terraform output frontend_branch_url       # https://develop.<default domain>
```

`frontend_branch_url` is the origin to put in `allowed_origins` (CORS) and the base of `password_reset_url_base`.

### Move the deployed branch to `main`

### Rebuild after changing the origins

Changing `environment_variables` (for example because the Elastic IP or the domain changed, so `VITE_API_BASE_URL` and `VITE_REALTIME_URL` change) does **not** rebuild the app, and the `VITE_*` values are compiled into the bundle at build time. After applying such a change, start a build of the deployed branch by hand (or push a commit to it):

```sh
aws amplify start-job --app-id "$(terraform output -raw frontend_amplify_app_id)"   --branch-name develop --job-type RELEASE
```

Use the branch in `frontend_branch` instead of `develop` when it is different.

### Move the deployed branch to `main`

Moving the branch is a short outage, not a seamless switch. `branch_name` forces a replacement and the resource has no `create_before_destroy`, so Terraform deletes the `develop` branch first and then creates `main`. Creating a branch through the API does not start a build, so `https://main.<default domain>` serves nothing until a build runs.

1. Drop the branch import first (set `import_existing_frontend = false` or remove the import blocks). With `frontend_branch = "main"` the import id becomes `<app id>/main`, which does not exist yet, so the plan would fail.
2. Set `frontend_branch = "main"` (for example in `terraform.tfvars`) and review the plan: it must destroy `develop` and create `main`, and the output URL changes to `https://main.<default domain>`.
3. Update `allowed_origins` and `password_reset_url_base` to the new URL in the same change, apply, and restart the stack on the host so the API reads the new SSM values.
4. Start the first build of `main` (or push to `main`):

   ```sh
   aws amplify start-job --app-id "$(terraform output -raw frontend_amplify_app_id)"      --branch-name main --job-type RELEASE
   ```

Until step 4 finishes, the frontend is down.

## GitHub Actions OIDC role

`envs/prod` can create the `token.actions.githubusercontent.com` OIDC provider and the role `aula-virtual-prod-github-actions` (output `github_actions_role_arn`).

**Disabled by default.** The variable `enable_github_oidc` defaults to `false`, so none of these resources are planned and `github_actions_role_arn` is `null`. The reason: the current AWS account was created with the "Sign up for AWS (new)" experience, and an AWS-managed service control policy denies `iam:CreateOpenIDConnectProvider` (the policies cannot be edited unless the account's advanced features are activated, which needs a paid plan, removes the spend limit, and is irreversible). This role **stays disabled**: [D19](../docs/technical-justification.md#d19-keyless-deploy-pipeline-inside-aws) supersedes it for delivery, because the [deploy pipeline](#deploy-pipeline-codepipeline-and-codebuild) runs inside AWS with service roles and needs no OIDC provider. GitHub Actions keeps static checks only and holds no AWS credentials. Long-lived access keys are never an alternative (decision D6).

It would only be enabled for a future need the pipeline does not cover, after the restriction is lifted: set `enable_github_oidc = true` (for example in the git-ignored `terraform.tfvars`), review the plan, apply, and copy the `github_actions_role_arn` output into the workflow below.

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

Test convention: every `*.tftest.hcl` in `envs/prod/tests` carries the same `override_data` for the ECR lifecycle policy document in its `mock_provider`, because the mock returns non-JSON for data source `.json` and the registry module is part of every plan. Keep it in new test files; the rule contents are asserted through the `lifecycle_rules` module output.

## Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| State locking | S3 native lockfile | Supported since Terraform 1.10; avoids a DynamoDB table. |
| State bucket creation | Separate `bootstrap/` root with local state | The bucket cannot hold its own state; isolating it keeps `prod` fully remote. |
| Region | `us-east-2` | Assigned to the account by AWS from the contact country and enforced by managed service control policies; it cannot be changed (D5). |
| CI role creation | Behind `enable_github_oidc`, default `false` | The managed policies deny creating the OIDC provider in this account (D6). Delivery no longer needs it (D19). |
| Delivery | CodePipeline V2 and CodeBuild inside AWS, trigger on `develop`, manual approval of a saved plan | No long-lived keys and no OIDC provider; what is approved is what is applied (D19). |
| Migrations | One-shot `migrate` Compose service on the host, before the api | RDS is private; avoids a VPC-attached build and a NAT gateway (D19). |
| CI role trust | `main` branch only (role disabled) | Only reviewed, merged code can touch AWS. Kept for reference; the pipeline uses its own roles. |
| Environments | `prod` only | No other environment is agreed yet (open decision in the IaC rule). |

## Not managed here

| Resource | Owner | Reason |
|----------|-------|--------|
| AWS account, sign-in, and the operator role used by `aws login` | Agustin | Account-level identity is created before Terraform and is not project infrastructure. |
| `bootstrap/` local state file | Agustin | Bootstrap exception: it cannot live in the bucket it creates. |
| GitHub repository settings (branch protection, required checks, the role ARN as a variable) | Agustin | Configured in GitHub, not in AWS. |
| GitHub connection of the deploy pipeline (CodeConnections) | Agustin | Terraform creates it `PENDING`; the GitHub App handshake is completed once in the console, see [One-time setup](#one-time-setup-after-the-first-apply). |
| GitHub connection of the Amplify app (GitHub App installation) | Agustin | Authorized once in the Amplify console; Terraform manages the app and branch, not the connection. See [Frontend hosting](#frontend-hosting-aws-amplify). |

## Known gaps

- **GitHub OIDC is not available in the current account**, so GitHub Actions cannot deploy; delivery goes through the [deploy pipeline](#deploy-pipeline-codepipeline-and-codebuild) instead (D19). The pipeline is not applied yet.
- **Pull requests have no `terraform plan`.** The pipeline plans on every push to `develop` and a person reads that plan before approving, but a pull request is only validated and tested in CI (no AWS access). Plans of a change are run locally and summarized in the pull request.
- **The apply role is broad** (it can change every kind of resource of the prod root, including its own role); see [Permissions](#permissions).
- Actions in the workflow are pinned by tag, not by commit SHA. SHA pinning should be applied to the whole workflow in one change.
