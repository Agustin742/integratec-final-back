locals {
  environment = "prod"
}

# Prod compute is a single EC2 host (see rules/aws-infrastructure.md). The network
# lives in modules/network; the host, RDS and ECR are added by later issues. See
# infra/README.md for the list of resources intentionally left out.

module "network" {
  source = "../../modules/network"

  name_prefix = "${var.project}-${local.environment}"
  vpc_cidr    = var.vpc_cidr

  availability_zones = var.availability_zones
}
