output "security_group_id" {
  description = "ID of the database security group."
  value       = aws_security_group.database.id
}

output "security_group_name_prefix" {
  description = "Name prefix of the database security group."
  value       = aws_security_group.database.name_prefix
}

output "security_group_tags" {
  description = "Tags set on the database security group."
  value       = aws_security_group.database.tags
}

output "security_group_vpc_id" {
  description = "ID of the VPC the database security group belongs to."
  value       = aws_security_group.database.vpc_id
}

output "ingress_rules" {
  description = "Ingress rules of the database security group (protocol, ports and source), derived from the single ingress rule resource, for tests and review."
  value = [
    for r in [aws_vpc_security_group_ingress_rule.postgres_from_host] : {
      ip_protocol                  = r.ip_protocol
      from_port                    = r.from_port
      to_port                      = r.to_port
      referenced_security_group_id = r.referenced_security_group_id
      cidr_ipv4                    = r.cidr_ipv4
      cidr_ipv6                    = r.cidr_ipv6
      prefix_list_id               = r.prefix_list_id
    }
  ]
}

output "subnet_group_name" {
  description = "Name of the DB subnet group the database instance is placed in."
  value       = aws_db_subnet_group.this.name
}

output "subnet_group_subnet_ids" {
  description = "Subnet IDs of the DB subnet group."
  value       = aws_db_subnet_group.this.subnet_ids
}
