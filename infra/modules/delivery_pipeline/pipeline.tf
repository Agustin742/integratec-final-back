# The pipeline that chains the deploy (decision D19): a push to the source branch runs
# terraform plan, waits for a manual approval, applies exactly that plan, builds and pushes
# the release images and deploys them to the host. It uses the CodeBuild projects defined in
# terraform_runner.tf, images.tf and deploy.tf.
#
# V2 in QUEUED mode: a push that arrives while a run is waiting for approval or deploying
# waits its turn, so two runs never apply or deploy at once. That is why the projects carry
# no concurrent_build_limit.
locals {
  pipeline_name       = "${var.name_prefix}-backend"
  approval_stage_name = "Approval"

  # Console page of the plan project, built from the name (not read from the resource, like
  # the other project ARNs). The approver opens the latest build there to read the plan.
  plan_build_history_url = "https://${var.region}.console.aws.amazon.com/codesuite/codebuild/projects/${local.plan_project_name}/history?region=${var.region}"
}

resource "aws_codepipeline" "this" {
  name           = local.pipeline_name
  role_arn       = local.pipeline_role_arn
  pipeline_type  = "V2"
  execution_mode = "QUEUED"

  # SSE-S3 default encryption of the bucket; no customer-managed key, as elsewhere.
  artifact_store {
    location = aws_s3_bucket.artifacts.id
    type     = "S3"
  }

  # Starts the pipeline on pushes to the source branch through the connection. Pull
  # requests are out of scope.
  trigger {
    provider_type = "CodeStarSourceConnection"

    git_configuration {
      source_action_name = "Source"

      push {
        branches {
          includes = [var.source_branch]
        }
      }
    }
  }

  stage {
    name = "Source"

    action {
      name             = "Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["source"]

      # A plain zip is enough: no buildspec needs the .git directory (the image tag uses
      # CODEBUILD_RESOLVED_SOURCE_VERSION, which CodePipeline sets from the source revision).
      configuration = {
        ConnectionArn        = aws_codeconnections_connection.this.arn
        FullRepositoryId     = var.github_repository
        BranchName           = var.source_branch
        DetectChanges        = "true"
        OutputArtifactFormat = "CODE_ZIP"
      }
    }
  }

  stage {
    name = "Plan"

    action {
      name             = "Plan"
      category         = "Build"
      owner            = "AWS"
      provider         = "CodeBuild"
      version          = "1"
      input_artifacts  = ["source"]
      output_artifacts = ["plan"]

      configuration = {
        ProjectName = aws_codebuild_project.terraform_plan.name
      }
    }
  }

  stage {
    name = local.approval_stage_name

    action {
      name     = "ApprovePlan"
      category = "Approval"
      owner    = "AWS"
      provider = "Manual"
      version  = "1"

      # When the approval expires the run fails here and nothing is applied, built or deployed.
      timeout_in_minutes = var.approval_timeout_minutes

      configuration = {
        CustomData         = "Review the Terraform plan in the build log of the Plan action (open the Plan action, then View logs). Approve only if every change is expected: the Apply action applies exactly that saved plan. Reject to stop the run with no change."
        ExternalEntityLink = local.plan_build_history_url
      }
    }
  }

  stage {
    name = "Apply"

    action {
      name            = "Apply"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      input_artifacts = ["plan"]

      configuration = {
        ProjectName = aws_codebuild_project.terraform_apply.name
      }
    }
  }

  stage {
    name = "Images"

    action {
      name            = "Images"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      input_artifacts = ["source"]

      # Makes the variables exported by images.yml readable as #{Images.<NAME>}.
      namespace = "Images"

      configuration = {
        ProjectName = aws_codebuild_project.images.name
      }
    }
  }

  stage {
    name = "Deploy"

    action {
      name            = "Deploy"
      category        = "Build"
      owner           = "AWS"
      provider        = "CodeBuild"
      version         = "1"
      input_artifacts = ["source"]

      configuration = {
        ProjectName = aws_codebuild_project.deploy.name

        # Resolved by CodePipeline from the exported variables of the Images action.
        EnvironmentVariables = jsonencode([
          { name = "API_IMAGE", value = "#{Images.API_IMAGE}", type = "PLAINTEXT" },
          { name = "REALTIME_IMAGE", value = "#{Images.REALTIME_IMAGE}", type = "PLAINTEXT" },
          { name = "MIGRATE_IMAGE", value = "#{Images.MIGRATE_IMAGE}", type = "PLAINTEXT" },
          { name = "IMAGE_TAG", value = "#{Images.IMAGE_TAG}", type = "PLAINTEXT" },
        ])
      }
    }
  }

  tags = {
    Name = local.pipeline_name
  }

  # The role is passed by name: CodePipeline validates that it can assume it on creation.
  depends_on = [aws_iam_role_policy.pipeline]
}
