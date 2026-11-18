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
  value       = local.host_sslip_domain
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
  description = "ECR repository URL of each service, keyed by service name; images are pushed and pulled here."
  value       = module.registry.repository_urls
}

output "ecr_repository_arns" {
  description = "ECR repository ARN of each service, keyed by service name, for least-privilege IAM policies."
  value       = module.registry.repository_arns
}

output "app_secret_arns" {
  description = "ARN of each generated application secret, keyed by env var name. Only ARNs are exposed, never values."
  value       = module.app_config.secret_arns
}

output "app_service_secret_arns" {
  description = "Secret ARNs each service may read, keyed by service then env var (realtime only gets INTERNAL_SERVICE_SECRET)."
  value       = module.app_config.service_secret_arns
}

output "app_config_parameter_path_prefixes" {
  description = "SSM path prefix of the non-secret config of each service, keyed by service name."
  value       = module.app_config.parameter_path_prefixes
}

output "app_config_parameter_arns" {
  description = "ARNs of the SSM config parameters of each service, keyed by service name, for least-privilege IAM policies."
  value       = module.app_config.parameter_arns
}

output "log_group_names" {
  description = "CloudWatch log group of each container (api, realtime, caddy), keyed by service; the Compose awslogs-group option uses them."
  value       = module.runtime_access.log_group_names
}

output "storage_bucket_name" {
  description = "Name of the private S3 bucket for application files (student submissions and materials); also published to the API as S3_BUCKET."
  value       = module.storage.bucket_name
}

output "storage_bucket_arn" {
  description = "ARN of the application files bucket; grant object access on \"<arn>/*\"."
  value       = module.storage.bucket_arn
}

output "frontend_amplify_app_id" {
  description = "ID of the Amplify Hosting app of the frontend."
  value       = module.frontend_hosting.app_id
}

output "frontend_default_domain" {
  description = "Default Amplify domain of the frontend app."
  value       = module.frontend_hosting.default_domain
}

output "frontend_branch_url" {
  description = "HTTPS URL of the deployed frontend branch (https://<branch>.<default domain>); the origin to allow in allowed_origins."
  value       = module.frontend_hosting.branch_url
}

output "pipeline_connection_arn" {
  description = "ARN of the CodeConnections GitHub connection used as the pipeline source; authorize it once in the console while its status is PENDING."
  value       = module.delivery_pipeline.connection_arn
}

output "pipeline_connection_status" {
  description = "Status of the GitHub connection (PENDING until the console handshake is done, then AVAILABLE)."
  value       = module.delivery_pipeline.connection_status
}

output "pipeline_artifact_bucket_name" {
  description = "Name of the private S3 bucket that holds CodePipeline artifacts."
  value       = module.delivery_pipeline.artifact_bucket_name
}

output "pipeline_log_group_name" {
  description = "Name of the CloudWatch log group of the CodeBuild projects."
  value       = module.delivery_pipeline.log_group_name
}

output "pipeline_terraform_plan_project_name" {
  description = "Name of the CodeBuild project that runs terraform plan."
  value       = module.delivery_pipeline.terraform_plan_project_name
}

output "pipeline_terraform_apply_project_name" {
  description = "Name of the CodeBuild project that applies the approved saved plan."
  value       = module.delivery_pipeline.terraform_apply_project_name
}

output "pipeline_terraform_plan_role_arn" {
  description = "ARN of the read-only service role of the terraform plan project."
  value       = module.delivery_pipeline.terraform_plan_role_arn
}

output "pipeline_terraform_apply_role_arn" {
  description = "ARN of the broad service role of the terraform apply project (D19 trade-off: gated by the manual approval)."
  value       = module.delivery_pipeline.terraform_apply_role_arn
}

output "pipeline_images_project_name" {
  description = "Name of the CodeBuild project that builds the release images and pushes them to ECR."
  value       = module.delivery_pipeline.images_project_name
}

output "pipeline_images_role_arn" {
  description = "ARN of the service role of the images project (push access to the three image repositories only)."
  value       = module.delivery_pipeline.images_role_arn
}
