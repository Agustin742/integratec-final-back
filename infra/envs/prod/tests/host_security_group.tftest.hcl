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

run "host_security_group_is_in_the_network_vpc" {
  command = apply

  assert {
    condition     = module.host.security_group_vpc_id == module.network.vpc_id
    error_message = "The host security group must belong to the network VPC."
  }

  assert {
    condition     = module.host.security_group_tags["Name"] == "${var.project}-prod-host-sg"
    error_message = "The host security group must carry the Name tag <prefix>-host-sg."
  }

  assert {
    condition     = module.host.security_group_name_prefix == "${var.project}-prod-host-sg-"
    error_message = "The host security group must use name_prefix <prefix>-host-sg- so it can be replaced without a name clash."
  }
}

run "host_ingress_is_only_http_and_https_from_anywhere" {
  command = apply

  assert {
    condition = (
      length(module.host.ingress_rules) == 2 &&
      toset([for r in module.host.ingress_rules : r.from_port]) == toset([80, 443]) &&
      alltrue([for r in module.host.ingress_rules : r.from_port == r.to_port])
    )
    error_message = "Ingress must be exactly TCP 80 and TCP 443, one single port each."
  }

  assert {
    condition = alltrue([
      for r in module.host.ingress_rules : r.ip_protocol == "tcp" && r.cidr_ipv4 == "0.0.0.0/0"
    ])
    error_message = "Ingress rules must be TCP from 0.0.0.0/0 only."
  }
}

run "host_ingress_never_opens_ssh_or_all_protocols" {
  command = apply

  assert {
    condition = alltrue([
      for r in module.host.ingress_rules : !(r.from_port <= 22 && r.to_port >= 22) && r.ip_protocol != "-1"
    ])
    error_message = "No ingress rule may cover port 22 or allow all protocols."
  }

  assert {
    condition     = alltrue([for r in module.host.ingress_rules : r.cidr_ipv6 == null])
    error_message = "The VPC has no IPv6, so no IPv6 ingress is allowed."
  }
}

run "host_egress_allows_all_outbound_ipv4" {
  command = apply

  assert {
    condition = (
      length(module.host.egress_rules) == 1 &&
      alltrue([for r in module.host.egress_rules : r.ip_protocol == "-1" && r.cidr_ipv4 == "0.0.0.0/0"])
    )
    error_message = "Egress must be a single allow-all IPv4 rule."
  }
}

run "host_module_declares_rules_only_through_the_audited_resources" {
  command = plan

  # Static guard (the var.project reference only satisfies the test framework's
  # requirement that a condition refer to configuration): every ingress rule must come from the single for_each resource in
  # security_group.tf, so the 80/443-only guarantee cannot be bypassed from another
  # file, an inline block or the legacy aws_security_group_rule resource.
  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/host", "*.tf") : f
      if f != "security_group.tf" && can(regex("resource[[:space:]]+\"aws_vpc_security_group_(ingress|egress)_rule\"", file("../../modules/host/${f}")))
    ]) == 0
    error_message = "Security group rules may only be declared in modules/host/security_group.tf."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*resource[[:space:]]+\"aws_vpc_security_group_ingress_rule\"", file("../../modules/host/security_group.tf"))) == 1 && length(regexall("(?m)^[[:space:]]*resource[[:space:]]+\"aws_vpc_security_group_egress_rule\"", file("../../modules/host/security_group.tf"))) == 1
    error_message = "security_group.tf must declare exactly one ingress rule resource and one egress rule resource."
  }

  assert {
    condition = var.project != "" && length([
      for f in fileset("../../modules/host", "*.tf") : f
      if can(regex("(?m)^[[:space:]]*(ingress|egress)[[:space:]]*[{]", file("../../modules/host/${f}"))) || can(regex("resource[[:space:]]+\"aws_security_group_rule\"", file("../../modules/host/${f}")))
    ]) == 0
    error_message = "No inline ingress/egress blocks or aws_security_group_rule resources are allowed in modules/host."
  }
}

run "rejects_uppercase_project" {
  command = plan
  variables {
    project = "Aula-Virtual"
  }
  expect_failures = [var.project]
}

run "rejects_project_with_leading_digit" {
  command = plan
  variables {
    project = "1aula-virtual"
  }
  expect_failures = [var.project]
}

run "rejects_project_with_trailing_hyphen" {
  command = plan
  variables {
    project = "aula-virtual-"
  }
  expect_failures = [var.project]
}

run "rejects_project_that_is_too_long" {
  command = plan
  variables {
    project = "aula-virtual-aula-virtual-aula-virtual"
  }
  expect_failures = [var.project]
}
