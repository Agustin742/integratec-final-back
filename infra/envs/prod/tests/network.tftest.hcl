mock_provider "aws" {}

run "vpc_has_dns_support_and_hostnames" {
  command = apply

  assert {
    condition     = module.network.vpc_cidr_block == "10.0.0.0/16"
    error_message = "The VPC must default to 10.0.0.0/16."
  }

  assert {
    condition     = module.network.vpc_enable_dns_support && module.network.vpc_enable_dns_hostnames
    error_message = "The VPC must enable DNS support and DNS hostnames (RDS needs them)."
  }
}

run "private_subnets_span_two_availability_zones" {
  command = apply

  assert {
    condition     = length(module.network.private_subnet_ids) >= 2
    error_message = "At least two private subnets are required for the RDS subnet group."
  }

  assert {
    condition     = length(toset(module.network.private_subnet_availability_zones)) >= 2
    error_message = "Private subnets must be in at least two distinct availability zones."
  }
}

run "public_subnet_routes_to_internet_gateway" {
  command = apply

  assert {
    condition     = length(module.network.public_route_table_routes) == 1
    error_message = "The public route table must hold exactly one route."
  }

  assert {
    condition = (
      one(module.network.public_route_table_routes).cidr_block == "0.0.0.0/0" &&
      one(module.network.public_route_table_routes).gateway_id == module.network.internet_gateway_id
    )
    error_message = "The public route table must send 0.0.0.0/0 to the internet gateway."
  }

  assert {
    condition     = module.network.public_subnet_route_table_id == module.network.public_route_table_id
    error_message = "The public subnet must be associated with the public route table."
  }
}

run "private_subnets_have_no_internet_route" {
  command = apply

  assert {
    condition     = length(module.network.private_route_table_routes) == 0
    error_message = "The private route table must have no routes beyond the VPC-local one."
  }

  assert {
    condition     = alltrue([for rt in module.network.private_subnet_route_table_ids : rt == module.network.private_route_table_id])
    error_message = "Every private subnet must use the private route table, never the public one."
  }

  assert {
    condition     = module.network.private_route_table_id != module.network.public_route_table_id
    error_message = "Private and public subnets must use different route tables."
  }
}

run "network_module_declares_no_nat_gateway" {
  command = plan

  assert {
    condition     = !can(regex("resource[[:space:]]+\"aws_nat_gateway\"", file("${path.root}/../../modules/network/main.tf")))
    error_message = "No NAT gateway is allowed (cost decision)."
  }
}

run "private_subnets_land_exactly_in_the_given_availability_zones" {
  command = apply

  variables {
    availability_zones = ["us-east-2b", "us-east-2c"]
  }

  assert {
    condition     = module.network.private_subnet_availability_zones == ["us-east-2b", "us-east-2c"]
    error_message = "Private subnets must land exactly in the listed availability zones, in order."
  }

  assert {
    condition     = module.network.public_subnet_availability_zone == "us-east-2b"
    error_message = "The public subnet must be in the first listed availability zone."
  }
}

run "defaults_pin_us_east_2a_and_2b" {
  command = apply

  assert {
    condition     = module.network.private_subnet_availability_zones == ["us-east-2a", "us-east-2b"]
    error_message = "The default availability zones must be us-east-2a and us-east-2b."
  }
}

run "rejects_non_ipv4_vpc_cidr" {
  command = plan

  variables {
    vpc_cidr = "not-a-cidr"
  }

  expect_failures = [var.vpc_cidr]
}

run "rejects_vpc_cidr_with_wrong_prefix_length" {
  command = plan

  variables {
    vpc_cidr = "10.0.0.0/24"
  }

  expect_failures = [var.vpc_cidr]
}

run "rejects_non_canonical_vpc_cidr" {
  command = plan

  variables {
    vpc_cidr = "10.0.0.1/16"
  }

  expect_failures = [var.vpc_cidr]
}

run "rejects_ipv6_vpc_cidr" {
  command = plan

  variables {
    vpc_cidr = "2001:db8::/16"
  }

  expect_failures = [var.vpc_cidr]
}

run "rejects_single_availability_zone" {
  command = plan

  variables {
    availability_zones = ["us-east-2a"]
  }

  expect_failures = [var.availability_zones]
}

run "rejects_duplicate_availability_zones" {
  command = plan

  variables {
    availability_zones = ["us-east-2a", "us-east-2a"]
  }

  expect_failures = [var.availability_zones]
}
