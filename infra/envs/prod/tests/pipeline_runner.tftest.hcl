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

  # The runner derives the state bucket name and every role ARN from the account ID; the
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
}

run "projects_are_named_by_prefix_and_take_their_source_from_codepipeline" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.terraform_projects.plan.name == "aula-virtual-prod-terraform-plan" && module.delivery_pipeline.terraform_projects.apply.name == "aula-virtual-prod-terraform-apply"
    error_message = "The projects must be <name_prefix>-terraform-plan and <name_prefix>-terraform-apply."
  }

  assert {
    condition     = alltrue([for p in values(module.delivery_pipeline.terraform_projects) : p.source_type == "CODEPIPELINE" && p.artifacts_type == "CODEPIPELINE"])
    error_message = "Source and artifacts of both projects must be CODEPIPELINE."
  }

  assert {
    condition     = module.delivery_pipeline.terraform_projects.plan.buildspec == "infra/pipeline/buildspecs/terraform-plan.yml" && module.delivery_pipeline.terraform_projects.apply.buildspec == "infra/pipeline/buildspecs/terraform-apply.yml"
    error_message = "Each project must point at its buildspec in the repository."
  }

  assert {
    condition     = output.pipeline_terraform_plan_project_name == "aula-virtual-prod-terraform-plan" && output.pipeline_terraform_apply_project_name == "aula-virtual-prod-terraform-apply"
    error_message = "The root must expose both project names."
  }
}

run "projects_use_a_small_unprivileged_curated_image_without_a_vpc" {
  command = apply

  assert {
    condition     = alltrue([for p in values(module.delivery_pipeline.terraform_projects) : p.compute_type == "BUILD_GENERAL1_SMALL" && p.environment_type == "LINUX_CONTAINER" && p.image == "aws/codebuild/amazonlinux-x86_64-standard:5.0"])
    error_message = "Both projects must run on BUILD_GENERAL1_SMALL with the curated Amazon Linux 2023 standard:5.0 image."
  }

  assert {
    condition     = alltrue([for p in values(module.delivery_pipeline.terraform_projects) : p.privileged_mode == false && p.image_pull_credentials_type == "CODEBUILD" && p.vpc_config_count == 0])
    error_message = "The projects must not be privileged, must pull with CodeBuild credentials and must not join a VPC."
  }

  assert {
    condition     = module.delivery_pipeline.terraform_projects.plan.build_timeout == 30 && module.delivery_pipeline.terraform_projects.apply.build_timeout == 60
    error_message = "Timeouts must be explicit: 30 minutes for plan and 60 for apply."
  }
}

run "projects_log_to_the_shared_group_with_distinct_stream_prefixes" {
  command = apply

  assert {
    condition     = alltrue([for p in values(module.delivery_pipeline.terraform_projects) : p.log_group_name == module.delivery_pipeline.log_group_name])
    error_message = "Both projects must write to the delivery pipeline log group."
  }

  assert {
    condition     = module.delivery_pipeline.terraform_projects.plan.log_stream_prefix == "terraform-plan" && module.delivery_pipeline.terraform_projects.apply.log_stream_prefix == "terraform-apply"
    error_message = "Each project needs its own stream prefix."
  }
}

run "plan_environment_reproduces_the_local_apply_inputs" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.terraform_projects.plan.environment_variables.TF_STATE_BUCKET.value == "aula-virtual-tfstate-123456789012"
    error_message = "The state bucket must be <project>-tfstate-<account id>, the name infra/bootstrap creates."
  }

  assert {
    condition     = module.delivery_pipeline.terraform_projects.plan.environment_variables.TF_VAR_region.value == "us-east-2" && module.delivery_pipeline.terraform_projects.plan.environment_variables.TF_VAR_project.value == "aula-virtual" && module.delivery_pipeline.terraform_projects.plan.environment_variables.TF_VAR_enable_github_oidc.value == "false"
    error_message = "region, project and enable_github_oidc must be injected so the pipeline plan equals the local one."
  }

  assert {
    condition     = module.delivery_pipeline.terraform_projects.plan.environment_variables.TF_VAR_allowed_origins.value == jsonencode(["https://app.example.com"])
    error_message = "allowed_origins must be injected as JSON."
  }

  assert {
    condition     = module.delivery_pipeline.terraform_projects.plan.environment_variables.TF_VAR_password_reset_url_base.value == "https://app.example.com/reset-password"
    error_message = "password_reset_url_base must be injected."
  }

  assert {
    condition     = length(module.delivery_pipeline.terraform_projects.plan.environment_variables) == 6
    error_message = "The plan project must receive exactly the state bucket and five TF_VAR_* values."
  }
}

run "apply_environment_holds_only_the_state_bucket" {
  command = apply

  # Terraform rejects variables on a saved plan: it takes them from the plan file.
  assert {
    condition     = keys(module.delivery_pipeline.terraform_projects.apply.environment_variables) == ["TF_STATE_BUCKET"] && module.delivery_pipeline.terraform_projects.apply.environment_variables.TF_STATE_BUCKET.value == "aula-virtual-tfstate-123456789012"
    error_message = "The apply project must only receive TF_STATE_BUCKET."
  }
}

