# Service role of the deploy project (decision D19): assumable only by CodeBuild on behalf of
# that project in this account. It can write its logs, read the pipeline input artifact,
# publish the host files under host-files/ of the artifact bucket, run AWS-RunShellScript on
# the one host instance and read the result of that command (and cancel it when the build gives up waiting), and nothing else.
locals {
  deploy_role_name = "${local.deploy_project_name}-role"

  # Built from the name, like the other project ARNs: the project references its role, so
  # reading the ARNs back from the resources would create a dependency cycle.
  deploy_role_arn    = "${local.iam_arn_prefix}:role/${local.deploy_role_name}"
  deploy_project_arn = "arn:aws:codebuild:${local.account_arn_suffix}:project/${local.deploy_project_name}"

  deploy_policy_statements = [
    {
      Sid      = "WriteBuildLogs"
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = ["${aws_cloudwatch_log_group.codebuild.arn}:*"]
    },
    {
      Sid      = "ReadPipelineArtifacts"
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:GetObjectVersion"]
      Resource = ["${aws_s3_bucket.artifacts.arn}/*"]
    },
    {
      # The tarball with the host files and its checksum; the host role reads the same prefix.
      Sid      = "PublishHostFiles"
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = ["${aws_s3_bucket.artifacts.arn}/host-files/*"]
    },
    {
      Sid      = "ArtifactBucketLocation"
      Effect   = "Allow"
      Action   = ["s3:GetBucketAcl", "s3:GetBucketLocation"]
      Resource = [aws_s3_bucket.artifacts.arn]
    },
    {
      # SendCommand is authorized against the document and against every target instance, so
      # the statement lists the AWS-owned shell document (its ARN has no account ID) and the
      # single host instance.
      Sid    = "RunHostDeploy"
      Effect = "Allow"
      Action = ["ssm:SendCommand"]
      Resource = [
        "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
        "arn:aws:ec2:${local.account_arn_suffix}:instance/${var.host_instance_id}",
      ]
    },
    {
      # GetCommandInvocation has no resource-level support, so "*" is the only valid value.
      Sid      = "ReadCommandResult"
      Effect   = "Allow"
      Action   = ["ssm:GetCommandInvocation"]
      Resource = ["*"]
    },
    {
      # Cancels the command when the build gives up waiting for it. CancelCommand has no
      # resource-level support (the service authorization reference lists no resource type
      # for it), so "*" is the only valid value.
      Sid      = "CancelHostDeploy"
      Effect   = "Allow"
      Action   = ["ssm:CancelCommand"]
      Resource = ["*"]
    },
  ]
}

resource "aws_iam_role" "deploy" {
  name        = local.deploy_role_name
  description = "Service role of the ${local.deploy_project_name} CodeBuild project: deploys the release to the host through SSM Run Command."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "codebuild.amazonaws.com" }
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = local.account_id
          "aws:SourceArn"     = local.deploy_project_arn
        }
      }
    }]
  })

  tags = {
    Name = local.deploy_role_name
  }
}

resource "aws_iam_role_policy" "deploy" {
  name = "${local.deploy_project_name}-policy"
  role = aws_iam_role.deploy.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.deploy_policy_statements
  })
}
