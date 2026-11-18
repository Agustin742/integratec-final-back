output "connection_arn" {
  description = "ARN of the CodeConnections GitHub connection; the pipeline source action references it."
  value       = aws_codeconnections_connection.this.arn
}

output "connection_status" {
  description = "Status of the GitHub connection: PENDING until the console handshake is completed, then AVAILABLE."
  value       = aws_codeconnections_connection.this.connection_status
}

output "connection_settings" {
  description = "Name and provider type of the connection, for tests and review."
  value = {
    name          = aws_codeconnections_connection.this.name
    provider_type = aws_codeconnections_connection.this.provider_type
  }
}

output "artifact_bucket_name" {
  description = "Name of the pipeline artifact bucket."
  value       = aws_s3_bucket.artifacts.id
}

output "artifact_bucket_arn" {
  description = "ARN of the pipeline artifact bucket; object access policies use \"<arn>/*\"."
  value       = aws_s3_bucket.artifacts.arn
}

output "artifact_bucket_settings" {
  description = "Naming, deletion, ownership and encryption settings of the artifact bucket, for tests and review."
  value = {
    bucket_prefix    = aws_s3_bucket.artifacts.bucket_prefix
    force_destroy    = aws_s3_bucket.artifacts.force_destroy
    object_ownership = one(aws_s3_bucket_ownership_controls.artifacts.rule).object_ownership
    sse_algorithm    = one(one(aws_s3_bucket_server_side_encryption_configuration.artifacts.rule).apply_server_side_encryption_by_default).sse_algorithm
  }
}

output "public_access_block" {
  description = "Public access block settings of the artifact bucket, for tests and review."
  value = {
    block_public_acls       = aws_s3_bucket_public_access_block.artifacts.block_public_acls
    block_public_policy     = aws_s3_bucket_public_access_block.artifacts.block_public_policy
    ignore_public_acls      = aws_s3_bucket_public_access_block.artifacts.ignore_public_acls
    restrict_public_buckets = aws_s3_bucket_public_access_block.artifacts.restrict_public_buckets
  }
}

output "lifecycle_rules" {
  description = "Id, status and retention days of the lifecycle rule as configured on the resource, for tests and review."
  value = {
    id                                     = one(aws_s3_bucket_lifecycle_configuration.artifacts.rule[*].id)
    status                                 = one(aws_s3_bucket_lifecycle_configuration.artifacts.rule[*].status)
    expiration_days                        = one(flatten(aws_s3_bucket_lifecycle_configuration.artifacts.rule[*].expiration[*].days))
    noncurrent_version_expiration_days     = one(flatten(aws_s3_bucket_lifecycle_configuration.artifacts.rule[*].noncurrent_version_expiration[*].noncurrent_days))
    abort_incomplete_multipart_upload_days = one(flatten(aws_s3_bucket_lifecycle_configuration.artifacts.rule[*].abort_incomplete_multipart_upload[*].days_after_initiation))
  }
}

output "bucket_policy_statements" {
  description = "Statements of the policy attached to the artifact bucket, decoded from the resource, for tests and review."
  value       = jsondecode(aws_s3_bucket_policy.artifacts.policy).Statement
}

output "log_group_name" {
  description = "Name of the CloudWatch log group the CodeBuild projects write to."
  value       = aws_cloudwatch_log_group.codebuild.name
}

output "log_group_arn" {
  description = "ARN of the CodeBuild log group; CodeBuild role policies scope log writes to \"<arn>:*\"."
  value       = aws_cloudwatch_log_group.codebuild.arn
}

output "log_group_settings" {
  description = "Name and retention of the CodeBuild log group, for tests and review."
  value = {
    name              = aws_cloudwatch_log_group.codebuild.name
    retention_in_days = aws_cloudwatch_log_group.codebuild.retention_in_days
  }
}

output "terraform_plan_project_name" {
  description = "Name of the CodeBuild project that runs terraform plan; the pipeline plan stage references it."
  value       = aws_codebuild_project.terraform_plan.name
}

output "terraform_apply_project_name" {
  description = "Name of the CodeBuild project that applies the saved plan; the pipeline apply stage references it."
  value       = aws_codebuild_project.terraform_apply.name
}

output "terraform_plan_role_arn" {
  description = "ARN of the service role of the terraform plan project."
  value       = aws_iam_role.terraform_plan.arn
}

