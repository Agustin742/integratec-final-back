mock_provider "aws" {
  # The mock returns random strings for ARNs; the email subscriptions validate the topic
  # ARN format, so the alarm topic ARN is pinned to a well-formed value.
  override_resource {
    target = module.monitoring.aws_sns_topic.alarms
    values = {
      arn = "arn:aws:sns:us-east-2:123456789012:aula-virtual-prod-alarms"
    }
  }

  # The mock returns random strings for ARNs; runtime_access validates the bucket ARN
  # format, so the bucket ARN is pinned to a well-formed value.
  override_resource {
    target = module.storage.aws_s3_bucket.this
    values = {
      arn = "arn:aws:s3:::aula-virtual-prod-files-20260101000000000000000001"
    }
  }

  # The mock returns a random string for data source JSON, so the ECR lifecycle
  # policy document is pinned to a well-formed value (see infra/README.md CI checks).
  override_data {
    target = module.registry.data.aws_ecr_lifecycle_policy_document.this
    values = {
      json = "{\"rules\":[]}"
    }
  }

  # The mock leaves the managed master secret empty and returns random values for the
  # endpoint; app_config validates the database connection settings it publishes, so
  # the instance is pinned to well-formed values.
  override_resource {
    target = module.database.aws_db_instance.this
    values = {
      address = "aula-virtual-prod-db.abcdefghij.us-east-2.rds.amazonaws.com"
      port    = 5432
      master_user_secret = [{
        secret_arn    = "arn:aws:secretsmanager:us-east-2:123456789012:secret:rds!db-00000000-0000-0000-0000-000000000000-AbCdEf"
        kms_key_id    = "arn:aws:kms:us-east-2:123456789012:key/00000000-0000-0000-0000-000000000000"
        secret_status = "active"
      }]
    }
  }

  # The pipeline derives the registry host and every role ARN from the account ID; the
  # mock would return a random string, so it is pinned to a well-formed account ID.
  override_data {
    target = module.delivery_pipeline.data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
    }
  }

  # The deploy project targets exactly this instance and checks the sslip.io name of this
  # address; the mock would return random strings.
  override_resource {
    target = module.host.aws_instance.host
    values = {
      id = "i-0123456789abcdef0"
    }
  }

  override_resource {
    target = module.host.aws_eip.host
    values = {
      public_ip = "203.0.113.10"
    }
  }

  # The host role policy and the deploy role policy name the artifact bucket; pin its ARN
  # so the expected values below are exact.
  override_resource {
    target = module.delivery_pipeline.aws_s3_bucket.artifacts
    values = {
      arn = "arn:aws:s3:::aula-virtual-prod-pipeline-artifacts-20260101000000000000000001"
    }
  }
}

variables {
  import_existing_frontend = false
  project                  = "aula-virtual"
  allowed_origins          = ["https://app.example.com"]
  password_reset_url_base  = "https://app.example.com/reset-password"
  alert_email_addresses    = ["alerts@example.com"]
}

run "pipeline_is_v2_and_queued_so_two_pushes_never_overlap" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.pipeline.name == "aula-virtual-prod-backend" && module.delivery_pipeline.pipeline_name == "aula-virtual-prod-backend" && output.pipeline_name == "aula-virtual-prod-backend"
    error_message = "The pipeline must be <name_prefix>-backend and the root must expose its name."
  }

  assert {
    condition     = module.delivery_pipeline.pipeline.pipeline_type == "V2" && module.delivery_pipeline.pipeline.execution_mode == "QUEUED"
    error_message = "The pipeline must be V2 in QUEUED mode: runs are serialized, never concurrent."
  }

  assert {
    condition     = module.delivery_pipeline.pipeline.artifact_store == { location = module.delivery_pipeline.artifact_bucket_name, type = "S3", encryption_key_count = 0 }
    error_message = "The pipeline must keep its artifacts in the artifact bucket (S3, SSE-S3, no customer KMS key)."
  }

  assert {
    condition     = module.delivery_pipeline.pipeline.role_arn == "arn:aws:iam::123456789012:role/aula-virtual-prod-backend-role"
    error_message = "The pipeline must run as its own service role."
  }
}

