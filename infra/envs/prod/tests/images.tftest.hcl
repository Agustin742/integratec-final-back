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
}

variables {
  import_existing_frontend = false
  project                  = "aula-virtual"
  allowed_origins          = ["https://app.example.com"]
  password_reset_url_base  = "https://app.example.com/reset-password"
  alert_email_addresses    = ["alerts@example.com"]
}

run "images_project_builds_and_pushes_from_the_pipeline_source" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.images_project.name == "aula-virtual-prod-images" && output.pipeline_images_project_name == "aula-virtual-prod-images"
    error_message = "The project must be <name_prefix>-images and the root must expose its name."
  }

  assert {
    condition     = module.delivery_pipeline.images_project.source_type == "CODEPIPELINE" && module.delivery_pipeline.images_project.artifacts_type == "CODEPIPELINE" && module.delivery_pipeline.images_project.buildspec == "infra/pipeline/buildspecs/images.yml"
    error_message = "The project must take its source and artifacts from CodePipeline and use the images buildspec."
  }

  assert {
    condition     = module.delivery_pipeline.images_project.compute_type == "BUILD_GENERAL1_SMALL" && module.delivery_pipeline.images_project.environment_type == "LINUX_CONTAINER" && module.delivery_pipeline.images_project.image == "aws/codebuild/amazonlinux-x86_64-standard:5.0" && module.delivery_pipeline.images_project.image_pull_credentials_type == "CODEBUILD"
    error_message = "The project must run on BUILD_GENERAL1_SMALL (the Free Tier size) with the curated Amazon Linux 2023 image."
  }

  assert {
    condition     = module.delivery_pipeline.images_project.vpc_config_count == 0
    error_message = "The project must not join a VPC: it only talks to public endpoints and ECR."
  }

  assert {
    condition     = module.delivery_pipeline.images_project.build_timeout == 60
    error_message = "The build timeout must be explicit: 60 minutes by default."
  }

  assert {
    condition     = module.delivery_pipeline.images_project.log_group_name == module.delivery_pipeline.log_group_name && module.delivery_pipeline.images_project.log_stream_prefix == "images"
    error_message = "The project must log to the delivery pipeline log group with its own stream prefix."
  }
}

run "only_the_images_project_is_privileged" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.images_project.privileged_mode == true
    error_message = "Docker builds need the Docker daemon, which requires privileged mode."
  }

  assert {
    condition     = alltrue([for p in values(module.delivery_pipeline.terraform_projects) : p.privileged_mode == false])
    error_message = "The Terraform runner projects must stay unprivileged."
  }
}

run "images_environment_holds_the_registry_and_the_three_repository_names" {
  command = apply

  assert {
    condition = module.delivery_pipeline.images_project.environment_variables == {
      ECR_REGISTRY            = { value = "123456789012.dkr.ecr.us-east-2.amazonaws.com", type = "PLAINTEXT" }
      ECR_REPOSITORY_API      = { value = module.registry.repository_names["api"], type = "PLAINTEXT" }
      ECR_REPOSITORY_REALTIME = { value = module.registry.repository_names["realtime"], type = "PLAINTEXT" }
      ECR_REPOSITORY_MIGRATE  = { value = module.registry.repository_names["migrate"], type = "PLAINTEXT" }
    }
    error_message = "The project must receive exactly ECR_REGISTRY and the api, realtime and migrate repository names as plain text."
  }

  assert {
    condition     = module.registry.repository_names["api"] == "aula-virtual-prod-api" && module.registry.repository_names["migrate"] == "aula-virtual-prod-migrate"
    error_message = "The repository names must follow <name_prefix>-<service>."
  }
}

