mock_provider "aws" {
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
}

run "deploy_project_runs_the_buildspec_from_the_pipeline_source" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.deploy_project.name == "aula-virtual-prod-deploy" && output.pipeline_deploy_project_name == "aula-virtual-prod-deploy"
    error_message = "The project must be <name_prefix>-deploy and the root must expose its name."
  }

  assert {
    condition     = module.delivery_pipeline.deploy_project.source_type == "CODEPIPELINE" && module.delivery_pipeline.deploy_project.artifacts_type == "CODEPIPELINE" && module.delivery_pipeline.deploy_project.buildspec == "infra/pipeline/buildspecs/deploy.yml"
    error_message = "The project must take its source and artifacts from CodePipeline and use the deploy buildspec."
  }

  assert {
    condition     = module.delivery_pipeline.deploy_project.compute_type == "BUILD_GENERAL1_SMALL" && module.delivery_pipeline.deploy_project.environment_type == "LINUX_CONTAINER" && module.delivery_pipeline.deploy_project.image == "aws/codebuild/amazonlinux-x86_64-standard:5.0" && module.delivery_pipeline.deploy_project.image_pull_credentials_type == "CODEBUILD"
    error_message = "The project must run on BUILD_GENERAL1_SMALL with the curated Amazon Linux 2023 image."
  }

  assert {
    condition     = module.delivery_pipeline.deploy_project.privileged_mode == false && module.delivery_pipeline.deploy_project.vpc_config_count == 0
    error_message = "The project needs no Docker daemon and must not join a VPC."
  }

  assert {
    condition     = module.delivery_pipeline.deploy_project.build_timeout == 30
    error_message = "The build timeout must be explicit: 30 minutes by default."
  }

  assert {
    condition     = module.delivery_pipeline.deploy_project.log_group_name == module.delivery_pipeline.log_group_name && module.delivery_pipeline.deploy_project.log_stream_prefix == "deploy"
    error_message = "The project must log to the delivery pipeline log group with its own stream prefix."
  }
}

run "deploy_environment_holds_the_host_the_bucket_and_the_public_name" {
  command = apply

  assert {
    condition = module.delivery_pipeline.deploy_project.environment_variables == {
      INSTANCE_ID     = { value = "i-0123456789abcdef0", type = "PLAINTEXT" }
      ARTIFACT_BUCKET = { value = module.delivery_pipeline.artifact_bucket_name, type = "PLAINTEXT" }
      SITE_ADDRESS    = { value = "203-0-113-10.sslip.io", type = "PLAINTEXT" }
    }
    error_message = "The project must receive exactly INSTANCE_ID, ARTIFACT_BUCKET and SITE_ADDRESS (the sslip.io name of the host) as plain text; the image variables come from the pipeline."
  }

  assert {
    condition     = output.host_sslip_domain == "203-0-113-10.sslip.io"
    error_message = "SITE_ADDRESS must equal the host_sslip_domain output."
  }
}

run "deploy_role_is_assumable_only_by_codebuild_for_the_deploy_project" {
  command = apply

  assert {
    condition     = length(module.delivery_pipeline.deploy_role_trust.Statement) == 1 && module.delivery_pipeline.deploy_role_trust.Statement[0].Effect == "Allow" && module.delivery_pipeline.deploy_role_trust.Statement[0].Action == "sts:AssumeRole" && module.delivery_pipeline.deploy_role_trust.Statement[0].Principal == { Service = "codebuild.amazonaws.com" }
    error_message = "The role must trust only codebuild.amazonaws.com."
  }

  assert {
    condition     = module.delivery_pipeline.deploy_role_trust.Statement[0].Condition == { StringEquals = { "aws:SourceAccount" = "123456789012", "aws:SourceArn" = "arn:aws:codebuild:us-east-2:123456789012:project/aula-virtual-prod-deploy" } }
    error_message = "The role must be conditioned on the account and on the deploy project ARN."
  }

  assert {
    condition     = output.pipeline_deploy_role_arn == module.delivery_pipeline.deploy_role_arn && module.delivery_pipeline.deploy_role_arn != module.delivery_pipeline.images_role_arn && module.delivery_pipeline.deploy_role_arn != module.delivery_pipeline.terraform_plan_role_arn && module.delivery_pipeline.deploy_role_arn != module.delivery_pipeline.terraform_apply_role_arn
    error_message = "The root must expose the role ARN, and the deploy role must be distinct from the other project roles."
  }
}