run "stages_run_in_the_documented_order" {
  command = apply

  assert {
    condition     = [for s in module.delivery_pipeline.pipeline_stages : s.name] == ["Source", "Plan", "Approval", "Apply", "Images", "Deploy"]
    error_message = "The stages must be exactly Source, Plan, Approval, Apply, Images, Deploy, in that order."
  }

  assert {
    condition     = alltrue([for s in module.delivery_pipeline.pipeline_stages : length(s.actions) == 1])
    error_message = "Each stage must hold one action so the order of the actions is the order of the stages."
  }

  assert {
    condition     = module.delivery_pipeline.approval_stage_name == "Approval"
    error_message = "The approval stage name must be exposed."
  }
}

run "source_watches_develop_through_the_connection" {
  command = apply

  assert {
    condition     = one(module.delivery_pipeline.pipeline_stages[0].actions).category == "Source" && one(module.delivery_pipeline.pipeline_stages[0].actions).owner == "AWS" && one(module.delivery_pipeline.pipeline_stages[0].actions).provider == "CodeStarSourceConnection" && one(module.delivery_pipeline.pipeline_stages[0].actions).version == "1" && one(module.delivery_pipeline.pipeline_stages[0].actions).name == "Source"
    error_message = "The first action must be the CodeStarSourceConnection source action named Source."
  }

  assert {
    condition     = jsonencode(one(module.delivery_pipeline.pipeline_stages[0].actions).configuration) == jsonencode({ ConnectionArn = module.delivery_pipeline.connection_arn, FullRepositoryId = "Agustin742/integratec-final-back", BranchName = "develop", DetectChanges = "true", OutputArtifactFormat = "CODE_ZIP" })
    error_message = "The source must use the module connection, the configured repository, the develop branch and a plain zip."
  }

  assert {
    condition     = sort(tolist(one(module.delivery_pipeline.pipeline_stages[0].actions).output_artifacts)) == sort(["source"])
    error_message = "The source action must publish the source artifact."
  }
}

run "trigger_starts_only_on_pushes_to_develop" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.pipeline_trigger == { provider_type = "CodeStarSourceConnection", source_action_name = "Source", push_branches = ["develop"], push_tags = [], pull_request_count = 0 }
    error_message = "The trigger must start on pushes to develop only, with no tag or pull request trigger."
  }
}

run "plan_and_apply_share_the_plan_artifact" {
  command = apply

  assert {
    condition     = one(module.delivery_pipeline.pipeline_stages[1].actions).category == "Build" && one(module.delivery_pipeline.pipeline_stages[1].actions).provider == "CodeBuild" && jsonencode(one(module.delivery_pipeline.pipeline_stages[1].actions).configuration) == jsonencode({ ProjectName = "aula-virtual-prod-terraform-plan" }) && sort(tolist(one(module.delivery_pipeline.pipeline_stages[1].actions).input_artifacts)) == sort(["source"]) && sort(tolist(one(module.delivery_pipeline.pipeline_stages[1].actions).output_artifacts)) == sort(["plan"])
    error_message = "Plan must run the plan project on the source artifact and publish the plan artifact."
  }

  assert {
    condition     = one(module.delivery_pipeline.pipeline_stages[3].actions).category == "Build" && one(module.delivery_pipeline.pipeline_stages[3].actions).provider == "CodeBuild" && jsonencode(one(module.delivery_pipeline.pipeline_stages[3].actions).configuration) == jsonencode({ ProjectName = "aula-virtual-prod-terraform-apply" }) && sort(tolist(one(module.delivery_pipeline.pipeline_stages[3].actions).input_artifacts)) == sort(["plan"]) && length(one(module.delivery_pipeline.pipeline_stages[3].actions).output_artifacts) == 0
    error_message = "Apply must run the apply project on the plan artifact (the exact plan that was approved)."
  }
}

