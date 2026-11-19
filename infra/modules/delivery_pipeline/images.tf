# CodeBuild project that builds the api, migrate and realtime images and pushes them to ECR
# with the immutable release-<date>-<short commit> tag (decision D19). The buildspec lives in
# infra/pipeline/buildspecs/images.yml; the pipeline (pipeline.tf) chains the project.
locals {
  images_project_name = "${var.name_prefix}-images"

  # Not a secret, but it holds the account ID, so it is injected instead of committed.
  ecr_registry = "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com"

  images_environment_variables = {
    ECR_REGISTRY            = local.ecr_registry
    ECR_REPOSITORY_API      = var.ecr_repository_names["api"]
    ECR_REPOSITORY_REALTIME = var.ecr_repository_names["realtime"]
    ECR_REPOSITORY_MIGRATE  = var.ecr_repository_names["migrate"]
  }
}

resource "aws_codebuild_project" "images" {
  name          = local.images_project_name
  description   = "Builds the api, migrate and realtime images from the commit the pipeline runs on and pushes them to ECR."
  service_role  = local.images_role_arn
  build_timeout = var.images_build_timeout_minutes

  source {
    type      = "CODEPIPELINE"
    buildspec = "infra/pipeline/buildspecs/images.yml"
  }

  # The buildspec declares no output files: the deploy stage receives the image tag and
  # URIs as exported variables of this action.
  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = local.codebuild_image
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"
    # Required to run the Docker daemon that docker build talks to. It gives the build
    # container extended access to its own host, which is why only this project has it.
    privileged_mode = true

    dynamic "environment_variable" {
      for_each = local.images_environment_variables

      content {
        name  = environment_variable.key
        value = environment_variable.value
        type  = "PLAINTEXT"
      }
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.codebuild.name
      stream_name = "images"
    }
  }

  tags = {
    Name = local.images_project_name
  }

  # service_role is built from the role name, so the policy must be ordered explicitly:
  # CodeBuild validates that it can assume the role when the project is created.
  depends_on = [aws_iam_role_policy.images]
}
