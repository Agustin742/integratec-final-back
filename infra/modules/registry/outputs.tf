output "repository_urls" {
  description = "Repository URL of each service, keyed by service name."
  value       = { for k, r in aws_ecr_repository.this : k => r.repository_url }
}

output "repository_arns" {
  description = "Repository ARN of each service, keyed by service name (for least-privilege IAM policies)."
  value       = { for k, r in aws_ecr_repository.this : k => r.arn }
}

output "repository_names" {
  description = "Repository name of each service, keyed by service name."
  value       = { for k, r in aws_ecr_repository.this : k => r.name }
}

output "repository_settings" {
  description = "Tag mutability, scanning, encryption and deletion settings of each repository, for tests and review."
  value = { for k, r in aws_ecr_repository.this : k => {
    image_tag_mutability = r.image_tag_mutability
    scan_on_push         = r.image_scanning_configuration[0].scan_on_push
    encryption_type      = r.encryption_configuration[0].encryption_type
    force_delete         = r.force_delete
  } }
}

output "lifecycle_policies" {
  description = "Lifecycle policy JSON attached to each repository, keyed by service name."
  value       = { for k, p in aws_ecr_lifecycle_policy.this : k => p.policy }
}

output "lifecycle_rules" {
  description = "Settings of each lifecycle rule (priority, tag selection, count), built from the same locals as the policy document, for tests and review."
  value       = local.lifecycle_rules
}