run "approval_is_manual_points_at_the_plan_log_and_expires" {
  command = apply

  assert {
    condition     = one(module.delivery_pipeline.pipeline_stages[2].actions).category == "Approval" && one(module.delivery_pipeline.pipeline_stages[2].actions).owner == "AWS" && one(module.delivery_pipeline.pipeline_stages[2].actions).provider == "Manual" && one(module.delivery_pipeline.pipeline_stages[2].actions).version == "1" && length(one(module.delivery_pipeline.pipeline_stages[2].actions).input_artifacts) == 0 && length(one(module.delivery_pipeline.pipeline_stages[2].actions).output_artifacts) == 0
    error_message = "The approval must be a Manual approval action without artifacts."
  }

  assert {
    condition     = one(module.delivery_pipeline.pipeline_stages[2].actions).timeout_in_minutes == 1440
    error_message = "The approval must expire after 1440 minutes by default; an expired approval fails the run and changes nothing."
  }

  assert {
    condition     = strcontains(one(module.delivery_pipeline.pipeline_stages[2].actions).configuration.CustomData, "Plan") && strcontains(one(module.delivery_pipeline.pipeline_stages[2].actions).configuration.CustomData, "build log")
    error_message = "The approver must be told to read the plan in the build log of the Plan action."
  }

  assert {
    condition     = one(module.delivery_pipeline.pipeline_stages[2].actions).configuration.ExternalEntityLink == "https://us-east-2.console.aws.amazon.com/codesuite/codebuild/projects/aula-virtual-prod-terraform-plan/history?region=us-east-2"
    error_message = "The approval must link to the plan project build history."
  }
}

run "images_exports_its_variables_and_deploy_receives_them" {
  command = apply

  assert {
    condition     = one(module.delivery_pipeline.pipeline_stages[4].actions).provider == "CodeBuild" && jsonencode(one(module.delivery_pipeline.pipeline_stages[4].actions).configuration) == jsonencode({ ProjectName = "aula-virtual-prod-images" }) && sort(tolist(one(module.delivery_pipeline.pipeline_stages[4].actions).input_artifacts)) == sort(["source"]) && one(module.delivery_pipeline.pipeline_stages[4].actions).namespace == "Images"
    error_message = "Images must run the images project on the source artifact in the Images namespace."
  }

  assert {
    condition     = one(module.delivery_pipeline.pipeline_stages[5].actions).provider == "CodeBuild" && sort(tolist(one(module.delivery_pipeline.pipeline_stages[5].actions).input_artifacts)) == sort(["source"]) && one(module.delivery_pipeline.pipeline_stages[5].actions).configuration.ProjectName == "aula-virtual-prod-deploy"
    error_message = "Deploy must run the deploy project on the source artifact."
  }

  assert {
    condition = jsondecode(one(module.delivery_pipeline.pipeline_stages[5].actions).configuration.EnvironmentVariables) == [
      { name = "API_IMAGE", value = "#{Images.API_IMAGE}", type = "PLAINTEXT" },
      { name = "REALTIME_IMAGE", value = "#{Images.REALTIME_IMAGE}", type = "PLAINTEXT" },
      { name = "MIGRATE_IMAGE", value = "#{Images.MIGRATE_IMAGE}", type = "PLAINTEXT" },
      { name = "IMAGE_TAG", value = "#{Images.IMAGE_TAG}", type = "PLAINTEXT" },
    ]
    error_message = "Deploy must receive the image URIs and tag from the exported variables of the Images action."
  }
}

run "pipeline_role_is_assumable_only_by_codepipeline_for_this_pipeline" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.pipeline_role_trust.Statement[0].Principal == { Service = "codepipeline.amazonaws.com" } && module.delivery_pipeline.pipeline_role_trust.Statement[0].Action == "sts:AssumeRole"
    error_message = "Only the CodePipeline service may assume the pipeline role."
  }

  assert {
    condition     = module.delivery_pipeline.pipeline_role_trust.Statement[0].Condition == { StringEquals = { "aws:SourceAccount" = "123456789012", "aws:SourceArn" = "arn:aws:codepipeline:us-east-2:123456789012:aula-virtual-prod-backend" } }
    error_message = "The trust must be limited to this account and this pipeline."
  }
}

