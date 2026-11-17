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
  # policy document is pinned to a well-formed value.
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
  allowed_origins         = ["https://app.example.com"]
  password_reset_url_base = "https://app.example.com/reset-password"
}

run "defaults_target_prod_in_us_east_2" {
  command = plan

  assert {
    condition     = var.region == "us-east-2"
    error_message = "The default region must be us-east-2 (decision D5)."
  }

  assert {
    condition     = var.enable_github_oidc == false
    error_message = "GitHub OIDC resources must be opt-in (the account's managed SCP denies the provider)."
  }

  assert {
    condition     = output.environment == "prod"
    error_message = "This root must describe the prod environment."
  }
}

run "rejects_invalid_project_prefix" {
  command = plan

  variables {
    project = "Aula Virtual"
  }

  expect_failures = [var.project]
}

run "rejects_invalid_region" {
  command = plan

  variables {
    region = "not-a-region"
  }

  expect_failures = [var.region]
}
