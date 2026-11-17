output "role_policy_name" {
  description = "Name of the inline runtime policy attached to the host role."
  value       = aws_iam_role_policy.runtime.name
}

output "role_policy_role" {
  description = "Role the runtime policy is attached to, for tests and review."
  value       = aws_iam_role_policy.runtime.role
}

output "policy_statements" {
  description = "Statements of the attached runtime policy keyed by Sid, decoded from the resource, for tests and review."
  value       = { for s in jsondecode(aws_iam_role_policy.runtime.policy).Statement : s.Sid => s }
}

output "log_group_names" {
  description = "Name of each CloudWatch log group, keyed by service; the Compose awslogs-group option uses them."
  value       = { for k, g in aws_cloudwatch_log_group.this : k => g.name }
}

output "log_group_arns" {
  description = "ARN of each CloudWatch log group (without the :* suffix), keyed by service."
  value       = { for k, g in aws_cloudwatch_log_group.this : k => g.arn }
}

output "log_group_settings" {
  description = "Retention of each log group as configured on the resource, keyed by service, for tests and review."
  value       = { for k, g in aws_cloudwatch_log_group.this : k => { retention_in_days = g.retention_in_days } }
}
