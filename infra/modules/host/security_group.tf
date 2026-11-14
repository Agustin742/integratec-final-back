# Security group of the EC2 host. Rules are standalone resources (not inline
# blocks) so other modules and later issues can add rules without fighting this one.
resource "aws_security_group" "host" {
  name        = "${var.name_prefix}-host-sg"
  description = "EC2 host: public HTTP/HTTPS only, no SSH (access is through SSM Session Manager)"
  vpc_id      = var.vpc_id

  tags = {
    Name = "${var.name_prefix}-host-sg"
  }
}

# HTTPS and WSS, terminated by Caddy.
resource "aws_vpc_security_group_ingress_rule" "https" {
  security_group_id = aws_security_group.host.id
  description       = "HTTPS and WSS from the internet (Caddy)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# HTTP is needed for the redirect to HTTPS and the Let's Encrypt HTTP-01 challenge.
resource "aws_vpc_security_group_ingress_rule" "http" {
  security_group_id = aws_security_group.host.id
  description       = "HTTP from the internet (redirect to HTTPS and ACME HTTP-01 challenge)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
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
}
