# CodeBuild projects that run Terraform for the deploy pipeline (decision D19): `plan`
# saves the plan, and `apply` (after the manual approval) applies exactly that saved plan.
# The buildspecs live in infra/pipeline/buildspecs; the pipeline (pipeline.tf) chains the projects.
data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  # Same naming as infra/bootstrap/main.tf. The name holds the account ID and the
  # repository is public, so it is injected as an environment variable, never committed.
  state_bucket_name = "${var.project}-tfstate-${local.account_id}"

  # Curated Amazon Linux 2023 image. Update the tag deliberately: image versions change
  # the shell tooling the buildspecs rely on.
  codebuild_image = "aws/codebuild/amazonlinux-x86_64-standard:5.0"

  plan_project_name  = "${var.name_prefix}-terraform-plan"
  apply_project_name = "${var.name_prefix}-terraform-apply"

  # All plain text: none of these is a secret (the password reset value is a public page URL).
  # The plan reads the variables the prod root has no default for, and the ones a local
  # terraform.tfvars overrides, so the pipeline plan equals the local one.
  plan_environment_variables = {
    TF_STATE_BUCKET                = local.state_bucket_name
    TF_VAR_region                  = var.region
    TF_VAR_project                 = var.project
    TF_VAR_enable_github_oidc      = tostring(var.enable_github_oidc)
    TF_VAR_allowed_origins         = jsonencode(var.allowed_origins)
    TF_VAR_password_reset_url_base = var.password_reset_url_base
  }

  # Terraform rejects variable values when applying a saved plan: it takes them from the plan.
  apply_environment_variables = {
    TF_STATE_BUCKET = local.state_bucket_name
  }
}

resource "aws_codebuild_project" "terraform_plan" {
  name          = local.plan_project_name
  description   = "Runs terraform plan of infra/envs/prod and saves the plan for the manual approval."
  service_role  = local.plan_role_arn
  build_timeout = var.plan_build_timeout_minutes

  source {
    type      = "CODEPIPELINE"
    buildspec = "infra/pipeline/buildspecs/terraform-plan.yml"
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
      for_each = local.plan_environment_variables

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
      stream_name = "terraform-plan"
    }
  }

  tags = {
    Name = local.plan_project_name
  }

  # service_role is built from the role name, so the roles must be ordered explicitly:
  # CodeBuild validates that it can assume the role when the project is created.
  depends_on = [aws_iam_role_policy.terraform_plan, aws_iam_role_policy_attachment.terraform_plan_read_only]
}

resource "aws_codebuild_project" "terraform_apply" {
  name          = local.apply_project_name
  description   = "Applies the saved terraform plan that was approved; never plans again."
  service_role  = local.apply_role_arn
  build_timeout = var.apply_build_timeout_minutes

  # No project concurrency limit: CodeBuild rejects a build over the limit instead of queueing it.
  # The pipeline runs in QUEUED mode, so two applies never run at once.
  source {
    type      = "CODEPIPELINE"
    buildspec = "infra/pipeline/buildspecs/terraform-apply.yml"
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
      for_each = local.apply_environment_variables

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
      stream_name = "terraform-apply"
    }
  }

  tags = {
    Name = local.apply_project_name
  }

  depends_on = [aws_iam_role_policy.terraform_apply]
}
