locals {
  abort_incomplete_multipart_upload_days = 7
}

# Noncurrent versions (what versioning keeps after an overwrite or delete) expire after
# var.noncurrent_version_expiration_days, so recovery stays possible for a month while
# storage cost is bounded. Abandoned multipart uploads are billed but invisible in
# listings, so they are aborted after a week. Current objects never expire.
resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = local.abort_incomplete_multipart_upload_days
    }
  }

  # Lifecycle rules require versioning to be configured first.
  depends_on = [aws_s3_bucket_versioning.this]
}
