# Private bucket where CodePipeline passes the source and the plan between stages.
# Bucket names are global, so bucket_prefix lets AWS append a unique suffix.
# Artifacts are disposable (each run rebuilds them from Git), so the bucket has no
# prevent_destroy; force_destroy stays false so that a destroy never silently drops
# objects: the lifecycle rule below empties it on its own within the expiry window.
# Versioning is deliberately off: artifact keys are unique per pipeline execution and
# never overwritten, and CodePipeline requires versioning only for an S3 source.
resource "aws_s3_bucket" "artifacts" {
  bucket_prefix = "${var.name_prefix}-pipeline-artifacts-"
  force_destroy = false

  tags = {
    Name = "${var.name_prefix}-pipeline-artifacts"
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ACLs are disabled; access is governed by IAM and the bucket policy only.
resource "aws_s3_bucket_ownership_controls" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# SSE-S3 keeps encryption at rest free of KMS request costs and key management; no
# customer-managed key, as in the rest of the repository.
resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

locals {
  abort_incomplete_multipart_upload_days = 7

  # Deny every request that does not use TLS, for all principals, on the bucket and
  # its objects. Built with jsonencode so the statements can be asserted in tests.
  artifacts_bucket_policy_statements = [
    {
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    },
  ]
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.artifacts_bucket_policy_statements
  })

  # Applying a policy while the public access block is changing can fail with a conflict.
  depends_on = [aws_s3_bucket_public_access_block.artifacts]
}

# Artifacts older than var.artifact_expiration_days are removed so storage cost stays
# bounded. Noncurrent versions are covered in case versioning is ever enabled. Abandoned
# multipart uploads are billed but invisible in listings, so they are aborted after a week.
resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-artifacts"
    status = "Enabled"

    filter {}

    expiration {
      days = var.artifact_expiration_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.artifact_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = local.abort_incomplete_multipart_upload_days
    }
  }
}
