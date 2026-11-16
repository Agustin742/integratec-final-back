output "bucket_name" {
  description = "Name of the files bucket; published to the API as S3_BUCKET."
  value       = aws_s3_bucket.this.id
}

output "bucket_arn" {
  description = "ARN of the files bucket; object access policies use \"<arn>/*\"."
  value       = aws_s3_bucket.this.arn
}

output "bucket_settings" {
  description = "Naming, deletion, ownership, encryption and versioning settings of the bucket, for tests and review."
  value = {
    bucket_prefix     = aws_s3_bucket.this.bucket_prefix
    force_destroy     = aws_s3_bucket.this.force_destroy
    object_ownership  = one(aws_s3_bucket_ownership_controls.this.rule).object_ownership
    sse_algorithm     = one(one(aws_s3_bucket_server_side_encryption_configuration.this.rule).apply_server_side_encryption_by_default).sse_algorithm
    versioning_status = one(aws_s3_bucket_versioning.this.versioning_configuration).status
  }
}

output "public_access_block" {
  description = "Public access block settings of the bucket, for tests and review."
  value = {
    block_public_acls       = aws_s3_bucket_public_access_block.this.block_public_acls
    block_public_policy     = aws_s3_bucket_public_access_block.this.block_public_policy
    ignore_public_acls      = aws_s3_bucket_public_access_block.this.ignore_public_acls
    restrict_public_buckets = aws_s3_bucket_public_access_block.this.restrict_public_buckets
  }
}

output "lifecycle_rules" {
  description = "Retention settings of the lifecycle rule, built from the same inputs as the resource, for tests and review."
  value = {
    noncurrent_version_expiration_days     = var.noncurrent_version_expiration_days
    abort_incomplete_multipart_upload_days = local.abort_incomplete_multipart_upload_days
  }
}

output "bucket_policy_statements" {
  description = "Statements of the bucket policy, built from the same locals as the policy document, for tests and review."
  value       = local.bucket_policy_statements
}
