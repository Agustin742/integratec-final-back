output "state_bucket_name" {
  description = "Name of the S3 bucket that stores Terraform state; pass it to each environment backend."
  value       = aws_s3_bucket.state.bucket
}
