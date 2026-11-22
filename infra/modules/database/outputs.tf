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

output "identifier" {
  description = "Identifier of the RDS instance; the CloudWatch DBInstanceIdentifier dimension and the RDS event source."
  value       = aws_db_instance.this.identifier
}

output "endpoint" {
  description = "Connection endpoint of the instance (host:port)."
  value       = aws_db_instance.this.endpoint
}

output "address" {
  description = "DNS address (host) of the instance."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "Port the instance listens on."
  value       = aws_db_instance.this.port
}

output "db_name" {
  description = "Name of the initial database."
  value       = aws_db_instance.this.db_name
}

output "master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret RDS manages for the master user. Only the pointer is exposed, never its value."
  value       = one(aws_db_instance.this.master_user_secret[*].secret_arn)
}

output "instance_settings" {
  description = "Non-secret instance settings as declared, for tests and review."
  value = {
    identifier                  = aws_db_instance.this.identifier
    engine                      = aws_db_instance.this.engine
    engine_version              = aws_db_instance.this.engine_version
    instance_class              = aws_db_instance.this.instance_class
    allocated_storage           = aws_db_instance.this.allocated_storage
    storage_type                = aws_db_instance.this.storage_type
    storage_encrypted           = aws_db_instance.this.storage_encrypted
    multi_az                    = aws_db_instance.this.multi_az
    publicly_accessible         = aws_db_instance.this.publicly_accessible
    manage_master_user_password = aws_db_instance.this.manage_master_user_password
    backup_retention_period     = aws_db_instance.this.backup_retention_period
    deletion_protection         = aws_db_instance.this.deletion_protection
    skip_final_snapshot         = aws_db_instance.this.skip_final_snapshot
    final_snapshot_identifier   = aws_db_instance.this.final_snapshot_identifier
    apply_immediately           = aws_db_instance.this.apply_immediately
    db_subnet_group_name        = aws_db_instance.this.db_subnet_group_name
    vpc_security_group_ids      = tolist(aws_db_instance.this.vpc_security_group_ids)
  }
}
