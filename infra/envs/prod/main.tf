locals {
  environment = "prod"
}

# Prod compute is a single EC2 host (see rules/aws-infrastructure.md). The network
# lives in modules/network, the host in modules/host, the database in modules/database
# and the container registries in modules/registry. See infra/README.md for the list of
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
