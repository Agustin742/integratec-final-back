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
