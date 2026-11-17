locals {
  # Single source of truth for the public ingress of the host. Anything not listed
  # here is closed, and there is deliberately no SSH (access is through SSM Session
  # Manager).
  ingress_rules = {
    https = {
      port        = 443
      description = "HTTPS and WSS from the internet (Caddy)"
    }
    http = {
      port        = 80
      description = "HTTP from the internet (redirect to HTTPS and ACME HTTP-01 challenge)"
    }
  }
}

# Security group of the EC2 host. It uses name_prefix with create_before_destroy so
# a change that forces replacement (for example a new description) builds the new
# group first: a fixed name would clash with the old group, and the old one cannot
# be deleted while the instance and RDS rules still reference it. The standalone
# rule resources below reference the group id, so they are recreated on the new
# group automatically.
resource "aws_security_group" "host" {
  name_prefix = "${var.name_prefix}-host-sg-"
  description = "EC2 host: public HTTP/HTTPS only, no SSH (access is through SSM Session Manager)"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-host-sg"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Rules are standalone resources (not inline blocks) so later issues can add rules
# without fighting this group. Ingress is the only ingress resource of the module.
resource "aws_vpc_security_group_ingress_rule" "this" {
  for_each = local.ingress_rules

  security_group_id = aws_security_group.host.id
  description       = each.value.description
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port

  lifecycle {
    create_before_destroy = true
  }
}

# All outbound IPv4 is allowed on purpose: the host must reach Let's Encrypt, ECR,
# the SSM endpoints, package repositories and the VPC DNS resolver, and there is no
# NAT or proxy to filter through. Ingress is what protects the host; a narrower
# egress list would only add ways for SSM, ECR or ACME to break. The VPC has no IPv6.
resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.host.id
  description       = "All outbound IPv4 (ACME, ECR, SSM, package repos, DNS)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"

  lifecycle {
    create_before_destroy = true
  }
}
