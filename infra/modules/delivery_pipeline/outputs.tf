output "connection_arn" {
  description = "ARN of the CodeConnections GitHub connection; the pipeline source action references it."
  value       = aws_codeconnections_connection.this.arn
}

output "connection_status" {
  description = "Status of the GitHub connection: PENDING until the console handshake is completed, then AVAILABLE."
  value       = aws_codeconnections_connection.this.connection_status
}

output "connection_settings" {
  description = "Name and provider type of the connection, for tests and review."
  value = {
    name          = aws_codeconnections_connection.this.name
    provider_type = aws_codeconnections_connection.this.provider_type
  }
}

output "artifact_bucket_name" {
  description = "Name of the pipeline artifact bucket."
  value       = aws_s3_bucket.artifacts.id
}

output "artifact_bucket_arn" {
  description = "ARN of the pipeline artifact bucket; object access policies use \"<arn>/*\"."
  value       = aws_s3_bucket.artifacts.arn
}

output "artifact_bucket_settings" {
  description = "Naming, deletion, ownership and encryption settings of the artifact bucket, for tests and review."
  value = {
    bucket_prefix    = aws_s3_bucket.artifacts.bucket_prefix
    force_destroy    = aws_s3_bucket.artifacts.force_destroy
    object_ownership = one(aws_s3_bucket_ownership_controls.artifacts.rule).object_ownership
    sse_algorithm    = one(one(aws_s3_bucket_server_side_encryption_configuration.artifacts.rule).apply_server_side_encryption_by_default).sse_algorithm
  }
}

output "public_access_block" {
  description = "Public access block settings of the artifact bucket, for tests and review."
  value = {
    block_public_acls       = aws_s3_bucket_public_access_block.artifacts.block_public_acls
    block_public_policy     = aws_s3_bucket_public_access_block.artifacts.block_public_policy
    ignore_public_acls      = aws_s3_bucket_public_access_block.artifacts.ignore_public_acls
    restrict_public_buckets = aws_s3_bucket_public_access_block.artifacts.restrict_public_buckets
  }
}

output "lifecycle_rules" {
  description = "Id, status and retention days of the lifecycle rule as configured on the resource, for tests and review."
  value = {
    id                                     = one(aws_s3_bucket_lifecycle_configuration.artifacts.rule[*].id)
    status                                 = one(aws_s3_bucket_lifecycle_configuration.artifacts.rule[*].status)
    expiration_days                        = one(flatten(aws_s3_bucket_lifecycle_configuration.artifacts.rule[*].expiration[*].days))
    noncurrent_version_expiration_days     = one(flatten(aws_s3_bucket_lifecycle_configuration.artifacts.rule[*].noncurrent_version_expiration[*].noncurrent_days))
    abort_incomplete_multipart_upload_days = one(flatten(aws_s3_bucket_lifecycle_configuration.artifacts.rule[*].abort_incomplete_multipart_upload[*].days_after_initiation))
  }
}

output "bucket_policy_statements" {
  description = "Statements of the policy attached to the artifact bucket, decoded from the resource, for tests and review."
  value       = jsondecode(aws_s3_bucket_policy.artifacts.policy).Statement
}

output "log_group_name" {
  description = "Name of the CloudWatch log group the CodeBuild projects write to."
  value       = aws_cloudwatch_log_group.codebuild.name
}

output "log_group_arn" {
  description = "ARN of the CodeBuild log group; CodeBuild role policies scope log writes to \"<arn>:*\"."
  value       = aws_cloudwatch_log_group.codebuild.arn
}

output "log_group_settings" {
  description = "Name and retention of the CodeBuild log group, for tests and review."
  value = {
    name              = aws_cloudwatch_log_group.codebuild.name
    retention_in_days = aws_cloudwatch_log_group.codebuild.retention_in_days
  }
}
