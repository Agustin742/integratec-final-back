# CodeBuild project that deploys a release to the EC2 host through SSM Run Command and then
# health-checks the public endpoints (decision D19). The buildspec lives in
# infra/pipeline/buildspecs/deploy.yml and sends infra/pipeline/scripts/host-deploy.sh to the
# host. The image variables (IMAGE_TAG, API_IMAGE, REALTIME_IMAGE, MIGRATE_IMAGE) are not set
# here: the pipeline (pipeline.tf) sets them from the
# exported variables of the images action.
locals {
  deploy_project_name = "${var.name_prefix}-deploy"

  # Not secrets. The instance ID and the bucket name identify the target; SITE_ADDRESS is the
  # public sslip.io name that Caddy serves.
  deploy_environment_variables = {
    INSTANCE_ID     = var.host_instance_id
    ARTIFACT_BUCKET = aws_s3_bucket.artifacts.id
    SITE_ADDRESS    = var.site_address
  }
}

resource "aws_codebuild_project" "deploy" {
  name          = local.deploy_project_name
  description   = "Deploys the release images to the EC2 host through SSM Run Command and checks the public health endpoints."
  service_role  = local.deploy_role_arn
  build_timeout = var.deploy_build_timeout_minutes

  # No project concurrency limit: CodeBuild rejects a build over the limit instead of queueing it.
  # The pipeline runs in QUEUED mode, which serializes the deployments.
  source {
    type      = "CODEPIPELINE"
    buildspec = "infra/pipeline/buildspecs/deploy.yml"
  }

  artifacts {
    type = "CODEPIPELINE"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = local.codebuild_image
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"
    privileged_mode             = false

    dynamic "environment_variable" {
      for_each = local.deploy_environment_variables

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
      stream_name = "deploy"
    }
  }

  tags = {
    Name = local.deploy_project_name
  }

  # service_role is built from the role name, so the policy must be ordered explicitly:
  # CodeBuild validates that it can assume the role when the project is created.
  depends_on = [aws_iam_role_policy.deploy]
}
