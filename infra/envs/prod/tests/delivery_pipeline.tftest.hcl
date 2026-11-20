mock_provider "aws" {
  # The mock returns random strings for ARNs; the email subscriptions validate the topic
  # ARN format, so the alarm topic ARN is pinned to a well-formed value.
  override_resource {
    target = module.monitoring.aws_sns_topic.alarms
    values = {
      arn = "arn:aws:sns:us-east-2:123456789012:aula-virtual-prod-alarms"
    }
  }

  # The delivery pipeline module builds role and project ARNs from the account ID, and
  # CodeBuild validates them; the mock would return a random string, so it is pinned.
  override_data {
    target = module.delivery_pipeline.data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
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
}

variables {
  import_existing_frontend = false
  project                  = "aula-virtual"
  allowed_origins          = ["https://app.example.com"]
  password_reset_url_base  = "https://app.example.com/reset-password"
  alert_email_addresses    = ["alerts@example.com"]
}

run "connection_links_github_and_is_named_by_prefix" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.connection_settings.name == "aula-virtual-prod-github" && module.delivery_pipeline.connection_settings.provider_type == "GitHub"
    error_message = "The CodeConnections connection must be <name_prefix>-github with provider_type GitHub."
  }

  assert {
    condition     = output.pipeline_connection_arn == module.delivery_pipeline.connection_arn && output.pipeline_connection_status == module.delivery_pipeline.connection_status
    error_message = "The root must expose the connection ARN and status."
  }
}

run "artifact_bucket_is_private_and_never_force_destroyed" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.artifact_bucket_settings.bucket_prefix == "aula-virtual-prod-pipeline-artifacts-" && module.delivery_pipeline.artifact_bucket_settings.force_destroy == false
    error_message = "The bucket must use bucket_prefix <name_prefix>-pipeline-artifacts- and must not set force_destroy."
  }

  assert {
    condition     = module.delivery_pipeline.public_access_block == { block_public_acls = true, block_public_policy = true, ignore_public_acls = true, restrict_public_buckets = true }
    error_message = "All four public access block settings must be true."
  }

  assert {
    condition     = module.delivery_pipeline.artifact_bucket_settings.object_ownership == "BucketOwnerEnforced" && module.delivery_pipeline.artifact_bucket_settings.sse_algorithm == "AES256"
    error_message = "Ownership must be BucketOwnerEnforced and encryption SSE-S3 (AES256)."
  }

  assert {
    condition     = output.pipeline_artifact_bucket_name == module.delivery_pipeline.artifact_bucket_name
    error_message = "The root must expose the artifact bucket name."
  }
}

run "bucket_policy_denies_insecure_transport" {
  command = apply

  assert {
    condition     = length(module.delivery_pipeline.bucket_policy_statements) == 1
    error_message = "The bucket policy must hold exactly the TLS-only statement."
  }

  assert {
    condition     = module.delivery_pipeline.bucket_policy_statements[0].Effect == "Deny" && module.delivery_pipeline.bucket_policy_statements[0].Principal == "*" && module.delivery_pipeline.bucket_policy_statements[0].Action == "s3:*"
    error_message = "The statement must deny every action to every principal."
  }

  assert {
    condition     = module.delivery_pipeline.bucket_policy_statements[0].Condition == { Bool = { "aws:SecureTransport" = "false" } }
    error_message = "The statement must apply only when aws:SecureTransport is false."
  }

  assert {
    condition     = length(module.delivery_pipeline.bucket_policy_statements[0].Resource) == 2 && endswith(module.delivery_pipeline.bucket_policy_statements[0].Resource[1], "/*")
    error_message = "The statement must cover the bucket and its objects."
  }
}

run "artifacts_expire_after_30_days_by_default" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.lifecycle_rules.status == "Enabled" && module.delivery_pipeline.lifecycle_rules.expiration_days == 30 && module.delivery_pipeline.lifecycle_rules.noncurrent_version_expiration_days == 30 && module.delivery_pipeline.lifecycle_rules.abort_incomplete_multipart_upload_days == 7
    error_message = "The lifecycle rule must be Enabled, expire objects and noncurrent versions after 30 days and abort incomplete multipart uploads after 7 days."
  }
}

run "artifact_expiration_is_configurable" {
  command = plan

  module {
    source = "../../modules/delivery_pipeline"
  }

  variables {
    project                  = "aula-virtual"
    region                   = "us-east-2"
    allowed_origins          = ["https://app.example.com"]
    password_reset_url_base  = "https://app.example.com/reset-password"
    alert_email_addresses    = ["alerts@example.com"]
    monthly_budget_usd       = 40
    name_prefix              = "aula-virtual-prod"
    artifact_expiration_days = 90
    ecr_repository_names     = { api = "aula-virtual-prod-api", realtime = "aula-virtual-prod-realtime", migrate = "aula-virtual-prod-migrate" }
    host_instance_id         = "i-0123456789abcdef0"
    github_repository        = "Agustin742/integratec-final-back"
    site_address             = "203-0-113-10.sslip.io"
    ecr_repository_arns = {
      api      = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-api"
      realtime = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-realtime"
      migrate  = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-migrate"
    }
  }

  # The module resolves the account ID for the state bucket and role ARNs; the mock would
  # return a random string that CodeBuild rejects as an ARN.
  override_data {
    target = data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
    }
  }

  assert {
    condition     = output.lifecycle_rules.expiration_days == 90
    error_message = "artifact_expiration_days must feed the lifecycle rule."
  }
}