run "environment_variables_are_plaintext_and_none_is_named_like_a_secret" {
  command = apply

  assert {
    condition     = alltrue([for p in values(module.delivery_pipeline.terraform_projects) : alltrue([for v in values(p.environment_variables) : v.type == "PLAINTEXT"])])
    error_message = "Every environment variable must be PLAINTEXT: none of them is a secret."
  }

  assert {
    condition     = alltrue([for p in values(module.delivery_pipeline.terraform_projects) : alltrue([for n in keys(p.environment_variables) : !can(regex("(?i)(SECRET|TOKEN|CREDENTIAL|ACCESS_KEY|_KEY$)", n))])])
    error_message = "No environment variable may be named like a secret (password_reset_url_base is a public URL, not a password)."
  }
}

run "roles_are_assumable_only_by_codebuild_for_their_own_project" {
  command = apply

  assert {
    condition     = alltrue([for t in values(module.delivery_pipeline.terraform_role_trust) : length(t.Statement) == 1 && t.Statement[0].Effect == "Allow" && t.Statement[0].Action == "sts:AssumeRole" && t.Statement[0].Principal == { Service = "codebuild.amazonaws.com" }])
    error_message = "Each role must trust only codebuild.amazonaws.com."
  }

  assert {
    condition     = module.delivery_pipeline.terraform_role_trust.plan.Statement[0].Condition == { StringEquals = { "aws:SourceAccount" = "123456789012", "aws:SourceArn" = "arn:aws:codebuild:us-east-2:123456789012:project/aula-virtual-prod-terraform-plan" } }
    error_message = "The plan role must be conditioned on the account and on the plan project ARN."
  }

  assert {
    condition     = module.delivery_pipeline.terraform_role_trust.apply.Statement[0].Condition == { StringEquals = { "aws:SourceAccount" = "123456789012", "aws:SourceArn" = "arn:aws:codebuild:us-east-2:123456789012:project/aula-virtual-prod-terraform-apply" } }
    error_message = "The apply role must be conditioned on the account and on the apply project ARN."
  }

  assert {
    condition     = output.pipeline_terraform_plan_role_arn == module.delivery_pipeline.terraform_plan_role_arn && output.pipeline_terraform_apply_role_arn == module.delivery_pipeline.terraform_apply_role_arn && module.delivery_pipeline.terraform_plan_role_arn != module.delivery_pipeline.terraform_apply_role_arn
    error_message = "The root must expose two distinct role ARNs."
  }
}

run "both_roles_write_logs_and_artifacts_only_where_the_pipeline_needs_them" {
  command = apply

  assert {
    condition     = alltrue([for s in values(module.delivery_pipeline.terraform_role_policy_statements) : one([for x in s : x if x.Sid == "WriteBuildLogs"]).Action == ["logs:CreateLogStream", "logs:PutLogEvents"]])
    error_message = "Both roles may only create log streams and put log events."
  }

  assert {
    condition     = alltrue([for s in values(module.delivery_pipeline.terraform_role_policy_statements) : one([for x in s : x if x.Sid == "WriteBuildLogs"]).Resource == ["${module.delivery_pipeline.log_group_arn}:*"]])
    error_message = "Log writes must be scoped to the delivery pipeline log group."
  }

  assert {
    condition     = alltrue([for s in values(module.delivery_pipeline.terraform_role_policy_statements) : one([for x in s : x if x.Sid == "ArtifactBucketObjects"]).Resource == ["${module.delivery_pipeline.artifact_bucket_arn}/*"]])
    error_message = "Artifact object access must be scoped to the artifact bucket."
  }
}

run "both_roles_reach_only_the_prod_state_and_its_lock_file" {
  command = apply

  assert {
    condition     = alltrue([for s in values(module.delivery_pipeline.terraform_role_policy_statements) : one([for x in s : x if x.Sid == "ListStateBucket"]).Resource == ["arn:aws:s3:::aula-virtual-tfstate-123456789012"]])
    error_message = "Listing must be scoped to the state bucket."
  }

  assert {
    condition     = alltrue([for s in values(module.delivery_pipeline.terraform_role_policy_statements) : one([for x in s : x if x.Sid == "ManageStateLock"]).Resource == ["arn:aws:s3:::aula-virtual-tfstate-123456789012/prod/terraform.tfstate.tflock"] && one([for x in s : x if x.Sid == "ManageStateLock"]).Action == ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]])
    error_message = "The lock file is the only object both roles may delete."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "ReadWriteState"]).Action == ["s3:GetObject", "s3:PutObject"] && one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "ReadWriteState"]).Resource == ["arn:aws:s3:::aula-virtual-tfstate-123456789012/prod/terraform.tfstate"]
    error_message = "The apply role reads and writes the state object."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.terraform_role_policy_statements.plan : x if x.Sid == "ReadState"]).Action == ["s3:GetObject"]
    error_message = "The plan role may only read the state object."
  }
}

