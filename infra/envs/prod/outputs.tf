output "environment" {
  description = "Name of the environment managed by this root."
  value       = local.environment
}

output "github_actions_role_arn" {
  description = "ARN of the role GitHub Actions assumes through OIDC (configure it in the workflow); null while enable_github_oidc is false."
  value       = one(aws_iam_role.github_actions[*].arn)
}
