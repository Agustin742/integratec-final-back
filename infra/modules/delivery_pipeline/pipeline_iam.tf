# Service role of the pipeline (decision D19): assumable only by CodePipeline on behalf of
# this pipeline in this account. It reads the GitHub source through the connection, moves
# artifacts through the artifact bucket and starts and watches the four CodeBuild projects,
# and nothing else. The builds themselves run with their own project roles.
locals {
  pipeline_role_name = "${local.pipeline_name}-role"

  # Built from the names, like the other ARNs: the pipeline references its role, so reading
  # the ARNs back from the resources would create a dependency cycle.
  pipeline_role_arn = "${local.iam_arn_prefix}:role/${local.pipeline_role_name}"
  pipeline_arn      = "arn:aws:codepipeline:${local.account_arn_suffix}:${local.pipeline_name}"

  pipeline_project_arns = [
    local.plan_project_arn,
    local.apply_project_arn,
    local.images_project_arn,
    local.deploy_project_arn,
  ]

  pipeline_policy_statements = [
    {
      # The connection ARN uses the codeconnections namespace; the legacy codestar-connections
      # action is listed as well because CodePipeline may evaluate either one. Both are
      # limited to this one connection.
      Sid      = "UseGithubConnection"
      Effect   = "Allow"
      Action   = ["codeconnections:UseConnection", "codestar-connections:UseConnection"]
      Resource = [aws_codeconnections_connection.this.arn]
    },
    {
      Sid      = "ArtifactBucketObjects"
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
      Resource = ["${aws_s3_bucket.artifacts.arn}/*"]
    },
    {
      Sid      = "ArtifactBucket"
      Effect   = "Allow"
      Action   = ["s3:GetBucketVersioning", "s3:GetBucketLocation", "s3:ListBucket"]
      Resource = [aws_s3_bucket.artifacts.arn]
    },
    {
      Sid      = "RunBuilds"
      Effect   = "Allow"
      Action   = ["codebuild:StartBuild", "codebuild:BatchGetBuilds", "codebuild:StopBuild"]
      Resource = local.pipeline_project_arns
    },
  ]
}

resource "aws_iam_role" "pipeline" {
  name        = local.pipeline_role_name
  description = "Service role of the ${local.pipeline_name} pipeline: reads the GitHub connection, moves artifacts and starts the four CodeBuild projects."

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "codepipeline.amazonaws.com" }
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = local.account_id
          "aws:SourceArn"     = local.pipeline_arn
        }
      }
    }]
  })

  tags = {
    Name = local.pipeline_role_name
  }
}

resource "aws_iam_role_policy" "pipeline" {
  name = "${local.pipeline_name}-policy"
  role = aws_iam_role.pipeline.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.pipeline_policy_statements
  })
}
