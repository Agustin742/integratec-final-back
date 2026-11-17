# Runtime permissions of the host, attached inline to the instance role created in
# modules/host. Built with jsonencode so the statements can be asserted in tests.
#
# KMS: no kms:* statement. The app secrets (modules/app_config) and the RDS master
# secret use the AWS managed key aws/secretsmanager, whose key policy lets any
# principal that may call Secrets Manager use it. If a customer managed key is ever
# added, grant kms:Decrypt on that key here.
locals {
  runtime_policy_statements = [
    {
      # ecr:GetAuthorizationToken does not support resource-level permissions: AWS
      # only accepts "*" here. Kept alone so every other statement stays scoped.
      Sid      = "EcrAuthToken"
      Effect   = "Allow"
      Action   = "ecr:GetAuthorizationToken"
      Resource = "*"
    },
    {
      Sid    = "EcrPull"
      Effect = "Allow"
      Action = [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability",
      ]
      Resource = values(var.ecr_repository_arns)
    },
    {
      Sid      = "ReadAppSecrets"
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = var.secret_arns
    },
    {
      Sid      = "ReadAppConfig"
      Effect   = "Allow"
      Action   = "ssm:GetParameters"
      Resource = var.ssm_parameter_arns
    },
    {
      # Authorization of GetParametersByPath is checked against the path itself and
      # the parameters under it, so both forms of each config path are listed.
      Sid    = "ReadAppConfigByPath"
      Effect = "Allow"
      Action = "ssm:GetParametersByPath"
      Resource = concat(
        var.ssm_parameter_path_arns,
        [for arn in var.ssm_parameter_path_arns : "${arn}/*"],
      )
    },
    {
      # No s3:ListBucket: the API reads and writes known keys.
      Sid    = "FilesBucketObjects"
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
      ]
      Resource = "${var.s3_bucket_arn}/*"
    },
    {
      # Since AWS provider v4 the log group arn has no ":*" suffix, but log stream
      # permissions apply to "<group arn>:*".
      Sid    = "WriteServiceLogs"
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]
      Resource = [for g in aws_cloudwatch_log_group.this : "${g.arn}:*"]
    },
  ]
}

resource "aws_iam_role_policy" "runtime" {
  name = "${var.name_prefix}-host-runtime"
  role = var.role_name

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.runtime_policy_statements
  })
}
