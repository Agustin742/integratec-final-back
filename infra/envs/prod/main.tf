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
}

module "registry" {
  source = "../../modules/registry"

  name_prefix = "${var.project}-${local.environment}"
}

module "storage" {
  source = "../../modules/storage"

  name_prefix = "${var.project}-${local.environment}"
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
}

module "app_config" {
  source = "../../modules/app_config"

  name_prefix = "${var.project}-${local.environment}"
  region      = var.region

  s3_bucket_name = module.storage.bucket_name

  allowed_origins         = var.allowed_origins
  password_reset_url_base = var.password_reset_url_base
}