run "log_group_is_named_and_has_explicit_retention" {
  command = apply

  assert {
    condition     = module.delivery_pipeline.log_group_settings.name == "/aula-virtual-prod/codebuild" && module.delivery_pipeline.log_group_settings.retention_in_days == 14
    error_message = "The CodeBuild log group must be /<name_prefix>/codebuild with 14 days of retention by default."
  }

  assert {
    condition     = output.pipeline_log_group_name == "/aula-virtual-prod/codebuild"
    error_message = "The root must expose the log group name."
  }
}

run "rejects_unsupported_log_retention" {
  command = plan

  module {
    source = "../../modules/delivery_pipeline"
  }

  variables {
    project                 = "aula-virtual"
    region                  = "us-east-2"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    alert_email_addresses   = ["alerts@example.com"]
    monthly_budget_usd      = 40
    name_prefix             = "aula-virtual-prod"
    ecr_repository_names    = { api = "aula-virtual-prod-api", realtime = "aula-virtual-prod-realtime", migrate = "aula-virtual-prod-migrate" }
    host_instance_id        = "i-0123456789abcdef0"
    github_repository       = "Agustin742/integratec-final-back"
    site_address            = "203-0-113-10.sslip.io"
    ecr_repository_arns = {
      api      = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-api"
      realtime = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-realtime"
      migrate  = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-migrate"
    }
    retention_in_days = 10
  }

  override_data {
    target = data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
    }
  }

  expect_failures = [var.retention_in_days]
}

run "rejects_zero_artifact_expiration_days" {
  command = plan

  module {
    source = "../../modules/delivery_pipeline"
  }

  variables {
    project                 = "aula-virtual"
    region                  = "us-east-2"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    alert_email_addresses   = ["alerts@example.com"]
    monthly_budget_usd      = 40
    name_prefix             = "aula-virtual-prod"
    ecr_repository_names    = { api = "aula-virtual-prod-api", realtime = "aula-virtual-prod-realtime", migrate = "aula-virtual-prod-migrate" }
    host_instance_id        = "i-0123456789abcdef0"
    github_repository       = "Agustin742/integratec-final-back"
    site_address            = "203-0-113-10.sslip.io"
    ecr_repository_arns = {
      api      = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-api"
      realtime = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-realtime"
      migrate  = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-migrate"
    }
    artifact_expiration_days = 0
  }

  override_data {
    target = data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
    }
  }

  expect_failures = [var.artifact_expiration_days]
}

run "rejects_fractional_artifact_expiration_days" {
  command = plan

  module {
    source = "../../modules/delivery_pipeline"
  }

  variables {
    project                 = "aula-virtual"
    region                  = "us-east-2"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    alert_email_addresses   = ["alerts@example.com"]
    monthly_budget_usd      = 40
    name_prefix             = "aula-virtual-prod"
    ecr_repository_names    = { api = "aula-virtual-prod-api", realtime = "aula-virtual-prod-realtime", migrate = "aula-virtual-prod-migrate" }
    host_instance_id        = "i-0123456789abcdef0"
    github_repository       = "Agustin742/integratec-final-back"
    site_address            = "203-0-113-10.sslip.io"
    ecr_repository_arns = {
      api      = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-api"
      realtime = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-realtime"
      migrate  = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-migrate"
    }
    artifact_expiration_days = 1.5
  }

  override_data {
    target = data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
    }
  }

  expect_failures = [var.artifact_expiration_days]
}

run "rejects_name_prefix_longer_than_17_characters" {
  command = plan

  module {
    source = "../../modules/delivery_pipeline"
  }

  variables {
    project                 = "aula-virtual"
    region                  = "us-east-2"
    allowed_origins         = ["https://app.example.com"]
    password_reset_url_base = "https://app.example.com/reset-password"
    alert_email_addresses   = ["alerts@example.com"]
    monthly_budget_usd      = 40
    name_prefix             = "aula-virtual-prod-x"
    ecr_repository_names    = { api = "aula-virtual-prod-api", realtime = "aula-virtual-prod-realtime", migrate = "aula-virtual-prod-migrate" }
    host_instance_id        = "i-0123456789abcdef0"
    github_repository       = "Agustin742/integratec-final-back"
    site_address            = "203-0-113-10.sslip.io"
    ecr_repository_arns = {
      api      = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-api"
      realtime = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-realtime"
      migrate  = "arn:aws:ecr:us-east-2:123456789012:repository/aula-virtual-prod-migrate"
    }
  }

  override_data {
    target = data.aws_caller_identity.current
    values = {
      account_id = "123456789012"
    }
  }

  expect_failures = [var.name_prefix]
}
