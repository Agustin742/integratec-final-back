mock_provider "aws" {}

run "host_security_group_is_in_the_network_vpc" {
  command = apply

  assert {
    condition     = module.host.security_group_vpc_id == module.network.vpc_id
    error_message = "The host security group must belong to the network VPC."
  }

  assert {
    condition     = module.host.security_group_name == "aula-virtual-prod-host-sg"
    error_message = "The host security group must be named <prefix>-host-sg."
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
