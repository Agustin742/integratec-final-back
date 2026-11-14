output "security_group_id" {
  description = "ID of the host security group (RDS allows 5432 only from it)."
  value       = aws_security_group.host.id
}

output "security_group_name" {
  description = "Name of the host security group."
  value       = aws_security_group.host.name
}

output "security_group_vpc_id" {
  description = "ID of the VPC the host security group belongs to."
  value       = aws_security_group.host.vpc_id
}

output "ingress_rules" {
  description = "Ingress rules of the host security group (protocol, ports and source), for tests and review."
  value = [
    for r in [aws_vpc_security_group_ingress_rule.https, aws_vpc_security_group_ingress_rule.http] : {
      ip_protocol = r.ip_protocol
      from_port   = r.from_port
      to_port     = r.to_port
      cidr_ipv4   = r.cidr_ipv4
      cidr_ipv6   = r.cidr_ipv6
    }
  ]
}

output "egress_rules" {
  description = "Egress rules of the host security group (protocol and destination), for tests and review."
  value = [
    for r in [aws_vpc_security_group_egress_rule.all] : {
      ip_protocol = r.ip_protocol
      cidr_ipv4   = r.cidr_ipv4
    }
  ]
}
