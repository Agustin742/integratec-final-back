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
}

variables {
  project                 = "aula-virtual"
  allowed_origins         = ["https://app.example.com"]
  password_reset_url_base = "https://app.example.com/reset-password"
}

run "bucket_is_named_by_prefix_and_never_force_destroyed" {
  command = apply

  assert {
    condition     = module.storage.bucket_settings.bucket_prefix == "aula-virtual-prod-files-"
    error_message = "The bucket must use bucket_prefix <name_prefix>-files- (names are global, the prefix avoids collisions)."
  }

  assert {
    condition     = module.storage.bucket_settings.force_destroy == false
    error_message = "force_destroy must be false: submissions and materials are data."
  }

  assert {
    condition     = output.storage_bucket_name == module.storage.bucket_name && output.storage_bucket_arn == module.storage.bucket_arn
    error_message = "The root must expose the bucket name and ARN."
  }
}

run "public_access_is_fully_blocked" {
  command = apply

  assert {
    condition     = module.storage.public_access_block == { block_public_acls = true, block_public_policy = true, ignore_public_acls = true, restrict_public_buckets = true }
    error_message = "All four public access block settings must be true."
  }
}

run "acls_are_disabled_and_encryption_is_sse_s3" {
  command = apply

  assert {
    condition     = module.storage.bucket_settings.object_ownership == "BucketOwnerEnforced"
    error_message = "Object ownership must be BucketOwnerEnforced (ACLs disabled)."
  }

  assert {
    condition     = module.storage.bucket_settings.sse_algorithm == "AES256"
    error_message = "Objects must be encrypted at rest with SSE-S3 (AES256)."
  }
}

run "versioning_with_bounded_noncurrent_retention" {
  command = apply

  assert {
    condition     = module.storage.bucket_settings.versioning_status == "Enabled"
    error_message = "Versioning must be Enabled."
  }

  assert {
    condition     = module.storage.lifecycle_rules.status == "Enabled" && module.storage.lifecycle_rules.noncurrent_version_expiration_days == 30 && module.storage.lifecycle_rules.abort_incomplete_multipart_upload_days == 7
    error_message = "The lifecycle rule must be Enabled, expire noncurrent versions after 30 days and abort incomplete multipart uploads after 7 days."
  }
}

run "noncurrent_expiration_is_configurable" {
  command = plan

  module {
    source = "../../modules/storage"
  }

  variables {
    name_prefix                        = "aula-virtual-prod"
    noncurrent_version_expiration_days = 90
  }

  assert {
    condition     = output.lifecycle_rules.noncurrent_version_expiration_days == 90
    error_message = "noncurrent_version_expiration_days must feed the lifecycle rule."
  }
}

run "policy_denies_insecure_transport" {
  command = apply

  assert {
    condition     = length(module.storage.bucket_policy_statements) == 1
    error_message = "The bucket policy must hold exactly the TLS-only statement."
  }

  assert {
    condition     = module.storage.bucket_policy_statements[0].Effect == "Deny" && module.storage.bucket_policy_statements[0].Principal == "*" && module.storage.bucket_policy_statements[0].Action == "s3:*"
    error_message = "The statement must deny every action to every principal."
  }

  assert {
    condition     = module.storage.bucket_policy_statements[0].Condition == { Bool = { "aws:SecureTransport" = "false" } }
    error_message = "The statement must apply only when aws:SecureTransport is false."
  }

  assert {
    condition     = length(module.storage.bucket_policy_statements[0].Resource) == 2 && endswith(module.storage.bucket_policy_statements[0].Resource[1], "/*")
    error_message = "The statement must cover the bucket and its objects."
  }
}

run "api_receives_the_bucket_name_through_ssm" {
  command = apply

  assert {
    condition     = module.app_config.parameters["api/S3_BUCKET"].value == module.storage.bucket_name
    error_message = "S3_BUCKET must be the bucket created by the storage module."
  }

  assert {
    condition     = module.app_config.parameters["api/S3_BUCKET"].name == "/aula-virtual-prod/config/api/S3_BUCKET" && module.app_config.parameters["api/S3_BUCKET"].type == "String"
    error_message = "S3_BUCKET must be a String parameter under the api config path."
  }
}

run "static_scan_keeps_bucket_private_and_protected" {
  command = plan

  # The var.project != "" terms give each assertion a reference to the configuration;
  # Terraform rejects conditions that only call file functions on constants.
  assert {
    condition     = var.project != "" && length(fileset("../../modules/storage", "*.tf")) > 0
    error_message = "The static scan found no storage .tf files; check the relative paths."
  }

  assert {
    condition     = var.project != "" && can(regex("prevent_destroy[[:space:]]*=[[:space:]]*true", file("../../modules/storage/bucket.tf")))
    error_message = "The bucket must set prevent_destroy = true."
  }

  assert {
    condition = var.project != "" && length([
      for f in concat([for m in fileset("../../modules", "*/*.tf") : "../../modules/${m}"], [for e in fileset("../../envs", "*/*.tf") : "../../envs/${e}"]) : f
      if can(regex("(?m)^[[:space:]]*resource[[:space:]]+\"aws_s3_bucket_(acl|cors_configuration)\"", file(f))) || can(regex("public-read", file(f)))
    ]) == 0
    error_message = "No Terraform file may create a bucket ACL or CORS configuration, nor mention public-read."
  }

  assert {
    condition     = var.project != "" && length(regexall("(?m)^[[:space:]]*(acl|cors_rule|versioning|server_side_encryption_configuration)[[:space:]]*[={]", file("../../modules/storage/bucket.tf"))) == 0
    error_message = "The bucket resource must not use deprecated inline acl, cors, versioning or encryption blocks."
  }
}

run "rejects_invalid_module_name_prefix" {
  command = plan

  module {
    source = "../../modules/storage"
  }

  variables {
    name_prefix = "Bad_Prefix"
  }

  expect_failures = [var.name_prefix]
}

run "accepts_name_prefix_of_30_characters" {
  command = plan

  module {
    source = "../../modules/storage"
  }

  variables {
    name_prefix = "aula-virtual-prod-aaaaaaaaaaaa"
  }

  assert {
    condition     = output.bucket_settings.bucket_prefix == "aula-virtual-prod-aaaaaaaaaaaa-files-"
    error_message = "A 30 character name_prefix must be accepted: with -files- the bucket prefix is the 37 character maximum."
  }
}

run "rejects_name_prefix_of_31_characters" {
  command = plan

  module {
    source = "../../modules/storage"
  }

  variables {
    name_prefix = "aula-virtual-prod-aaaaaaaaaaaaa"
  }

  expect_failures = [var.name_prefix]
}

run "rejects_zero_noncurrent_expiration_days" {
  command = plan

  module {
    source = "../../modules/storage"
  }

  variables {
    name_prefix                        = "aula-virtual-prod"
    noncurrent_version_expiration_days = 0
  }

  expect_failures = [var.noncurrent_version_expiration_days]
}

run "rejects_fractional_noncurrent_expiration_days" {
  command = plan

  module {
    source = "../../modules/storage"
  }

  variables {
    name_prefix                        = "aula-virtual-prod"
    noncurrent_version_expiration_days = 1.5
  }

  expect_failures = [var.noncurrent_version_expiration_days]
}