run "deploy_role_writes_logs_and_moves_artifacts_within_the_bucket" {
  command = apply

  assert {
    condition     = one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "WriteBuildLogs"]).Action == ["logs:CreateLogStream", "logs:PutLogEvents"] && one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "WriteBuildLogs"]).Resource == ["${module.delivery_pipeline.log_group_arn}:*"]
    error_message = "Log writes must be scoped to the delivery pipeline log group."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "ReadPipelineArtifacts"]).Action == ["s3:GetObject", "s3:GetObjectVersion"] && one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "ReadPipelineArtifacts"]).Resource == ["${module.delivery_pipeline.artifact_bucket_arn}/*"]
    error_message = "The project must read the input artifact from the artifact bucket."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "PublishHostFiles"]).Action == ["s3:PutObject"] && one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "PublishHostFiles"]).Resource == ["${module.delivery_pipeline.artifact_bucket_arn}/host-files/*"]
    error_message = "Writes to the artifact bucket must be PutObject under host-files/ only."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "ArtifactBucketLocation"]).Resource == [module.delivery_pipeline.artifact_bucket_arn]
    error_message = "Bucket location reads must be scoped to the artifact bucket."
  }
}

run "deploy_role_runs_the_shell_document_on_the_host_only" {
  command = apply

  assert {
    condition     = one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "RunHostDeploy"]).Action == ["ssm:SendCommand"]
    error_message = "Sending commands must be the only action of the run statement."
  }

  assert {
    condition     = sort(one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "RunHostDeploy"]).Resource) == sort(["arn:aws:ssm:us-east-2::document/AWS-RunShellScript", "arn:aws:ec2:us-east-2:123456789012:instance/i-0123456789abcdef0"])
    error_message = "SendCommand must be scoped to the AWS-RunShellScript document and the host instance, and nothing else."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "ReadCommandResult"]).Action == ["ssm:GetCommandInvocation"] && one([for x in module.delivery_pipeline.deploy_role_policy_statements : x if x.Sid == "ReadCommandResult"]).Resource == ["*"]
    error_message = "Reading the command result must be GetCommandInvocation alone; it has no resource-level support, so * is the only valid value."
  }

  assert {
    condition     = [for x in module.delivery_pipeline.deploy_role_policy_statements : x.Sid if contains(x.Resource, "*")] == ["ReadCommandResult"]
    error_message = "No statement other than the command result read may use a wildcard resource."
  }
}

run "deploy_role_has_no_other_service_and_no_managed_policy" {
  command = apply

  assert {
    condition     = toset([for a in flatten([for x in module.delivery_pipeline.deploy_role_policy_statements : x.Action]) : split(":", a)[0]]) == toset(["logs", "s3", "ssm"])
    error_message = "The role may only use CloudWatch Logs, S3 (artifacts) and SSM (Run Command)."
  }

  assert {
    condition     = alltrue([for x in module.delivery_pipeline.deploy_role_policy_statements : x.Effect == "Allow" && !strcontains(join(",", x.Action), "*")])
    error_message = "Statements must be plain allows with no wildcard action."
  }

  assert {
    condition     = toset([for x in module.delivery_pipeline.deploy_role_policy_statements : x.Sid]) == toset(["WriteBuildLogs", "ReadPipelineArtifacts", "PublishHostFiles", "ArtifactBucketLocation", "RunHostDeploy", "ReadCommandResult"])
    error_message = "The role must have exactly the six documented statements."
  }

  assert {
    condition     = module.delivery_pipeline.deploy_managed_policy_arns == []
    error_message = "The role carries only its inline policy."
  }
}

run "host_role_gains_read_access_to_the_host_files_prefix_only" {
  command = apply

  assert {
    condition     = module.runtime_access.policy_statements["ReadHostFiles"].Action == "s3:GetObject" && module.runtime_access.policy_statements["ReadHostFiles"].Resource == "${module.delivery_pipeline.artifact_bucket_arn}/host-files/*"
    error_message = "The host may only read the host-files/ objects of the artifact bucket."
  }

  assert {
    condition     = module.runtime_access.policy_statements["ReadHostFiles"].Effect == "Allow" && module.delivery_pipeline.artifact_bucket_arn == "arn:aws:s3:::aula-virtual-prod-pipeline-artifacts-20260101000000000000000001"
    error_message = "The statement must be an Allow on the artifact bucket of the pipeline."
  }
}
