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

output "postgres_ingress_rule" {
  description = "The PostgreSQL ingress rule (protocol, ports and source) as declared, for tests and review. Not a listing of every rule on the group; a static test guards that this is the only one."
  value = {
    ip_protocol                  = aws_vpc_security_group_ingress_rule.postgres_from_host.ip_protocol
    from_port                    = aws_vpc_security_group_ingress_rule.postgres_from_host.from_port
    to_port                      = aws_vpc_security_group_ingress_rule.postgres_from_host.to_port
    referenced_security_group_id = aws_vpc_security_group_ingress_rule.postgres_from_host.referenced_security_group_id
    cidr_ipv4                    = aws_vpc_security_group_ingress_rule.postgres_from_host.cidr_ipv4
    cidr_ipv6                    = aws_vpc_security_group_ingress_rule.postgres_from_host.cidr_ipv6
    prefix_list_id               = aws_vpc_security_group_ingress_rule.postgres_from_host.prefix_list_id
  }
}

output "subnet_group_name_prefix" {
  description = "Name prefix of the DB subnet group."
  value       = aws_db_subnet_group.this.name_prefix
}

output "subnet_group_name" {
  description = "Name of the DB subnet group the database instance is placed in."
  value       = aws_db_subnet_group.this.name
}

output "subnet_group_subnet_ids" {
  description = "Subnet IDs of the DB subnet group."
  value       = aws_db_subnet_group.this.subnet_ids
}
