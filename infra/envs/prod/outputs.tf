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

output "host_security_group_id" {
  description = "ID of the EC2 host security group; the intended source for the RDS ingress rule added in #60."
  value       = module.host.security_group_id
}
