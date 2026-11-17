locals {
  # Deny every request that does not use TLS, for all principals, on the bucket and
  # its objects. Built with jsonencode so the statements can be asserted in tests.
  bucket_policy_statements = [
    {
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.this.arn, "${aws_s3_bucket.this.arn}/*"]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    },
  ]
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.bucket_policy_statements
  })

  # Applying a policy while the public access block is changing can fail with a conflict.
  depends_on = [aws_s3_bucket_public_access_block.this]
}
