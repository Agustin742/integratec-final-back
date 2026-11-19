# Service role of the images project (decision D19): assumable only by CodeBuild on behalf of
# that project in this account. It can write its logs, read the pipeline input artifact and
# push to the three image repositories, and nothing else. Pulling the base image from
# public.ecr.aws needs no IAM.
locals {
  images_role_name = "${local.images_project_name}-role"

  # Built from the name, like the runner ARNs: the project references its role, so reading
  # the ARNs back from the resources would create a dependency cycle.
  images_role_arn    = "${local.iam_arn_prefix}:role/${local.images_role_name}"
  images_project_arn = "arn:aws:codebuild:${local.account_arn_suffix}:project/${local.images_project_name}"

  images_policy_statements = [
    {
      Sid      = "WriteBuildLogs"
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = ["${aws_cloudwatch_log_group.codebuild.arn}:*"]
    },
    {
      # Read only: the project declares no output files, so it never writes to the bucket.
      Sid      = "ReadPipelineArtifacts"
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:GetObjectVersion"]
      Resource = ["${aws_s3_bucket.artifacts.arn}/*"]
    },
    {
      Sid      = "ArtifactBucketLocation"
      Effect   = "Allow"
      Action   = ["s3:GetBucketAcl", "s3:GetBucketLocation"]
      Resource = [aws_s3_bucket.artifacts.arn]
    },
    {
      # GetAuthorizationToken has no resource-level support, so "*" is the only valid value.
      Sid      = "EcrLogin"
      Effect   = "Allow"
      Action   = ["ecr:GetAuthorizationToken"]
      Resource = ["*"]
    },
    {
      # What docker push and the describe-images existence check call, on exactly the
      # three image repositories.
      Sid    = "PushImages"
      Effect = "Allow"
      Action = [
        "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
        "ecr:DescribeImages", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload",
        "ecr:PutImage", "ecr:UploadLayerPart",
      ]
      Resource = [for service in ["api", "realtime", "migrate"] : var.ecr_repository_arns[service]]
    },
  ]
}

resource "aws_iam_role" "images" {
  name        = local.images_role_name
  description = "Service role of the ${local.images_project_name} CodeBuild project: builds the release images and pushes them to ECR."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "codebuild.amazonaws.com" }
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = local.account_id
          "aws:SourceArn"     = local.images_project_arn
        }
      }
    }]
  })

  tags = {
    Name = local.images_role_name
  }
}

resource "aws_iam_role_policy" "images" {
  name = "${local.images_project_name}-policy"
  role = aws_iam_role.images.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.images_policy_statements
  })
}