output "terraform_apply_role_arn" {
  description = "ARN of the service role of the terraform apply project."
  value       = aws_iam_role.terraform_apply.arn
}

output "terraform_projects" {
  description = "Source, environment, logging and environment variables of the plan and apply projects as configured on the resources, for tests and review."
  value = {
    for key, project in { plan    = aws_codebuild_project.terraform_plan, apply = aws_codebuild_project.terraform_apply } : key => {
      name                        = project.name
      source_type                 = one(project.source).type
      buildspec                   = one(project.source).buildspec
      artifacts_type              = one(project.artifacts).type
      compute_type                = one(project.environment).compute_type
      environment_type            = one(project.environment).type
      image                       = one(project.environment).image
      image_pull_credentials_type = one(project.environment).image_pull_credentials_type
      privileged_mode             = one(project.environment).privileged_mode
      build_timeout               = project.build_timeout
      concurrent_build_limit      = project.concurrent_build_limit
      vpc_config_count            = length(project.vpc_config)
      log_group_name              = one(one(project.logs_config).cloudwatch_logs).group_name
      log_stream_prefix           = one(one(project.logs_config).cloudwatch_logs).stream_name
      environment_variables       = { for v in one(project.environment).environment_variable : v.name => { value = v.value, type = v.type } }
    }
  }
}

output "terraform_role_trust" {
  description = "Trust policy of each runner role, decoded from the resource, for tests and review."
  value = {
    plan  = jsondecode(aws_iam_role.terraform_plan.assume_role_policy)
    apply = jsondecode(aws_iam_role.terraform_apply.assume_role_policy)
  }
}

output "terraform_role_policy_statements" {
  description = "Statements of the inline policy of each runner role, decoded from the resource, for tests and review."
  value = {
    plan  = jsondecode(aws_iam_role_policy.terraform_plan.policy).Statement
    apply = jsondecode(aws_iam_role_policy.terraform_apply.policy).Statement
  }
}

output "terraform_plan_managed_policy_arns" {
  description = "AWS managed policies attached to the plan role."
  value       = [aws_iam_role_policy_attachment.terraform_plan_read_only.policy_arn]
}

output "terraform_apply_managed_policy_arns" {
  description = "AWS managed policies attached to the apply role (none: it only has its inline policy)."
  value       = []
}

output "images_project_name" {
  description = "Name of the CodeBuild project that builds and pushes the release images; the pipeline images stage references it."
  value       = aws_codebuild_project.images.name
}

output "images_role_arn" {
  description = "ARN of the service role of the images project."
  value       = aws_iam_role.images.arn
}

output "images_project" {
  description = "Source, environment, logging and environment variables of the images project as configured on the resource, for tests and review."
  value = {
    name                        = aws_codebuild_project.images.name
    source_type                 = one(aws_codebuild_project.images.source).type
    buildspec                   = one(aws_codebuild_project.images.source).buildspec
    artifacts_type              = one(aws_codebuild_project.images.artifacts).type
    compute_type                = one(aws_codebuild_project.images.environment).compute_type
    environment_type            = one(aws_codebuild_project.images.environment).type
    image                       = one(aws_codebuild_project.images.environment).image
    image_pull_credentials_type = one(aws_codebuild_project.images.environment).image_pull_credentials_type
    privileged_mode             = one(aws_codebuild_project.images.environment).privileged_mode
    build_timeout               = aws_codebuild_project.images.build_timeout
    vpc_config_count            = length(aws_codebuild_project.images.vpc_config)
    log_group_name              = one(one(aws_codebuild_project.images.logs_config).cloudwatch_logs).group_name
    log_stream_prefix           = one(one(aws_codebuild_project.images.logs_config).cloudwatch_logs).stream_name
    environment_variables       = { for v in one(aws_codebuild_project.images.environment).environment_variable : v.name => { value = v.value, type = v.type } }
  }
}

output "images_role_trust" {
  description = "Trust policy of the images role, decoded from the resource, for tests and review."
  value       = jsondecode(aws_iam_role.images.assume_role_policy)
}

output "images_role_policy_statements" {
  description = "Statements of the inline policy of the images role, decoded from the resource, for tests and review."
  value       = jsondecode(aws_iam_role_policy.images.policy).Statement
}

output "images_managed_policy_arns" {
  description = "AWS managed policies attached to the images role (none: it only has its inline policy)."
  value       = []
}
