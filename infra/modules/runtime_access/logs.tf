# One log group per container, written by the Docker awslogs driver on the host
# (rules/aws-infrastructure.md: explicit retention). Groups are created here, so
# the instance role does not need logs:CreateLogGroup.
resource "aws_cloudwatch_log_group" "this" {
  for_each = var.log_services

  name              = "/${var.name_prefix}/${each.key}"
  retention_in_days = var.retention_in_days

  tags = {
    Name = "/${var.name_prefix}/${each.key}"
  }
}
