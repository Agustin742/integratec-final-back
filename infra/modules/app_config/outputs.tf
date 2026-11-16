output "secret_arns" {
  description = "ARN of each generated secret, keyed by the env var it feeds. Only ARNs are exposed, never values."
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}

output "secret_names" {
  description = "Name of each generated secret, keyed by the env var it feeds."
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.name }
}

output "service_secret_arns" {
  description = "Secret ARNs each service may read, keyed by service then env var (realtime only gets INTERNAL_SERVICE_SECRET); the instance role policy is built from it."
  value = {
    for service in distinct(flatten([for s in local.secrets : s.services])) : service => {
      for k, s in local.secrets : k => aws_secretsmanager_secret.this[k].arn if contains(s.services, service)
    }
  }
}

output "parameter_path_prefixes" {
  description = "SSM parameter path prefix of each service, keyed by service name (the host reads everything under it)."
  value       = local.path_prefixes
}

output "parameter_arns" {
  description = "ARNs of the config parameters of each service, keyed by service name, for least-privilege IAM policies."
  value = {
    for service in keys(local.config) : service => [
      for k, p in aws_ssm_parameter.this : p.arn if local.parameters[k].service == service
    ]
  }
}

output "parameters" {
  description = "Name, type and value of each non-secret config parameter, keyed by <service>/<ENV_NAME>, for tests and review."
  value       = { for k, p in aws_ssm_parameter.this : k => { name = p.name, type = p.type, value = p.value } }
}

output "secret_settings" {
  description = "Description and recovery window of each secret, for tests and review."
  value       = { for k, s in aws_secretsmanager_secret.this : k => { description = s.description, recovery_window_in_days = s.recovery_window_in_days } }
}