run "plan_role_is_read_only_except_logs_artifacts_and_the_state_lock" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.terraform_plan_managed_policy_arns == ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
    error_message = "The plan role reads what Terraform refreshes through the AWS managed ReadOnlyAccess policy."
  }

  assert {
    condition     = [for s in module.delivery_pipeline.terraform_role_policy_statements.plan : s.Sid if s.Effect == "Allow" && length([for a in s.Action : a if !can(regex("^[a-z0-9]+:(Get|List|Describe)", a))]) > 0] == ["WriteBuildLogs", "ArtifactBucketObjects", "ManageStateLock"]
    error_message = "Only logs, artifact objects and the state lock may carry write actions in the plan role."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.terraform_role_policy_statements.plan : x if x.Sid == "DenyReadingApplicationData"]).Effect == "Deny"
    error_message = "ReadOnlyAccess must not expose uploaded files or secret values: an explicit deny is required."
  }

  assert {
    condition     = contains(one([for x in module.delivery_pipeline.terraform_role_policy_statements.plan : x if x.Sid == "DenyReadingApplicationData"]).Action, "secretsmanager:GetSecretValue") && contains(one([for x in module.delivery_pipeline.terraform_role_policy_statements.plan : x if x.Sid == "DenyReadingApplicationData"]).Action, "s3:GetObject")
    error_message = "The deny must cover secret values and file contents."
  }
}

run "apply_role_has_no_managed_policy_and_a_policy_that_fits_the_inline_limit" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.terraform_apply_managed_policy_arns == []
    error_message = "The apply role carries only its inline policy."
  }

  assert {
    condition     = length(replace(jsonencode(module.delivery_pipeline.terraform_role_policy_statements.apply), " ", "")) < 10000
    error_message = "IAM limits the inline policies of a role to 10240 characters in total."
  }
}

run "apply_role_iam_actions_stay_inside_the_project_prefix" {
  command = apply

  assert {
    condition     = alltrue([for r in one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "ManageProjectIdentities"]).Resource : startswith(r, "arn:aws:iam::123456789012:") && strcontains(r, "aula-virtual-prod-")])
    error_message = "IAM management must be scoped to roles, policies and instance profiles named <name_prefix>-*."
  }

  assert {
    condition     = sort(one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "ManageProjectIdentities"]).Resource) == sort(["arn:aws:iam::123456789012:role/aula-virtual-prod-*", "arn:aws:iam::123456789012:policy/aula-virtual-prod-*", "arn:aws:iam::123456789012:instance-profile/aula-virtual-prod-*"])
    error_message = "IAM management covers exactly roles, policies and instance profiles with the prefix."
  }

  assert {
    condition     = !contains(flatten([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x.Action]), "iam:*") && !contains(flatten([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x.Action]), "*")
    error_message = "No statement may grant every IAM action or every action."
  }
}

run "apply_role_passes_only_prefixed_roles_to_the_services_that_need_them" {
  command = apply

  assert {
    condition     = one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "PassProjectRoles"]).Action == ["iam:PassRole"] && one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "PassProjectRoles"]).Resource == ["arn:aws:iam::123456789012:role/aula-virtual-prod-*"]
    error_message = "iam:PassRole must be limited to roles named <name_prefix>-*."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "PassProjectRoles"]).Condition == { StringEquals = { "iam:PassedToService" = ["ec2.amazonaws.com", "codebuild.amazonaws.com", "codepipeline.amazonaws.com"] } }
    error_message = "iam:PassRole must be conditioned on the services that receive the roles."
  }
}

run "apply_role_manages_prefixed_resources_and_documents_the_unscopable_ones" {
  command = apply

  assert {
    condition     = alltrue([for sid in ["ManageEcrRepositories", "ManageCodeBuildProjects", "ManageCodePipelines", "ManageProjectSecrets", "ManageProjectParameters", "ManageProjectLogGroups", "ManageProjectBuckets"] : alltrue([for r in one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == sid]).Resource : strcontains(r, "aula-virtual-prod")])])
    error_message = "Services with named resources must be scoped to the prefix."
  }

  assert {
    condition     = contains(one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "ManageAmplifyApps"]).Resource, "arn:aws:amplify:us-east-2:123456789012:apps/*") && contains(one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "ManageNetworkAndHost"]).Resource, "*")
    error_message = "Amplify and EC2 resources have no usable prefix, so they are scoped by service ARN or region."
  }

  assert {
    condition     = one([for x in module.delivery_pipeline.terraform_role_policy_statements.apply : x if x.Sid == "ManageNetworkAndHost"]).Condition == { StringEquals = { "aws:RequestedRegion" = "us-east-2" } }
    error_message = "EC2 actions must be limited to the project region."
  }
}