run "images_role_is_assumable_only_by_codebuild_for_the_images_project" {
  command = apply

  assert {
    condition     = length(module.delivery_pipeline.images_role_trust.Statement) == 1 && module.delivery_pipeline.images_role_trust.Statement[0].Effect == "Allow" && module.delivery_pipeline.images_role_trust.Statement[0].Action == "sts:AssumeRole" && module.delivery_pipeline.images_role_trust.Statement[0].Principal == { Service = "codebuild.amazonaws.com" }
    error_message = "The role must trust only codebuild.amazonaws.com."
  }

  assert {
    condition     = module.delivery_pipeline.images_role_trust.Statement[0].Condition == { StringEquals = { "aws:SourceAccount" = "123456789012", "aws:SourceArn" = "arn:aws:codebuild:us-east-2:123456789012:project/aula-virtual-prod-images" } }
    error_message = "The role must be conditioned on the account and on the images project ARN."
  }

  assert {
    condition     = output.pipeline_images_role_arn == module.delivery_pipeline.images_role_arn && module.delivery_pipeline.images_role_arn != module.delivery_pipeline.terraform_plan_role_arn
    error_message = "The root must expose the role ARN."
  }

  assert {
    condition     = module.delivery_pipeline.images_role_arn != module.delivery_pipeline.terraform_plan_role_arn && module.delivery_pipeline.images_role_arn != module.delivery_pipeline.terraform_apply_role_arn
    error_message = "The images role must be distinct from the Terraform runner roles."
  }
}

run "images_role_writes_logs_and_reads_pipeline_artifacts_only" {
  command = apply

  assert {
    condition     = one([for x in module.delivery_pipeline.images_role_policy_statements : x if x.Sid == "WriteBuildLogs"]).Action == ["logs:CreateLogStream", "logs:PutLogEvents"] && one([for x in module.delivery_pipeline.images_role_policy_statements : x if x.Sid == "WriteBuildLogs"]).Resource == ["${module.delivery_pipeline.log_group_arn}:*"]
    error_message = "Log writes must be scoped to the delivery pipeline log group."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.images_role_policy_statements : x if x.Sid == "ReadPipelineArtifacts"]).Action == ["s3:GetObject", "s3:GetObjectVersion"] && one([for x in module.delivery_pipeline.images_role_policy_statements : x if x.Sid == "ReadPipelineArtifacts"]).Resource == ["${module.delivery_pipeline.artifact_bucket_arn}/*"]
    error_message = "The project only reads its input artifact: it emits none, so it gets no write access to the artifact bucket."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.images_role_policy_statements : x if x.Sid == "ArtifactBucketLocation"]).Resource == [module.delivery_pipeline.artifact_bucket_arn]
    error_message = "Bucket location reads must be scoped to the artifact bucket."
  }
}

run "images_role_pushes_only_to_the_three_repositories" {
  command = apply

  assert {
    condition     = one([for x in module.delivery_pipeline.images_role_policy_statements : x if x.Sid == "PushImages"]).Action == ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:DescribeImages", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart"]
    error_message = "Push and describe actions must be exactly the ones docker push and the existence check use."
  }

  assert {
    condition     = sort(one([for x in module.delivery_pipeline.images_role_policy_statements : x if x.Sid == "PushImages"]).Resource) == sort([module.registry.repository_arns["api"], module.registry.repository_arns["realtime"], module.registry.repository_arns["migrate"]])
    error_message = "Push access must be scoped to exactly the api, realtime and migrate repository ARNs."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.images_role_policy_statements : x if x.Sid == "EcrLogin"]).Action == ["ecr:GetAuthorizationToken"] && one([for x in module.delivery_pipeline.images_role_policy_statements : x if x.Sid == "EcrLogin"]).Resource == ["*"]
    error_message = "ecr:GetAuthorizationToken has no resource-level support: it must be the only action on *."
  }

  assert {
    condition     = [for x in module.delivery_pipeline.images_role_policy_statements : x.Sid if contains(x.Resource, "*")] == ["EcrLogin"]
    error_message = "No statement other than the registry login may use a wildcard resource."
  }
}

run "images_role_has_no_other_service_and_no_managed_policy" {
  command = apply

  assert {
    condition     = toset([for a in flatten([for x in module.delivery_pipeline.images_role_policy_statements : x.Action]) : split(":", a)[0]]) == toset(["logs", "s3", "ecr"])
    error_message = "The role may only use CloudWatch Logs, S3 (artifacts) and ECR."
  }

  assert {
    condition     = alltrue([for x in module.delivery_pipeline.images_role_policy_statements : x.Effect == "Allow" && !strcontains(join(",", x.Action), "*")])
    error_message = "Statements must be plain allows with no wildcard action."
  }

  assert {
    condition     = module.delivery_pipeline.images_managed_policy_arns == []
    error_message = "The role carries only its inline policy."
  }
}
