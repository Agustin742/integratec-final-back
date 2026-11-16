output "environment" {
  description = "Name of the environment managed by this root."
  value       = local.environment
}

output "github_actions_role_arn" {
  description = "ARN of the role GitHub Actions assumes through OIDC (configure it in the workflow); null while enable_github_oidc is false."
  value       = one(aws_iam_role.github_actions[*].arn)
}

output "vpc_id" {
  description = "ID of the prod VPC."
  value       = module.network.vpc_id
}

output "vpc_cidr_block" {
  description = "IPv4 CIDR block of the prod VPC."
  value       = module.network.vpc_cidr_block
}

output "public_subnet_id" {
  description = "ID of the public subnet for the EC2 host."
  value       = module.network.public_subnet_id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets (one per availability zone) for the RDS subnet group."
  value       = module.network.private_subnet_ids
}

output "host_instance_id" {
  description = "ID of the EC2 host (target of SSM Session Manager and Run Command)."
  value       = module.host.instance_id
}

output "host_bootstrap_check_command" {
  description = "AWS CLI command that verifies the first-boot provisioning of the host (prints the done marker) through SSM Run Command."
  value       = module.host.bootstrap_check_command
}

output "host_public_ip" {
  description = "Elastic IP of the EC2 host."
  value       = module.host.public_ip
}

output "host_sslip_domain" {
  description = "Interim DNS name of the host: sslip.io resolves it to the Elastic IP, so Let's Encrypt can issue a certificate until a domain is chosen."
  value       = "${replace(module.host.public_ip, ".", "-")}.sslip.io"
}

output "host_security_group_id" {
  description = "ID of the EC2 host security group; the intended source for the RDS ingress rule added in #60."
  value       = module.host.security_group_id
}

output "database_security_group_id" {
  description = "ID of the database security group (PostgreSQL 5432 only from the EC2 host security group)."
  value       = module.database.security_group_id
}

output "database_subnet_group_name" {
  description = "Name of the DB subnet group (private subnets) the RDS instance is placed in."
  value       = module.database.subnet_group_name
}

output "database_endpoint" {
  description = "Connection endpoint (host:port) of the prod RDS PostgreSQL instance."
  value       = module.database.endpoint
}

output "database_port" {
  description = "Port of the prod RDS PostgreSQL instance."
  value       = module.database.port
}

output "database_name" {
  description = "Name of the initial database."
  value       = module.database.db_name
}

output "database_master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the RDS master credentials; the deployment reads it at runtime. Only the ARN is exposed, never the secret value."
  value       = module.database.master_user_secret_arn
}

output "ecr_repository_urls" {
  description = "ECR repository URL of each service (api, realtime); images are pushed and pulled here."
  value       = module.registry.repository_urls
}

output "ecr_repository_arns" {
  description = "ECR repository ARN of each service (api, realtime), for least-privilege IAM policies."
  value       = module.registry.repository_arns
}
