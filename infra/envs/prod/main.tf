locals {
  environment = "prod"
}

# Prod compute is a single EC2 host (see rules/aws-infrastructure.md). The network
# lives in modules/network, the host in modules/host, the database in modules/database
# and the container registries in modules/registry and the files bucket in modules/storage. See infra/README.md for the list of
# resources intentionally left out.

module "network" {
  source = "../../modules/network"

  name_prefix = "${var.project}-${local.environment}"
  vpc_cidr    = var.vpc_cidr

  availability_zones = var.availability_zones
}

module "host" {
  source = "../../modules/host"

  name_prefix = "${var.project}-${local.environment}"
  vpc_id      = module.network.vpc_id
  subnet_id   = module.network.public_subnet_id

  instance_type       = var.host_instance_type
  root_volume_size_gb = var.host_root_volume_size_gb

  # The Elastic IP can only be associated once the internet gateway is attached to
  # the VPC, which no value passed to the module expresses.
  depends_on = [module.network]
}

module "database" {
  source = "../../modules/database"

  name_prefix                       = "${var.project}-${local.environment}"
  vpc_id                            = module.network.vpc_id
  private_subnet_ids                = module.network.private_subnet_ids
  private_subnet_availability_zones = module.network.private_subnet_availability_zones
  host_security_group_id            = module.host.security_group_id
  backup_retention_period           = var.database_backup_retention_period
}

module "registry" {
  source = "../../modules/registry"

  name_prefix = "${var.project}-${local.environment}"
  # migrate is the one-shot prisma migrate deploy image (target `migrate` of apps/api/Dockerfile).
  services = ["api", "realtime", "migrate"]
}

module "storage" {
  source = "../../modules/storage"

  name_prefix = "${var.project}-${local.environment}"
}

# Foundation of the keyless deploy pipeline (D19): the GitHub connection (authorized once
# by hand in the console), the artifact bucket, the CodeBuild log group and the Terraform
# runner (CodeBuild plan and apply projects with their roles). The remaining projects and
# the pipeline itself are added by later changes.
module "delivery_pipeline" {
  source = "../../modules/delivery_pipeline"

  name_prefix = "${var.project}-${local.environment}"

  # Inputs of the Terraform runner (CodeBuild plan and apply). They are injected as
  # environment variables so the pipeline plan equals the local one (D19).
  project                 = var.project
  region                  = var.region
  state_key               = "${local.environment}/terraform.tfstate"
  allowed_origins         = var.allowed_origins
  password_reset_url_base = var.password_reset_url_base
  enable_github_oidc      = var.enable_github_oidc

  # Repositories the images project pushes to.
  ecr_repository_names = module.registry.repository_names
  ecr_repository_arns  = module.registry.repository_arns

  # Target and health check of the deploy project (SSM Run Command on this one instance).
  host_instance_id = module.host.instance_id
  site_address     = local.host_sslip_domain
}

# Least-privilege runtime access of the host role (ECR pull, secrets, config, files
# bucket, log writes) and the service log groups.
module "runtime_access" {
  source = "../../modules/runtime_access"

  name_prefix = "${var.project}-${local.environment}"
  role_name   = module.host.instance_role_name

  ecr_repository_arns = module.registry.repository_arns
  # RISK: compact() silently drops a null RDS master secret ARN, which would leave the
  # host without access to the database credentials and no error at plan time. It is
  # here only because test mocks leave the managed secret block empty; the real value
  # is guarded by database_instance.tftest.hcl, which asserts manage_master_user_password
  # (so RDS always creates the secret) and pins the ARN that runtime_access.tftest.hcl
  # expects in the policy.
  secret_arns             = compact(concat(values(module.app_config.secret_arns), [module.database.master_user_secret_arn]))
  ssm_parameter_arns      = flatten(values(module.app_config.parameter_arns))
  ssm_parameter_path_arns = values(module.app_config.parameter_path_arns)
  s3_bucket_arn           = module.storage.bucket_arn

  # The deploy pipeline publishes the host files here; the host reads host-files/* only.
  host_files_bucket_arn = module.delivery_pipeline.artifact_bucket_arn
}

module "app_config" {
  source = "../../modules/app_config"

  name_prefix = "${var.project}-${local.environment}"
  region      = var.region

  s3_bucket_name = module.storage.bucket_name

  # Single source of truth for the host: it reads these from SSM instead of the operator
  # copying Terraform outputs into the environment file.
  db_host       = module.database.address
  db_port       = module.database.port
  db_name       = module.database.db_name
  db_secret_arn = module.database.master_user_secret_arn

  allowed_origins         = var.allowed_origins
  password_reset_url_base = var.password_reset_url_base
}

# Frontend hosting (AWS Amplify Hosting). The app was created in the console, so it is
# imported rather than created; see infra/README.md. The browser base URLs the build bakes
# in default to the host sslip.io name plus the paths Caddy serves (infra/caddy/Caddyfile):
# the API under /api and realtime under /realtime, with the prefix stripped before the
# service. The VITE_* values are compiled into the bundle and changing them does not
# rebuild the app: after any change to these URLs, start a build with `aws amplify start-job --app-id <id> --branch-name <branch> --job-type RELEASE`.
locals {
  host_sslip_domain     = "${replace(module.host.public_ip, ".", "-")}.sslip.io"
  frontend_api_base_url = coalesce(var.frontend_api_base_url, "https://${local.host_sslip_domain}/api")
  frontend_realtime_url = coalesce(var.frontend_realtime_url, "wss://${local.host_sslip_domain}/realtime")
}

module "frontend_hosting" {
  source = "../../modules/frontend_hosting"

  name_prefix    = "${var.project}-${local.environment}"
  repository_url = var.frontend_repository_url
  branch_name    = var.frontend_branch

  api_base_url = local.frontend_api_base_url
  realtime_url = local.frontend_realtime_url
}

import {
  for_each = var.import_existing_frontend ? toset(["app"]) : toset([])

  to = module.frontend_hosting.aws_amplify_app.this
  id = var.frontend_amplify_app_id
}

import {
  for_each = var.import_existing_frontend ? toset(["branch"]) : toset([])

  to = module.frontend_hosting.aws_amplify_branch.this
  id = "${var.frontend_amplify_app_id}/${var.frontend_branch}"
}