run "pipeline_role_uses_only_its_connection_bucket_and_projects" {
  command = apply

  assert {
    condition     = one([for x in module.delivery_pipeline.pipeline_role_policy_statements : x if x.Sid == "UseGithubConnection"]).Resource == [module.delivery_pipeline.connection_arn] && sort(one([for x in module.delivery_pipeline.pipeline_role_policy_statements : x if x.Sid == "UseGithubConnection"]).Action) == sort(["codeconnections:UseConnection", "codestar-connections:UseConnection"])
    error_message = "UseConnection must be limited to the module connection."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.pipeline_role_policy_statements : x if x.Sid == "ArtifactBucketObjects"]).Resource == ["${module.delivery_pipeline.artifact_bucket_arn}/*"] && sort(one([for x in module.delivery_pipeline.pipeline_role_policy_statements : x if x.Sid == "ArtifactBucketObjects"]).Action) == sort(["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"])
    error_message = "Object access must be limited to the artifact bucket objects."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.pipeline_role_policy_statements : x if x.Sid == "ArtifactBucket"]).Resource == [module.delivery_pipeline.artifact_bucket_arn] && sort(one([for x in module.delivery_pipeline.pipeline_role_policy_statements : x if x.Sid == "ArtifactBucket"]).Action) == sort(["s3:GetBucketLocation", "s3:GetBucketVersioning", "s3:ListBucket"])
    error_message = "Bucket-level reads must be limited to the artifact bucket."
  }

  assert {
    condition     = sort(one([for x in module.delivery_pipeline.pipeline_role_policy_statements : x if x.Sid == "RunBuilds"]).Action) == sort(["codebuild:BatchGetBuilds", "codebuild:StartBuild", "codebuild:StopBuild"]) && sort(one([for x in module.delivery_pipeline.pipeline_role_policy_statements : x if x.Sid == "RunBuilds"]).Resource) == sort(["arn:aws:codebuild:us-east-2:123456789012:project/aula-virtual-prod-terraform-plan", "arn:aws:codebuild:us-east-2:123456789012:project/aula-virtual-prod-terraform-apply", "arn:aws:codebuild:us-east-2:123456789012:project/aula-virtual-prod-images", "arn:aws:codebuild:us-east-2:123456789012:project/aula-virtual-prod-deploy"])
    error_message = "Builds must be limited to the four pipeline projects."
  }

  assert {
    condition     = [for x in module.delivery_pipeline.pipeline_role_policy_statements : x.Sid] == ["UseGithubConnection", "ArtifactBucketObjects", "ArtifactBucket", "RunBuilds"] && alltrue([for x in module.delivery_pipeline.pipeline_role_policy_statements : x.Effect == "Allow" && !contains(x.Resource, "*")]) && module.delivery_pipeline.pipeline_managed_policy_arns == []
    error_message = "The pipeline role must hold exactly these four statements, no wildcard resource and no managed policy."
  }
}

run "apply_role_can_manage_the_pipeline_and_pass_its_role" {
  command = apply

  assert {
    condition     = one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "ManageCodePipelines"]).Resource == ["arn:aws:codepipeline:us-east-2:123456789012:aula-virtual-prod-*"]
    error_message = "Pipeline management must be scoped to pipelines named <name_prefix>-*."
  }

  assert {
    condition     = startswith(module.delivery_pipeline.pipeline.role_arn, "arn:aws:iam::123456789012:role/aula-virtual-prod-") && one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "PassProjectRoles"]).Condition.StringEquals["iam:PassedToService"] == ["ec2.amazonaws.com", "codebuild.amazonaws.com", "codepipeline.amazonaws.com"]
    error_message = "The apply role must be able to pass the pipeline role (prefixed name) to CodePipeline."
  }

  assert {
    condition     = contains(one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "ManageCodeConnections"]).Action, "codeconnections:*") && contains(one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "ManageCodeConnections"]).Action, "codestar-connections:*")
    error_message = "The apply role must cover PassConnection (and UseConnection) on connections through the connection statement."
  }
}

run "apply_build_timeout_outlasts_the_rds_update_timeout" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.terraform_projects.apply.build_timeout > 80
    error_message = "The apply build must outlast Terraform's 80 minute RDS update timeout."
  }

  assert {
    condition     = module.delivery_pipeline.terraform_projects.apply.build_timeout == 120 && module.delivery_pipeline.terraform_projects.plan.build_timeout == 30
    error_message = "The apply timeout defaults to 120 minutes; the plan timeout is unchanged."
  }
}
