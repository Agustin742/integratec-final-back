mock_provider "aws" {
  # The mock returns a random string for data source JSON, so the ECR lifecycle
  # policy document is pinned to a well-formed value.
  override_data {
    target = module.registry.data.aws_ecr_lifecycle_policy_document.this
    values = {
      json = "{\"rules\":[]}"
    }
  }
}

variables {
  project = "aula-virtual"
}

run "database_security_group_is_in_the_network_vpc" {
  command = apply

  assert {
    condition     = module.database.security_group_vpc_id == module.network.vpc_id
    error_message = "The database security group must belong to the network VPC."
  }

  assert {
    condition     = module.database.security_group_tags["Name"] == "${var.project}-prod-db-sg"
    error_message = "The database security group must carry the Name tag <prefix>-db-sg."
  }

  assert {
    condition     = module.database.security_group_name_prefix == "${var.project}-prod-db-sg-"
    error_message = "The database security group must use name_prefix <prefix>-db-sg- so it can be replaced without a name clash."
  }
}

run "database_ingress_is_only_postgres_from_the_host_security_group" {
  command = apply

  assert {
    condition = (
      module.database.postgres_ingress_rule.ip_protocol == "tcp" &&
      module.database.postgres_ingress_rule.from_port == 5432 &&
      module.database.postgres_ingress_rule.to_port == 5432
    )
    error_message = "The ingress rule must be TCP 5432 on a single port."
  }

  assert {
    condition     = module.database.postgres_ingress_rule.referenced_security_group_id == module.host.security_group_id
    error_message = "The only ingress source must be the host security group."
  }

  assert {
    condition = (
      module.database.postgres_ingress_rule.cidr_ipv4 == null &&
      module.database.postgres_ingress_rule.cidr_ipv6 == null &&
      module.database.postgres_ingress_rule.prefix_list_id == null
    )
    error_message = "The database security group must have no CIDR or prefix list ingress."
  }

  assert {
    condition     = module.database.security_group_id != module.host.security_group_id
    error_message = "The database must have its own security group, not the host one."
  }
}

run "database_subnet_group_uses_the_private_subnets" {
  command = apply

  assert {
    condition     = module.database.subnet_group_name_prefix == "${var.project}-prod-db-subnets-"
    error_message = "The DB subnet group must use name_prefix <prefix>-db-subnets- so it can be replaced without a name clash."
  }

  assert {
    condition = (
      length(module.database.subnet_group_subnet_ids) >= 2 &&
      toset(module.database.subnet_group_subnet_ids) == toset(module.network.private_subnet_ids)
    )
    error_message = "The DB subnet group must use exactly the private subnets (at least two)."
  }
}

run "root_exposes_database_outputs" {
  command = apply

  assert {
    condition     = output.database_security_group_id == module.database.security_group_id && output.database_subnet_group_name == module.database.subnet_group_name
    error_message = "The root must expose the database security group id and subnet group name."
  }
}

run "database_module_declares_rules_only_through_the_audited_resource" {
  command = plan

  # Static guards (the var.project reference only satisfies the test framework's
  # requirement that a condition refer to configuration). Each assertion owns one
  # rule; the first one fails if the scan finds no files, so a wrong working
  # directory cannot make the others pass silently.
  assert {
    condition     = var.project != "" && length(fileset("../../modules/database", "*.tf")) > 0
    error_message = "The static scan found no .tf files in modules/database; check the relative path."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*resource[[:space:]]+\"aws_vpc_security_group_ingress_rule\"", file("../../modules/database/security_group.tf"))) == 1
    error_message = "security_group.tf must declare exactly one ingress rule resource."
  }

  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/database", "*.tf") : f
      if f != "security_group.tf" && can(regex("resource[[:space:]]+\"aws_vpc_security_group_ingress_rule\"", file("../../modules/database/${f}")))
    ]) == 0
    error_message = "The ingress rule may only be declared in modules/database/security_group.tf."
  }

  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/database", "*.tf") : f
      if can(regex("resource[[:space:]]+\"aws_vpc_security_group_egress_rule\"", file("../../modules/database/${f}")))
    ]) == 0
    error_message = "The database module must not declare egress rules (RDS initiates no connections)."
  }

  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/database", "*.tf") : f
      if can(regex("(?m)^[[:space:]]*(ingress|egress)[[:space:]]*[{]", file("../../modules/database/${f}"))) || can(regex("resource[[:space:]]+\"aws_security_group_rule\"", file("../../modules/database/${f}")))
    ]) == 0
    error_message = "No inline ingress/egress blocks or aws_security_group_rule resources are allowed in modules/database."
  }

  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/database", "*.tf") : f
      if f != "outputs.tf" && can(regex("(?m)^[[:space:]]*cidr_ipv[46][[:space:]]*=", file("../../modules/database/${f}")))
    ]) == 0
    error_message = "The database module must not set cidr_ipv4 or cidr_ipv6 on any resource (outputs only read them)."
  }
}

run "rejects_fewer_than_two_private_subnets" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    name_prefix                       = "aula-virtual-prod"
    vpc_id                            = "vpc-0123456789abcdef0"
    private_subnet_ids                = ["subnet-0123456789abcdef0"]
    private_subnet_availability_zones = ["us-east-2a"]
    host_security_group_id            = "sg-0123456789abcdef0"
  }

  expect_failures = [var.private_subnet_ids]
}

run "rejects_invalid_name_prefix" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    name_prefix                       = "Aula_Virtual"
    vpc_id                            = "vpc-0123456789abcdef0"
    private_subnet_ids                = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"]
    private_subnet_availability_zones = ["us-east-2a", "us-east-2b"]
    host_security_group_id            = "sg-0123456789abcdef0"
  }

  expect_failures = [var.name_prefix]
}

run "rejects_duplicate_availability_zones" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    name_prefix                       = "aula-virtual-prod"
    vpc_id                            = "vpc-0123456789abcdef0"
    private_subnet_ids                = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"]
    private_subnet_availability_zones = ["us-east-2a", "us-east-2a"]
    host_security_group_id            = "sg-0123456789abcdef0"
  }

  expect_failures = [var.private_subnet_availability_zones]
}

run "rejects_mismatched_availability_zone_count" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    name_prefix                       = "aula-virtual-prod"
    vpc_id                            = "vpc-0123456789abcdef0"
    private_subnet_ids                = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"]
    private_subnet_availability_zones = ["us-east-2a", "us-east-2b", "us-east-2c"]
    host_security_group_id            = "sg-0123456789abcdef0"
  }

  expect_failures = [var.private_subnet_availability_zones]
}
