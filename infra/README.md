# Infrastructure (Terraform)

AWS infrastructure for the backend, defined with Terraform in `us-east-2` (US East, Ohio). This directory holds a remote state bucket, the `prod` root with the network and the EC2 host and the database (see [Network and EC2 host](#network-and-ec2-host) and [Database (RDS PostgreSQL)](#database-rds-postgresql)), the container deployment resources (see [Container deployment](#container-deployment-ecr-secrets-config-compose)), and the GitHub Actions OIDC role (disabled by default, see below). **Nothing in `infra/` has been applied to AWS yet.** The image pipeline that builds and ships images is a later issue (#58).

Rules: [Infrastructure as code](../rules/infrastructure-as-code.md), [AWS infrastructure](../rules/aws-infrastructure.md). Decisions: [D5 region](../docs/technical-justification.md#d5-aws-region), [D6 pipeline authentication](../docs/technical-justification.md#d6-pipeline-authentication-to-aws).

## Layout

| Root | Purpose | State |
|------|---------|-------|
| `bootstrap/` | Creates the S3 bucket that stores every other root's state. Run once. | Local (`terraform.tfstate`, git-ignored). |
| `envs/prod/` | Production environment: network, EC2 host, RDS database and container deployment resources, plus the GitHub Actions OIDC provider and CI role (opt-in via `enable_github_oidc`). | Remote, `s3://<state bucket>/prod/terraform.tfstate`. |

Conventions:

- **Every root module has a `versions.tf`.** CI detects roots by that file and fails if a root is missing from the `terraform` job matrix in `.github/workflows/ci.yml`.
- Reusable child modules go under `infra/modules/` (`network`, `host`, `database`, `registry`, `app_config`, `storage`, `runtime_access`) and have no `versions.tf` of their own.
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
| RDS backup storage (#60) | free up to the size of the database; 7 days of retention are expected to stay within it | about USD 0 |
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

## Container deployment (ECR, secrets, config, Compose)

Issue #61 adds everything the host needs to run `api` and `realtime` behind Caddy: image repositories, secret containers, non-secret config, a files bucket, the host permissions, log groups, a production Compose file and a start script. Terraform creates only the AWS resources. The Compose file, the Caddyfile and the start script live in the repository and reach the host through Session Manager by hand until the pipeline (#58) automates it. **None of it has been applied to AWS.** It is covered by `terraform test` with a mocked AWS provider and by the unit tests in `scripts/ci`.

### Resources

| Area | Resource | Notes |
|------|----------|-------|
| Images | ECR repositories `aula-virtual-prod-api` and `aula-virtual-prod-realtime` (module `registry`) | Tags are **immutable** (a tag cannot be pushed twice), scan on push, AES256 encryption. Outputs `ecr_repository_urls` and `ecr_repository_arns`. |
| Images | ECR lifecycle policy | Untagged images expire after 7 days. Images tagged `release-*` keep the newest 20. Every other image expires 30 days after push. A release image is protected from the 30-day rule, so **#58 must tag deployable images `release-*`**, or they will be deleted. |
| Secrets | Three Secrets Manager secrets (module `app_config`): `<prefix>/jwt-secret`, `<prefix>/invitation-token-key`, `<prefix>/internal-service-secret` | Terraform creates **empty containers only**. The values are generated by AWS and loaded once by `infra/scripts/seed-app-secrets.sh`, so they never appear in Terraform code, plan, outputs or state. Recovery window 7 days. Output `app_secret_arns` (ARNs only). |
| Config | SSM Parameter Store `String` parameters under `/<prefix>/config/api/` and `/<prefix>/config/realtime/` | Non-secret values only. For the api: `ALLOWED_ORIGINS`, `PASSWORD_RESET_URL_BASE`, `NODE_ENV`, `S3_BUCKET`, `S3_REGION`, `REALTIME_INTERNAL_URL` and the database connection `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SECRET_ARN`. For realtime: `API_INTERNAL_URL` and `NODE_ENV`. `DB_SECRET_ARN` only points to the RDS master secret, it is not a credential. The origins and the reset URL come from the variables `allowed_origins` and `password_reset_url_base` (https only; placeholders in `example.tfvars`). |
| Files | S3 bucket `aula-virtual-prod-files-<random suffix>` (module `storage`) | Private (all public access blocked), versioned, encrypted (AES256), owner-enforced ownership, and a bucket policy that denies any request not using TLS. Old versions expire after 30 days and abandoned multipart uploads after 7 days. `prevent_destroy` is on. The API uploads and signs download URLs itself, so there is no CORS configuration. Outputs `storage_bucket_name` and `storage_bucket_arn`. |
| Access | Inline policy `aula-virtual-prod-host-runtime` on the host role (module `runtime_access`) | See [Host role permissions](#host-role-permissions). |
| Logs | CloudWatch log groups `/aula-virtual-prod/api`, `/aula-virtual-prod/realtime` and `/aula-virtual-prod/caddy` | Retention 14 days. Terraform creates them so the host never needs permission to create groups. Output `log_group_names`. |

### Host role permissions

The host role keeps `AmazonSSMManagedInstanceCore` and gets one inline policy with these statements. Nothing allows `*` except the ECR login token.

| Statement | Allows | Why |
|-----------|--------|-----|
| `EcrAuthToken` | `ecr:GetAuthorizationToken` on `*` | AWS does not support limiting this action to a repository, so `*` is the only accepted value. It only returns a login token and grants no access to images by itself. It is kept in its own statement so every other statement stays scoped. |
| `EcrPull` | Pull actions (`BatchGetImage`, `GetDownloadUrlForLayer`, `BatchCheckLayerAvailability`) on the two repositories | The host pulls images. It cannot push or delete them. |
| `ReadAppSecrets` | `secretsmanager:GetSecretValue` on the three app secrets and the RDS master secret | The start script reads them and injects them as container environment. |
| `ReadAppConfig` and `ReadAppConfigByPath` | `ssm:GetParameters` on each parameter, `ssm:GetParametersByPath` on each config path | The start script reads the non-secret config. Reading by path is authorized against the path itself and the parameters under it, so both forms are listed. |
| `FilesBucketObjects` | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on objects of the files bucket | The API stores and reads submissions. There is no `s3:ListBucket` because the API uses known keys. |
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
| `/etc/aula-app/deploy.env` | Non-secret inputs for the refresh timer, see below. |
| `/var/lib/aula-app/deployed-state` | Written by `start-app.sh` after each successful start: three lines `db_secret_version` (the version id of the RDS master secret, not its value), `api_image` and `realtime_image`. Never secrets. |
| `/var/lib/aula-app/deploy.lock` | Lock file. Only one deployment or refresh runs at a time; another waits up to 5 minutes. It holds no data. |

### Manual deploy with Session Manager (until #58)

The images must already be in ECR. Until #58 exists, push them by hand (`docker login` to ECR, then `docker push`) with a `release-*` tag such as `release-2026-11-16-1`; tags are immutable, so each push needs a new tag. Then, in a [Session Manager shell](#reach-the-host-with-session-manager):

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

4. First deploy, with the full image URIs (the repository URLs are in `terraform output ecr_repository_urls`, followed by `:<tag>`):

   ```sh
   /opt/aula/infra/deploy/start-app.sh \
     --name-prefix aula-virtual-prod --region us-east-2 \
     --api-image <api repository url>:<release tag> \
     --realtime-image <realtime repository url>:<release tag> \
     --site-address <output host_sslip_domain>
   ```

   The script reads the config from SSM and the secrets from Secrets Manager with the instance role, logs in to ECR, and runs `docker compose up -d --wait`. If something is missing it stops with a message that names the item, never a value. `docker login` keeps the ECR token (valid about 12 hours) in root's Docker config (`~/.docker/config.json`). To update later, run it again with the new image URIs.

5. Install the rotation refresh (next section):

   ```sh
   cp /opt/aula/infra/deploy/systemd/app-db-refresh.service /opt/aula/infra/deploy/systemd/app-db-refresh.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now app-db-refresh.timer
   ```

**Rollout order.** The start script reads the database settings from SSM. Run `terraform apply` (it creates the parameters) **before** shipping a newer `start-app.sh` to the host; otherwise the script stops because `DB_HOST` and the other parameters are missing.

### RDS password rotation

AWS rotates the RDS master password about every 7 days, and `DATABASE_URL` is built once when the stack starts. The timer `app-db-refresh.timer` runs `start-app.sh --refresh-if-rotated` two minutes after boot and every 10 minutes. It does nothing while the secret version equals the one in the state file; after a rotation it redeploys the api with the new password, using the images recorded in the state file (so it never rolls back to older images). **Until the timer fires after a rotation, new api database connections can fail, for up to about 10 minutes.** Check the timer with `systemctl list-timers app-db-refresh.timer` and the last run with `journalctl -u app-db-refresh.service`.

### Roll back

There is no automatic rollback: if `docker compose up --wait` fails, the script exits with an error and the stack stays in whatever state Compose left it. To go back, run `start-app.sh` again with the image URIs of the previous `release-*` tag (as in step 4). That also becomes the recorded state, so later refreshes keep it. The old image must still exist in ECR; the lifecycle keeps the newest 20 release images.

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

Not included: data transfer out and the API request charges of each service.

### Known follow-ups

Not fixed in #61:

- Use `sslmode=verify-full` with the RDS certificate bundle. Today it is `require`, which encrypts but does not verify the server; this would also close the risk that someone able to write SSM parameters could redirect the database connection.
- Roll back automatically when `docker compose up --wait` fails.
- Read the realtime config after the refresh early exit, so a no-op timer tick has one less failure mode.
- Add script tests for a malformed `DB_SECRET_ARN` and an out-of-range `DB_PORT`, and keep the validation regexes of the script and of Terraform in sync.
- Remove the now-redundant `compact()` in `envs/prod/main.tf`, and centralize the repeated mock overrides in the test files if Terraform supports it.
- The `scripts/ci` tests that need PyYAML are skipped where it is not installed; decide whether CI installs it.

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

Test convention: every `*.tftest.hcl` in `envs/prod/tests` carries the same `override_data` for the ECR lifecycle policy document in its `mock_provider`, because the mock returns non-JSON for data source `.json` and the registry module is part of every plan. Keep it in new test files; the rule contents are asserted through the `lifecycle_rules` module output.

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
