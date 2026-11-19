# Log group of the CodeBuild projects (rules/aws-infrastructure.md: explicit retention).
# It is created here so the CodeBuild roles do not need logs:CreateLogGroup.
resource "aws_cloudwatch_log_group" "codebuild" {
  name              = "/${var.name_prefix}/codebuild"
  retention_in_days = var.retention_in_days

  tags = {
    Name = "/${var.name_prefix}/codebuild"
  }
}
