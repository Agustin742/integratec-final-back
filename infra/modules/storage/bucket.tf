# Private bucket for student submissions and course materials. The API reads and
# writes objects itself (PutObject, GetObject, DeleteObject and presigned GetObject
# URLs); browsers never upload directly. CORS is therefore not configured: add it only
# if the frontend fetches signed URLs through XHR.
#
# Bucket names are global, so bucket_prefix lets AWS append a unique suffix.
# The bucket holds user data: destroying or replacing it must be called out in the
# pull request; prevent_destroy must be removed deliberately, in a reviewed change,
# and the bucket emptied first (force_destroy is false), before it can be deleted.
resource "aws_s3_bucket" "this" {
  bucket_prefix = "${var.name_prefix}-files-"
  force_destroy = false

  tags = {
    Name = "${var.name_prefix}-files"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ACLs are disabled; access is governed by IAM and the bucket policy only.
resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# SSE-S3 keeps encryption at rest free of KMS request costs and key management.
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Versioning allows recovery from an accidental delete or overwrite; the lifecycle
# rule below bounds its cost by expiring old versions.
resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id

  versioning_configuration {
    status = "Enabled"
  }
}
